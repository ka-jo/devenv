/**
 * Egress approval broker. Implements the pinned protocol in PROTOCOL.md.
 *
 * Squid's external_acl helper submits egress requests via `POST /requests` and blocks
 * until a terminal verdict is reached. The host-side VS Code extension observes pending
 * requests via `GET /requests` (SSE stream or JSON snapshot), issues verdicts via
 * `PATCH /requests/{id}`, manages firewall domain lists via `POST /domains`, manages
 * per-session policy via `/sessions/{id}`, and retrieves the token out-of-band from tmpfs.
 *
 * The approver is the policy engine: `POST /requests` short-circuits to a remembered
 * verdict when `(sessionId, host)` matches stored session policy, never prompting a human.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import type { BunRequest } from "bun";

/** Reusable encoder for SSE frame serialization. */
const encoder: TextEncoder = new TextEncoder();

/** @internal */
const PORT = Number(process.env.APPROVER_PORT) || 3129;

/**
 * Absolute paths to the two domain list files, bind-mounted from the host's
 * `.devcontainer/firewall/` directory. The firewall container holds the same
 * host inodes read-only; inotify there fires when the approver writes here.
 * @internal
 */
const DOMAIN_LIST_PATHS: Record<"allowed" | "denied", string> = {
  allowed:
    process.env.ALLOWED_DOMAINS_FILE ?? "/etc/approver/allowed_domains.txt",
  denied:
    process.env.DENIED_DOMAINS_FILE ?? "/etc/approver/denied_domains.txt",
};

/**
 * Header prepended when bootstrapping a domain list file that does not yet exist.
 * Mirrors the header written by `devenv devcontainer` for each list type.
 * @internal
 */
const DOMAIN_LIST_HEADERS: Record<"allowed" | "denied", string> = {
  allowed:
    "# Allow list — domains permitted through the egress firewall.\n" +
    "# One entry per line. Leading \".\" matches all subdomains (e.g. .example.com allows sub.example.com).\n" +
    "# Edit from the host; the firewall sidecar live-reloads on change.\n",
  denied:
    "# Deny list — domains blocked before the approval flow.\n" +
    "# One entry per line. Leading \".\" matches all subdomains (e.g. .example.com blocks sub.example.com).\n" +
    "# Edit from the host; the firewall sidecar live-reloads on change.\n",
};

/**
 * Shared secret gating token-gated endpoints (GET /requests, GET /requests/{id}, PATCH /requests/{id}).
 * Prefer an explicit `APPROVER_TOKEN` (lets the operator pin one for tests); otherwise mint a
 * fresh 256-bit token per process start. Generating it here — rather than sourcing it from a
 * host file — keeps the secret out of the project tree the sandboxed app container bind-mounts,
 * so a rogue process there can never read it. The host retrieves a generated token out-of-band
 * via `docker compose exec approver cat ${@link TOKEN_FILE}`.
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
// the `x-approver-token` header on `GET /requests` and `PATCH /requests/{id}`.
// It must NOT expect the token in .devcontainer/.env — that path was removed so
// the secret stays out of the app container's bind-mounted workspace. Token
// rotates each container start, so fetch it per session rather than caching.

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

/**
 * Opaque, proxy-supplied request metadata. Never used as a key; render-only.
 * The envelope (id, status, createdAt, decidedAt) is stable; metadata evolves.
 */
interface RequestMetadata {
  /** Trimmed, lowercased target hostname. */
  host: string;
  /** Uppercased HTTP method, or "" when the helper omitted it. */
  method: string;
  /** Full request URL when available (plain HTTP); "" for HTTPS CONNECT tunnels. */
  url: string;
  /**
   * The Claude session this egress is attributed to, decoded by the proxy adapter
   * from the client's Proxy-Authorization token, or "" when untagged (anonymous).
   * The approver keys per-session policy on it: a matching `(sessionId, host)` entry
   * short-circuits `POST /requests` to the remembered verdict. Attribution only — a
   * process can forge or drop the token, so it is never a trust boundary. See PROTOCOL.md.
   */
  sessionId: string;
}

/** Request lifecycle state: pending is non-terminal; the rest are terminal and immutable. */
type RequestStatus = "pending" | "allowed" | "denied" | "expired";

/** A human/remembered verdict. The vocabulary shared by verdicts, domain lists, and session policy. */
type Policy = "allowed" | "denied";

