'use strict';

// Egress approval broker. Squid's external_acl helper submits a pending request
// (POST /pending) and blocks on the response until a human decides. The decision
// endpoint (POST /decision) is token-gated so that only a caller holding the
// out-of-band token — i.e. the host-side VS Code extension, never the sandboxed
// app container — can grant approval. See devcontainer/approver + the plan.

const http = require('http');

const PORT = Number(process.env.APPROVER_PORT) || 3129;
const TOKEN = process.env.APPROVER_TOKEN || '';

// host -> { host, method, firstSeenAt, waiters: Set<ServerResponse> }
const pending = new Map();

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

// Resolve every blocked helper waiting on `host` with the given verdict.
function settle(host, verdict) {
  const entry = pending.get(host);
  if (!entry) return 0;
  pending.delete(host);
  for (const waiter of entry.waiters) {
    if (!waiter.writableEnded) sendJson(waiter, 200, { verdict });
  }
  return entry.waiters.size;
}

async function handlePending(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return sendJson(res, 400, { error: 'invalid json' });
  }
  const host = String(body.host || '').trim().toLowerCase();
  const method = String(body.method || '').trim().toUpperCase();
  if (!host) return sendJson(res, 400, { error: 'host required' });

  let entry = pending.get(host);
  if (!entry) {
    entry = { host, method, firstSeenAt: Date.now(), waiters: new Set() };
    pending.set(host, entry);
    console.log(`[pending] ${method} ${host}`);
  }
  entry.waiters.add(res);

  // Drop this waiter if the helper hangs up (its curl timed out → fail-closed).
  req.on('close', () => {
    entry.waiters.delete(res);
    if (entry.waiters.size === 0) pending.delete(host);
  });
  // The response stays open until settle() decides it.
}

function handleListPending(res) {
  const list = [...pending.values()].map((e) => ({
    host: e.host,
    method: e.method,
    firstSeenAt: e.firstSeenAt,
    waiting: e.waiters.size,
  }));
  sendJson(res, 200, { pending: list });
}

async function handleDecision(req, res) {
  const token = req.headers['x-approver-token'];
  if (!TOKEN || token !== TOKEN) {
    return sendJson(res, 401, { error: 'unauthorized' });
  }
  let body;
  try {
    body = await readJson(req);
  } catch {
    return sendJson(res, 400, { error: 'invalid json' });
  }
  const host = String(body.host || '').trim().toLowerCase();
  const verdict = String(body.verdict || '').trim().toLowerCase();
  if (!host) return sendJson(res, 400, { error: 'host required' });
  if (verdict !== 'allow' && verdict !== 'deny') {
    return sendJson(res, 400, { error: "verdict must be 'allow' or 'deny'" });
  }
  const resolved = settle(host, verdict);
  console.log(`[decision] ${verdict} ${host} (resolved ${resolved})`);
  sendJson(res, 200, { host, verdict, resolved });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/health') return sendJson(res, 200, { ok: true });
  if (req.method === 'POST' && url === '/pending') return handlePending(req, res);
  if (req.method === 'GET' && url === '/pending') return handleListPending(res);
  if (req.method === 'POST' && url === '/decision') return handleDecision(req, res);
  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`approver listening on :${PORT}` + (TOKEN ? '' : ' (WARNING: no APPROVER_TOKEN set, decisions disabled)'));
});
