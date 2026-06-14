/**
 * Egress approval broker. Squid's external_acl helper submits a pending request
 * (POST /pending) and blocks on the response until a human decides. The decision
 * endpoint (POST /decision) is token-gated so that only a caller holding the
 * out-of-band token — i.e. the host-side VS Code extension, never the sandboxed
 * app container — can grant approval. See devcontainer/approver + the plan.
 */

import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

/** @internal */
const PORT = Number(process.env.APPROVER_PORT) || 3129;

/**
 * Shared secret gating POST /decision. Prefer an explicit `APPROVER_TOKEN` (lets
 * the operator pin one for tests); otherwise mint a fresh 256-bit token per
 * process start. Generating it here — rather than sourcing it from a host file —
 * keeps the secret out of the project tree the sandboxed app container bind-mounts,
 * so a rogue process there can never read it. The host retrieves a generated token
 * out-of-band via `docker compose exec approver cat ${@link TOKEN_FILE}`.
 */
const TOKEN = process.env.APPROVER_TOKEN || randomBytes(32).toString("hex");

/**
 * Path the generated token is written to for host-side retrieval. Backed by a
 * tmpfs in the compose file, so the secret lives only in RAM and is wiped when the
 * container stops. Not written when the token came from the environment — the host
 * already knows it in that case.
 * @internal
 */
const TOKEN_FILE = process.env.APPROVER_TOKEN_FILE || "/run/approver/token";

// PHASE 2 (VS Code extension): the host-side decider must read the token from
// here via `docker compose exec approver cat /run/approver/token` and send it in
// the `x-approver-token` header on POST /decision. It must NOT expect the token in
// .devcontainer/.env — that path was removed so the secret stays out of the
// app container's bind-mounted workspace. Token rotates each container start, so
// fetch it per session rather than caching across restarts.

if (!process.env.APPROVER_TOKEN) {
  try {
    writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 });
  } catch (err) {
    console.error(
      `FATAL: could not write token to ${TOKEN_FILE}; host cannot retrieve it:`,
      err,
    );
    process.exit(1);
  }
}

/** Validated, normalized body of a POST /pending request. */
interface PendingPayload {
  /** Trimmed, lowercased hostname the egress request targets. */
  host: string;
  /** Uppercased HTTP method, or "" when the helper omitted it (logging only). */
  method: string;
  /**
   * Full request URL, trimmed. Available for plain-HTTP requests; for HTTPS
   * CONNECT tunnels Squid only knows host:port, so this may be omitted.
   */
  url: string;
}

/** Validated, normalized body of a POST /decision request. */
interface DecisionPayload {
  /** The unique request ID assigned by POST /pending. */
  requestId: string;
  /** The human's verdict for {@link DecisionPayload.requestId}. */
  verdict: "allow" | "deny";
}

/**
 * Read, validate, and normalize a POST /pending body. `host` is required; `method`
 * is optional and coerced leniently since it is informational (logging) only.
 * @param req The incoming request.
 * @returns A {@link PendingPayload} on success, or a `string` describing the first
 *   problem found (returned, never thrown) for the caller to send back verbatim.
 */
async function parsePostPendingPayload(
  req: Request,
): Promise<PendingPayload | string> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return "invalid json";
  }
  if (typeof body !== "object" || body === null) {
    return "body must be a json object";
  }

  const rawHost = body.host;
  if (typeof rawHost !== "string") return "host must be a string";
  const host = rawHost.trim().toLowerCase();
  if (!host) return "host required";

  const rawMethod = body.method;
  const method =
    typeof rawMethod === "string" ? rawMethod.trim().toUpperCase() : "";

  const rawUrl = body.url;
  const url = typeof rawUrl === "string" ? rawUrl.trim() : "";

  return { host, method, url };
}

/**
 * Read, validate, and normalize a POST /decision body. `host` and a `verdict` of
 * `"allow"` or `"deny"` (case-insensitive) are both required.
 * @param req The incoming request.
 * @returns A {@link DecisionPayload} on success, or a `string` describing the first
 *   problem found (returned, never thrown) for the caller to send back verbatim.
 */