/**
 * The one request representation — used in REST JSON bodies, SSE snapshot/added frames,
 * and client parsers. Byte-identical across all representations.
 */
interface EgressRequest {
  /** UUID correlation key; never derived from request content. */
  id: string;
  /** Current lifecycle state. Always "pending" in stream snapshot/added frames. */
  status: RequestStatus;
  /** Opaque, proxy-supplied, render-only. The evolving part of the contract. */
  metadata: RequestMetadata;
  /** Epoch ms when the request entered pending. */
  createdAt: number;
  /** Epoch ms when the request reached a terminal state; present iff status !== "pending". */
  decidedAt?: number;
}

/** Payload of a resolved SSE frame. Lean delta: client already has metadata keyed by id. */
interface ResolvedFrame {
  /** Unique request ID. */
  id: string;
  /** Terminal status: allowed/denied (from PATCH) or expired (system timeout). */
  status: "allowed" | "denied" | "expired";
  /** Epoch ms when the request transitioned to terminal state. */
  decidedAt: number;
}

/**
 * Parse and validate a POST /requests body.
 * `host` is required; `method` and `url` are optional and coerced leniently.
 * @param req The incoming request.
 * @returns A {@link RequestMetadata} on success, or an error string for the caller to return verbatim.
 */
async function parseRequestMetadata(
  req: Request,
): Promise<RequestMetadata | string> {
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

  const rawSessionId = body.sessionId;
  const sessionId =
    typeof rawSessionId === "string" ? rawSessionId.trim() : "";

  return { host, method, url, sessionId };
}

/**
 * Parse and validate a PATCH /requests/{id} body.
 * Only "allowed" and "denied" are accepted; "expired" is system-only.
 * @param req The incoming request.
 * @returns An object with the terminal status on success, or an error string.
 */
async function parsePatchVerdictBody(
  req: Request,
): Promise<{ status: "allowed" | "denied" } | string> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return "invalid json";
  }
  if (typeof body !== "object" || body === null) {
    return "body must be a json object";
  }

  const rawStatus = body.status;
  if (typeof rawStatus !== "string") return "status must be a string";
  const status = rawStatus.trim().toLowerCase();
  if (status !== "allowed" && status !== "denied") {
    return "status must be 'allowed' or 'denied'";
  }

  return { status: status as "allowed" | "denied" };
}

/**
 * In-flight request state. Holds the request envelope, metadata, and waiters.
 * Waiters are promise resolvers from blocked POST /requests calls awaiting a verdict.
 */
interface RequestEntry {
  /** The immutable envelope. */
  request: EgressRequest;
  /** Promise resolvers waiting on this request's terminal state. */
  waiters: Set<(resolved: EgressRequest) => void>;
}

/** In-process map of all requests (pending + terminal, evicted after resolution). */
const requests = new Map<string, RequestEntry>();

/** Set of SSE stream controllers for broadcasting. Cleaned up on client disconnect. */
const streamControllers = new Set<
  ReadableStreamDefaultController<Uint8Array>
>();

/**
 * Resolve all blocked helpers and SSE subscribers on a request reaching terminal state.
 * Updates the request to terminal, removes it from the map, and triggers both waiters
 * and SSE broadcast.
 * @param id The request ID.
 * @param status The new terminal status (allowed/denied/expired).
 * @returns The terminal {@link EgressRequest}, or undefined if id was unknown.
 */
function settle(
  id: string,
  status: "allowed" | "denied" | "expired",
): EgressRequest | undefined {
  const entry = requests.get(id);
  if (!entry) return undefined;

  const decidedAt = Date.now();
  entry.request.status = status;
  entry.request.decidedAt = decidedAt;

  requests.delete(id);

  // Resolve all blocked POST /requests callers.
  const resolved = entry.request;
  for (const waiter of entry.waiters) waiter(resolved);
  entry.waiters.clear();

  // Broadcast to all SSE subscribers.
  const frame: ResolvedFrame = { id, status, decidedAt };
  broadcastResolved(frame);

  return resolved;
}

/**
 * Safely encode and send an SSE frame to a stream controller.
 * If the controller's connection is dead (enqueue throws), removes it from
 * streamControllers and suppresses the error to allow broadcasting to continue.
 * @param controller The stream controller to write to.
 * @param event The event type.
 * @param data The JSON data payload.
 */
