/**
 * Controller for the `/requests` resource: create-and-await (the proxy helper's sole call),
 * list/stream for the host-side decider, single fetch, and verdict. Validation of request
 * bodies lives here; lifecycle state and SSE broadcasting live in the request store and SSE
 * hub. The session short-circuit is delegated to the session store.
 *
 * Built by {@link createRequestController}, which closes the handlers over their store
 * dependencies so `server.ts` can inject the concrete (or, in tests, fake) stores.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

import type { BunRequest } from "bun";
import { parseJsonObject } from "../core/http.ts";
import type { RequestStore } from "../data/request-store.ts";
import type { SessionStore } from "../data/session-store.ts";
import {
  emitSseFrame,
  emitSseKeepalive,
  streamControllers,
} from "../core/sse.ts";
import type { EgressRequest } from "../types/egress-request.ts";
import type { RequestMetadata } from "../types/request-metadata.ts";
import type { RequestStatus } from "../types/request-status.ts";
import type { Verdict } from "../types/verdict.ts";

/** The handler bundle the request controller exposes to the route table. */
export interface RequestController {
  /** POST /requests — create and await verdict. */
  postRequests(req: Request): Promise<Response>;
  /** GET /requests — JSON snapshot or SSE stream. */
  getRequests(req: Request): Response;
  /** GET /requests/{id} — fetch a single request. */
  getRequest(req: BunRequest<"/requests/:id">): Response;
  /** PATCH /requests/{id} — issue a verdict. */
  patchRequest(req: BunRequest<"/requests/:id">): Promise<Response>;
}

/**
 * Parse and validate a POST /requests body.
 * `host` is required; `method`, `url`, and `sessionId` are optional and coerced leniently.
 * @param req The incoming request.
 * @returns A {@link RequestMetadata} on success, or an error string for the caller to return verbatim.
 */
async function parseRequestMetadata(
  req: Request,
): Promise<RequestMetadata | string> {
  const body = await parseJsonObject(req);
  if (typeof body === "string") return body;

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
): Promise<{ status: Verdict } | string> {
  const body = await parseJsonObject(req);
  if (typeof body === "string") return body;

  const rawStatus = body.status;
  if (typeof rawStatus !== "string") return "status must be a string";
  const status = rawStatus.trim().toLowerCase();
  if (status !== "allowed" && status !== "denied") {
    return "status must be 'allowed' or 'denied'";
  }

  return { status };
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
 * Build the request controller bound to its store dependencies.
 * @param requests Store of in-flight requests.
 * @param sessions Session store, consulted for the policy short-circuit.
 * @returns A {@link RequestController} handler bundle ready for the route table.
 */
export function createRequestController(
  requests: RequestStore,
  sessions: SessionStore,
): RequestController {
  /**
   * POST /requests — create and await verdict.
   * The proxy helper's sole call. Normally blocks until the request reaches a terminal
   * state. If session policy matches `(sessionId, host)`, settles immediately to the
   * remembered verdict without ever entering pending or prompting a human.
   * Returns the terminal EgressRequest on success, or 400 on malformed body.
   * If the client aborts before a verdict lands, the request transitions to expired.
   * @param req The incoming request.
   * @returns A Response carrying the terminal request, or a 400.
   */
  async function postRequests(req: Request): Promise<Response> {
    const metadata = await parseRequestMetadata(req);
    if (typeof metadata === "string") {
      return Response.json({ error: metadata }, { status: 400 });
    }

    const now = Date.now();

    // Session-policy short-circuit. A remembered verdict for this host settles the request
    // at once (and refreshes the session's idle clock); no pending state, no human prompt.
    if (metadata.sessionId) {
      const allow = sessions.resolvePolicy(metadata.sessionId, metadata.host, now);
      if (allow !== undefined) {
        const status: Verdict = allow ? "allowed" : "denied";
        const settled: EgressRequest = {
          id: crypto.randomUUID(),
          status,
          metadata,
          createdAt: now,
          decidedAt: now,
        };
        console.log(
          `[session-${status}] ${settled.id} [${metadata.sessionId}] ${metadata.host}`,
        );
        return Response.json(settled);
      }
    }

    const entry = requests.create(metadata);
    const { id } = entry.request;
    console.log(
      `[request] ${id} [${metadata.sessionId || "anon"}] ${metadata.method} ${metadata.url || metadata.host}`,
    );

    return new Promise<Response>((resolve) => {
      const waiter = (terminal: EgressRequest): void => {
        resolve(Response.json(terminal));
      };
      entry.waiters.add(waiter);

      // If the helper hangs up (its curl timed out), transition to expired and settle.
      req.signal.addEventListener("abort", () => {
        entry.waiters.delete(waiter);
        // If no more waiters, mark as expired and broadcast. Otherwise, other waiters
        // are still blocked; let them finish.
        if (entry.waiters.size === 0) {
          const expired = requests.settle(id, "expired");
          if (expired) {
            console.log(`[expired] ${id} (client abort)`);
          }
        }
      });
    });
  }

  /**
   * GET /requests — list (snapshot) or stream.
   * Token-gated. Content-negotiated on Accept header:
   * - application/json (default): snapshot with optional ?status filter.
   * - text/event-stream: live SSE stream with snapshot, added, resolved frames.
   * Returns 400 if ?status is present but invalid.
   * @param req The incoming request.
   * @returns A JSON snapshot, an SSE stream, or a 400.
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
        return Response.json(
          { error: "invalid status filter" },
          { status: 400 },
        );
      }
      filterStatus = statusParam;
    }

    const snapshot = requests.snapshot(filterStatus);
    return Response.json({ requests: snapshot });
  }

  /**
   * Handle GET /requests with Accept: text/event-stream.
   * Emits a snapshot frame, registers the controller for broadcasts, and emits
   * keepalives every ~20s until the client disconnects. If a keepalive fails
   * (client disconnected), clears the interval and removes the controller.
   * @returns A streaming Response.
   */
  function handleGetRequestsSSE(): Response {
    let keepaliveInterval: Timer | null = null;
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

    const body = new ReadableStream<Uint8Array>({
      start(ctrl: ReadableStreamDefaultController<Uint8Array>): void {
        controller = ctrl;
        // Snapshot and register atomically: no await between.
        const snapshot = requests.snapshot();
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
    const entry = requests.get(req.params.id);
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

    const terminal = requests.settle(id, body.status);
    console.log(`[verdict] ${body.status} ${id}`);

    return Response.json(terminal);
  }

  return { postRequests, getRequests, getRequest, patchRequest };
}