async function parsePostDecisionPayload(
  req: Request,
): Promise<DecisionPayload | string> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return "invalid json";
  }
  if (typeof body !== "object" || body === null) {
    return "body must be a json object";
  }

  const rawRequestId = body.requestId;
  if (typeof rawRequestId !== "string") return "requestId must be a string";
  const requestId = rawRequestId.trim();
  if (!requestId) return "requestId required";

  const rawVerdict = body.verdict;
  const verdict =
    typeof rawVerdict === "string" ? rawVerdict.trim().toLowerCase() : "";
  if (verdict !== "allow" && verdict !== "deny") {
    return "verdict must be 'allow' or 'deny'";
  }

  return { requestId, verdict };
}

interface PendingEntry {
  /** Unique ID assigned at request time; used as the Map key and in decisions. */
  requestId: string;
  host: string;
  method: string;
  /** Full URL when available (plain HTTP); empty string for HTTPS CONNECT tunnels where Squid only sees host:port. */
  url: string;
  firstSeenAt: number;
  waiters: Set<(verdict: string) => void>;
}

const pending = new Map<string, PendingEntry>();

/** Resolve all blocked helpers waiting on `requestId` with the given verdict. */
function settle(requestId: string, verdict: string): number {
  const entry = pending.get(requestId);
  if (!entry) return 0;
  pending.delete(requestId);
  const count = entry.waiters.size;
  for (const resolve of entry.waiters) resolve(verdict);
  return count;
}

async function postPending(req: Request): Promise<Response> {
  const body = await parsePostPendingPayload(req);
  if (typeof body === "string") {
    return Response.json({ error: body }, { status: 400 });
  }
  const { host, method, url } = body;

  const requestId = crypto.randomUUID();
  const entry: PendingEntry = {
    requestId,
    host,
    method,
    url,
    firstSeenAt: Date.now(),
    waiters: new Set(),
  };
  pending.set(requestId, entry);
  console.log(`[pending] ${requestId} ${method} ${url || host}`);

  return new Promise<Response>((resolve) => {
    const waiter = (verdict: string) =>
      resolve(Response.json({ requestId, verdict }));
    entry.waiters.add(waiter);

    // Drop this waiter if the helper hangs up (its curl timed out → fail-closed).
    req.signal.addEventListener("abort", () => {
      entry.waiters.delete(waiter);
      if (entry.waiters.size === 0) pending.delete(requestId);
    });
  });
}

function getPending(): Response {
  const list = [...pending.values()].map((e) => ({
    requestId: e.requestId,
    host: e.host,
    method: e.method,
    url: e.url,
    firstSeenAt: e.firstSeenAt,
    waiting: e.waiters.size,
  }));
  return Response.json({ pending: list });
}

async function postDecision(req: Request): Promise<Response> {
  const token = req.headers.get("x-approver-token");
  if (token !== TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await parsePostDecisionPayload(req);
  if (typeof body === "string") {
    return Response.json({ error: body }, { status: 400 });
  }
  const { requestId, verdict } = body;
  const resolved = settle(requestId, verdict);
  if (resolved === 0) {
    return Response.json({ error: "unknown requestId" }, { status: 404 });
  }
  console.log(`[decision] ${verdict} ${requestId} (resolved ${resolved})`);
  return Response.json({ requestId, verdict, resolved });
}

Bun.serve({
  port: PORT,
  maxRequestBodySize: 64 * 1024,
  routes: {
    "/health": new Response("OK"),
    "/pending": {
      GET: getPending,
      POST: postPending,
    },
    "/decision": {
      POST: postDecision,
    },
    "/*": new Response("not found", { status: 404 }),
  },
  error(err: Error): Response {
    console.error(err);
    return Response.json({ error: "internal server error" }, { status: 500 });
  },
});

const tokenSource = process.env.APPROVER_TOKEN
  ? "from APPROVER_TOKEN env"
  : `generated → ${TOKEN_FILE}`;
console.log(`approver listening on :${PORT} (token ${tokenSource})`);