function emitSseFrame(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown,
): void {
  const encoded: Uint8Array = encoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
  try {
    controller.enqueue(encoded);
  } catch {
    // Client disconnected; remove from broadcasters and continue.
    streamControllers.delete(controller);
  }
}

/**
 * Safely emit a raw SSE keepalive comment to a stream controller.
 * If the controller's connection is dead, removes it from streamControllers
 * and suppresses the error.
 * @param controller The stream controller to write to.
 */
function emitSseKeepalive(
  controller: ReadableStreamDefaultController<Uint8Array>,
): void {
  const keepaliveEncoded: Uint8Array = encoder.encode(": keepalive\n\n");
  try {
    controller.enqueue(keepaliveEncoded);
  } catch {
    // Client disconnected; remove from broadcasters and continue.
    streamControllers.delete(controller);
  }
}

/**
 * Send a resolved frame (lean delta) to all connected SSE subscribers.
 * If a subscriber's connection is dead, silently removes it and continues.
 * @param frame The resolved frame data.
 */
function broadcastResolved(frame: ResolvedFrame): void {
  for (const controller of streamControllers) {
    emitSseFrame(controller, "resolved", frame);
  }
}

/**
 * Send an added frame to all connected SSE subscribers.
 * If a subscriber's connection is dead, silently removes it and continues.
 * @param request The newly-created pending request.
 */
function broadcastAdded(request: EgressRequest): void {
  for (const controller of streamControllers) {
    emitSseFrame(controller, "added", request);
  }
}

/**
 * Get all requests filtered by optional status. Used for snapshots and the
 * JSON response of GET /requests.
 * @param filterStatus Optional status filter; if present, only that status is included.
 * @returns Array of requests matching the filter.
 */
function getRequestsSnapshot(filterStatus?: RequestStatus): EgressRequest[] {
  const results: EgressRequest[] = [];
  for (const entry of requests.values()) {
    if (!filterStatus || entry.request.status === filterStatus) {
      results.push(entry.request);
    }
  }
  return results;
}

/**
 * In-memory per-session policy. A session is a bag of remembered `(host → policy)`
 * verdicts keyed by `sessionId`. State is process-memory only — never persisted —
 * and dies with the container, which is the natural bound for a session (the Claude
 * session runs inside that container). See PROTOCOL.md `/sessions`.
 */
interface SessionEntry {
  /** The session id (mirrors the map key). */
  id: string;
  /** Remembered per-host verdicts. */
  domains: Map<string, Policy>;
  /** Epoch ms the session was created. */
  createdAt: number;
  /** Epoch ms of the last approver-visible activity; refreshed by matching POST /requests. */
  lastSeen: number;
}

/** Idle-sliding eviction window. A session untouched this long is reaped. @internal */
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** How often the periodic sweep runs to reap idle sessions. @internal */
const SESSION_SWEEP_MS = 10 * 60 * 1000;

/** In-process map of live sessions, keyed by sessionId. */
const sessions = new Map<string, SessionEntry>();

/**
 * Fetch a session if it exists and has not idled past the TTL, lazily evicting it
 * if it has. Side-effect-free apart from that eviction; does NOT refresh `lastSeen`
 * (only session-attributed request traffic does, in {@link postRequests}).
 * @param id The session id.
 * @param now Current epoch ms.
 * @returns The live {@link SessionEntry}, or undefined if unknown or expired.
 */
function getLiveSession(id: string, now: number): SessionEntry | undefined {
  const entry = sessions.get(id);
  if (!entry) return undefined;
  if (now - entry.lastSeen > SESSION_TTL_MS) {
    sessions.delete(id);
    console.log(`[session] evicted ${id} (idle > ${SESSION_TTL_MS}ms)`);
    return undefined;
  }
  return entry;
}

/**
 * Periodic backstop reaping sessions idle past the TTL, so idle entries don't
 * accumulate between lazy accesses.
 */
function sweepSessions(): void {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.lastSeen > SESSION_TTL_MS) {
      sessions.delete(id);
      console.log(`[session] swept ${id} (idle > ${SESSION_TTL_MS}ms)`);
    }
  }
}

/**
 * Serialize a session for a JSON response. Materializes the domain map as an array.
 * @param entry The session entry.
 * @returns A plain object matching the `Session` shape in PROTOCOL.md.
 */
function sessionToJson(entry: SessionEntry): {
  id: string;
  domains: { host: string; policy: Policy }[];
  createdAt: number;
  lastSeen: number;
} {
  const domains = Array.from(entry.domains, ([host, policy]) => ({
    host,
    policy,
  }));
  return {
    id: entry.id,
    domains,
    createdAt: entry.createdAt,
    lastSeen: entry.lastSeen,
  };
}

/**
 * POST /requests — create and await verdict.
 * The proxy helper's sole call. Normally blocks until the request reaches a terminal
 * state. If session policy matches `(sessionId, host)`, settles immediately to the
 * remembered verdict without ever entering pending or prompting a human.
 * Returns the terminal EgressRequest on success, or 400 on malformed body.
 * If the client aborts before a verdict lands, the request transitions to expired.
 */
async function postRequests(req: Request): Promise<Response> {
  const body = await parseRequestMetadata(req);
  if (typeof body === "string") {
    return Response.json({ error: body }, { status: 400 });
  }
  const metadata = body;

  const id = crypto.randomUUID();
  const now = Date.now();

  // Session-policy short-circuit. Any request carrying a known session refreshes its
  // idle clock; a remembered verdict for this host settles the request at once.
  if (metadata.sessionId) {
    const session = getLiveSession(metadata.sessionId, now);
    if (session) {
      session.lastSeen = now;
      const policy = session.domains.get(metadata.host);
      if (policy) {
        const settled: EgressRequest = {
          id,
          status: policy,
          metadata,
          createdAt: now,
          decidedAt: now,
        };
        console.log(
          `[session-${policy}] ${id} [${metadata.sessionId}] ${metadata.host}`,
        );
        return Response.json(settled);
      }
    }
  }

  const request: EgressRequest = {
    id,
    status: "pending",
    metadata,
    createdAt: now,
  };
  const entry: RequestEntry = {
    request,
    waiters: new Set(),
  };
  requests.set(id, entry);
  console.log(
    `[request] ${id} [${metadata.sessionId || "anon"}] ${metadata.method} ${metadata.url || metadata.host}`,
  );

  // Broadcast to all SSE subscribers.
  broadcastAdded(request);

  return new Promise<Response>((resolve) => {
    const waiter = (terminal: EgressRequest) =>
      resolve(Response.json(terminal));
    entry.waiters.add(waiter);

    // If the helper hangs up (its curl timed out), transition to expired and settle.
    req.signal.addEventListener("abort", () => {
      entry.waiters.delete(waiter);
      // If no more waiters, mark as expired and broadcast. Otherwise, other waiters
      // are still blocked; let them finish.
      if (entry.waiters.size === 0) {
        const expired = settle(id, "expired");
        if (expired) {
          console.log(`[expired] ${id} (client abort)`);
        }
      }
    });
  });
}

/**
 * Validate whether a string is a known request status.
 * @param value The value to check.
 * @returns true if value is a known status, false otherwise.
 */
function isKnownStatus(value: unknown): value is RequestStatus {
  return (
    value === "pending" ||
    value === "allowed" ||
    value === "denied" ||
    value === "expired"
  );
}

/**
 * GET /requests — list (snapshot) or stream.
 * Token-gated. Content-negotiated on Accept header:
 * - application/json (default): snapshot with optional ?status filter.
 * - text/event-stream: live SSE stream with snapshot, added, resolved frames.
 * Returns 400 if ?status is present but invalid.
 */
function getRequests(req: Request): Response {
  const accept = req.headers.get("accept") || "application/json";

  if (accept.includes("text/event-stream")) {
    return handleGetRequestsSSE();
  }

  // JSON snapshot.
  const url = new URL(req.url);
  const statusParam: string | null = url.searchParams.get("status");

  let filterStatus: RequestStatus | undefined;
  if (statusParam !== null) {
    if (!isKnownStatus(statusParam)) {
      return Response.json({ error: "invalid status filter" }, { status: 400 });
    }
    filterStatus = statusParam;
  }

  const snapshot = getRequestsSnapshot(filterStatus);
  return Response.json({ requests: snapshot });
}

/**
 * Handle GET /requests with Accept: text/event-stream.
 * Emits a snapshot frame, registers the controller for broadcasts, and emits
 * keepalives every ~20s until the client disconnects. If a keepalive fails
 * (client disconnected), clears the interval and removes the controller.
 */
function handleGetRequestsSSE(): Response {
  let keepaliveInterval: Timer | null = null;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(ctrl: ReadableStreamDefaultController<Uint8Array>): void {
      controller = ctrl;
      // Snapshot and register atomically: no await between.
      const snapshot = getRequestsSnapshot();
      emitSseFrame(ctrl, "snapshot", { requests: snapshot });
      streamControllers.add(ctrl);

      // Keepalive every ~20s.
      keepaliveInterval = setInterval(() => {
        if (ctrl) {
          emitSseKeepalive(ctrl);
        }
      }, 20_000);
    },

    cancel(): void {
      // Client disconnected; clean up.
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      if (controller) streamControllers.delete(controller);
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

/**
 * GET /requests/{id} — fetch a single request.
 * Token-gated. Returns 200 with the EgressRequest, or 404 if unknown.
 * @param req The incoming request with params.id populated by Bun's router.
 * @returns A Response with the request data or a 404 error.
 */
function getRequest(req: BunRequest<"/requests/:id">): Response {
  const id = req.params.id;
  const entry = requests.get(id);
  if (!entry) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json(entry.request);
}

/**
 * PATCH /requests/{id} — issue a verdict.
 * Token-gated. Only "allowed" and "denied" are accepted; "expired" is system-only.
 * Returns 200 with the terminal EgressRequest, or 400/404/409 per protocol.
 * @param req The incoming request with params.id populated by Bun's router.
 * @returns A Response with the terminal request or an error.
 */
async function patchRequest(
  req: BunRequest<"/requests/:id">,
): Promise<Response> {
  const id = req.params.id;
  const entry = requests.get(id);
  if (!entry) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  // Refuse to transition out of terminal states.
  if (entry.request.status !== "pending") {
    return Response.json({ error: "already terminal" }, { status: 409 });
  }

  const body = await parsePatchVerdictBody(req);
  if (typeof body === "string") {
    return Response.json({ error: body }, { status: 400 });
  }
  const { status } = body;

  const terminal = settle(id, status);
  console.log(`[verdict] ${status} ${id}`);

  return Response.json(terminal);
}

/**
 * POST /domains — append a host to a firewall domain list.
 * Token-gated. The list is selected by the `policy` field in the body (not a path
 * segment), so the payload matches session policy's `{ host, policy }` shape.
 * Idempotent: returns `200` even if the host is already present. Creates the file
 * with a standard header if it does not yet exist (handles projects set up before
 * the denied list was added to the template).
 *
 * @param req The incoming request.
 * @returns 200 on success, 400 on bad input, 401 on bad token.
 */
async function postDomainEntry(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "body must be a json object" }, { status: 400 });
  }

  const rawHost = body.host;
  if (typeof rawHost !== "string") {
    return Response.json({ error: "host must be a string" }, { status: 400 });
  }
  const host = rawHost.trim().toLowerCase();
  if (!host) {
    return Response.json({ error: "host required" }, { status: 400 });
  }

  const policy = parsePolicy(body.policy);
  if (!policy) {
    return Response.json(
      { error: "policy must be 'allowed' or 'denied'" },
      { status: 400 },
    );
  }

  const filePath = DOMAIN_LIST_PATHS[policy];

  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    // File doesn't exist yet (project predates this list being added to the template).
    // Bootstrap it with the standard header so the firewall sidecar can parse it.
    content = DOMAIN_LIST_HEADERS[policy];
    console.log(`[domain-list] created ${filePath}`);
  }

  const lines = content.split("\n");
  if (lines.some((l) => l.trim() === host)) {
    return Response.json({ added: false, reason: "already present" });
  }

  const updated = content.endsWith("\n")
    ? `${content}${host}\n`
    : `${content}\n${host}\n`;

  await writeFile(filePath, updated, "utf8");
  console.log(`[domain-list] ${policy} ← ${host}`);

  return Response.json({ added: true });
}

/**
 * Coerce an unknown value to a {@link Policy}, or undefined when it is not valid.
 * @param value The raw value (typically a request body field).
 * @returns "allowed" | "denied", or undefined when invalid.
 */
function parsePolicy(value: unknown): Policy | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  return v === "allowed" || v === "denied" ? v : undefined;
}

/**
 * Parse the optional `domains` array on a POST /sessions/{id} body into a validated
 * host → policy map. A later duplicate host wins (last-write); not an error.
 * @param value The raw `domains` field.
 * @returns A Map on success (empty when absent), or an error string for the caller.
 */
function parseSessionDomains(value: unknown): Map<string, Policy> | string {
  const domains = new Map<string, Policy>();
  if (value === undefined || value === null) return domains;
  if (!Array.isArray(value)) return "domains must be an array";
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return "each domain must be an object";
    }
    const record = item as Record<string, unknown>;
    const rawHost = record.host;
    if (typeof rawHost !== "string") return "domain host must be a string";
    const host = rawHost.trim().toLowerCase();
    if (!host) return "domain host required";
    const policy = parsePolicy(record.policy);
    if (!policy) return "domain policy must be 'allowed' or 'denied'";
    domains.set(host, policy);
  }
  return domains;
}

/**
 * POST /sessions/{id} — create a session, optionally pre-populated with domains.
 * Token-gated. The client supplies the id in the path. An empty or absent body
 * creates an empty session; a `{ domains: [...] }` body bulk-loads policies.
 * @param req The incoming request with params.id populated by Bun's router.
 * @returns 201 with the Session, 400 on malformed body, 409 if the id already exists.
 */
async function postSession(
  req: BunRequest<"/sessions/:id">,
): Promise<Response> {
  const id = req.params.id;
  const now = Date.now();
  if (getLiveSession(id, now)) {
    return Response.json({ error: "session already exists" }, { status: 409 });
  }

  // Body is all-optional, so tolerate an empty body (create an empty session).
  let body: Record<string, unknown> = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }
    if (typeof body !== "object" || body === null) {
      return Response.json(
        { error: "body must be a json object" },
        { status: 400 },
      );
    }
  }

  const domains = parseSessionDomains(body.domains);
  if (typeof domains === "string") {
    return Response.json({ error: domains }, { status: 400 });
  }

  const entry: SessionEntry = { id, domains, createdAt: now, lastSeen: now };
  sessions.set(id, entry);
  console.log(`[session] created ${id} (${domains.size} domain(s))`);
  return Response.json(sessionToJson(entry), { status: 201 });
}

/**
 * GET /sessions/{id} — fetch a session and its remembered domains.
 * Token-gated.
 * @param req The incoming request with params.id populated by Bun's router.
 * @returns 200 with the Session, or 404 if unknown or expired.
 */
function getSession(req: BunRequest<"/sessions/:id">): Response {
  const entry = getLiveSession(req.params.id, Date.now());
  if (!entry) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(sessionToJson(entry));
}

/**
 * DELETE /sessions/{id} — forget a session and all its policies.
 * Token-gated. This is the explicit "forget" primitive (and the extension's
 * best-effort cleanup on window close).
 * @param req The incoming request with params.id populated by Bun's router.
 * @returns 204 on delete, or 404 if unknown or already expired.
 */
function deleteSession(req: BunRequest<"/sessions/:id">): Response {
  const id = req.params.id;
  if (!getLiveSession(id, Date.now())) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  sessions.delete(id);
  console.log(`[session] deleted ${id}`);
  return new Response(null, { status: 204 });
}

/**
 * POST /sessions/{id}/domains/{host} — remember a per-host verdict for a session.
 * Token-gated. Key (`host`) in the path, attribute (`policy`) in the body. Never
 * upserts the session: an unknown session is a 404. Re-adding an existing host is
 * a 409 — flip a policy via DELETE + POST.
 * @param req The incoming request with params.id and params.host populated by Bun's router.
 * @returns 201 with `{ host, policy }`, 400 on bad body, 404 no session, 409 host exists.
 */
async function postSessionDomain(
  req: BunRequest<"/sessions/:id/domains/:host">,
): Promise<Response> {
  const session = getLiveSession(req.params.id, Date.now());
  if (!session) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }
  const host = req.params.host.trim().toLowerCase();
  if (!host) {
    return Response.json({ error: "host required" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json(
      { error: "body must be a json object" },
      { status: 400 },
    );
  }
  const policy = parsePolicy(body.policy);
  if (!policy) {
    return Response.json(
      { error: "policy must be 'allowed' or 'denied'" },
      { status: 400 },
    );
  }

  if (session.domains.has(host)) {
    return Response.json({ error: "domain already exists" }, { status: 409 });
  }

  session.domains.set(host, policy);
  console.log(`[session] ${req.params.id} ${host} ← ${policy}`);
  return Response.json({ host, policy }, { status: 201 });
}

/**
 * GET /sessions/{id}/domains/{host} — fetch one remembered verdict.
 * Token-gated.
 * @param req The incoming request with params.id and params.host populated by Bun's router.
 * @returns 200 with `{ host, policy }`, or 404 if the session or host is unknown.
 */
function getSessionDomain(
  req: BunRequest<"/sessions/:id/domains/:host">,
): Response {
  const session = getLiveSession(req.params.id, Date.now());
  if (!session) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }
  const host = req.params.host.trim().toLowerCase();
  const policy = session.domains.get(host);
  if (!policy) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ host, policy });
}

/**
 * DELETE /sessions/{id}/domains/{host} — revoke one remembered verdict.
 * Token-gated.
 * @param req The incoming request with params.id and params.host populated by Bun's router.
 * @returns 204 on delete, or 404 if the session or host is unknown.
 */
function deleteSessionDomain(
  req: BunRequest<"/sessions/:id/domains/:host">,
): Response {
  const session = getLiveSession(req.params.id, Date.now());
  if (!session) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }
  const host = req.params.host.trim().toLowerCase();
  if (!session.domains.delete(host)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  console.log(`[session] ${req.params.id} ${host} removed`);
  return new Response(null, { status: 204 });
}

/**
 * Auth helper: reject with 401 if x-approver-token !== TOKEN.
 * Used by every token-gated endpoint: GET /requests, GET /requests/{id},
 * PATCH /requests/{id}, POST /domains, and all /sessions routes.
 */
function requireToken(req: Request): Response | null {
  const token = req.headers.get("x-approver-token");
  if (token !== TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

Bun.serve({
  port: PORT,
  maxRequestBodySize: 64 * 1024,
  routes: {
    "/health": new Response("OK"),
    "/requests": {
      POST: postRequests,
      GET: (req: Request): Response => {
        const authErr = requireToken(req);
        if (authErr) return authErr;
        return getRequests(req);
      },
    },
    "/requests/:id": {
      GET: (req: BunRequest<"/requests/:id">): Response => {
        const authErr = requireToken(req);
        if (authErr) return authErr;
        return getRequest(req);
      },
      PATCH: async (req: BunRequest<"/requests/:id">): Promise<Response> => {
        const authErr = requireToken(req);
        if (authErr) return authErr;
        return patchRequest(req);
      },
    },
    "/domains": {
      POST: async (req: Request): Promise<Response> => {
        const authErr = requireToken(req);
        if (authErr) return authErr;
        return postDomainEntry(req);
      },
    },
    "/sessions/:id": {
      POST: async (req: BunRequest<"/sessions/:id">): Promise<Response> => {
        const authErr = requireToken(req);
        if (authErr) return authErr;
        return postSession(req);
      },
      GET: (req: BunRequest<"/sessions/:id">): Response => {
        const authErr = requireToken(req);
        if (authErr) return authErr;
        return getSession(req);
      },
      DELETE: (req: BunRequest<"/sessions/:id">): Response => {
        const authErr = requireToken(req);
        if (authErr) return authErr;
        return deleteSession(req);
      },
    },
    "/sessions/:id/domains/:host": {
      POST: async (
        req: BunRequest<"/sessions/:id/domains/:host">,
      ): Promise<Response> => {
        const authErr = requireToken(req);
        if (authErr) return authErr;
        return postSessionDomain(req);
      },
      GET: (req: BunRequest<"/sessions/:id/domains/:host">): Response => {
        const authErr = requireToken(req);
        if (authErr) return authErr;
        return getSessionDomain(req);
      },
      DELETE: (req: BunRequest<"/sessions/:id/domains/:host">): Response => {
        const authErr = requireToken(req);
        if (authErr) return authErr;
        return deleteSessionDomain(req);
      },
    },
    "/*": new Response("not found", { status: 404 }),
  },
  error(err: Error): Response {
    console.error(err);
    return Response.json({ error: "internal server error" }, { status: 500 });
  },
});

// Idle-session reaper. Lazy eviction on access covers most cases; this sweep stops
// idle sessions accumulating between accesses. unref so it never keeps the process alive.
const sessionSweepTimer: Timer = setInterval(sweepSessions, SESSION_SWEEP_MS);
sessionSweepTimer.unref();

const tokenSource = process.env.APPROVER_TOKEN
  ? "from APPROVER_TOKEN env"
  : `generated → ${TOKEN_FILE}`;
console.log(`approver listening on :${PORT} (token ${tokenSource})`);
