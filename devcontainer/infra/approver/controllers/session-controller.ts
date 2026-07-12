/**
 * Controller for the `/sessions` resource and its nested `/policies/{host}` sub-resource.
 * Body validation and host normalization live here; session lifecycle, TTL eviction, and
 * the policy map live in the session store. The store's result types carry the
 * session-vs-host distinction this controller maps onto status codes and messages.
 *
 * Built by {@link createSessionController}, which closes the handlers over their store
 * dependency so `server.ts` can inject the concrete (or, in tests, fake) store.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

import type { BunRequest } from "bun";
import { parseAllow } from "../core/http.ts";
import type { SessionStore } from "../data/session-store.ts";

/** The handler bundle the session controller exposes to the route table. */
export interface SessionController {
  /** POST /sessions/{id} — create a session. */
  postSession(req: BunRequest<"/sessions/:id">): Promise<Response>;
  /** GET /sessions/{id} — fetch a session. */
  getSession(req: BunRequest<"/sessions/:id">): Response;
  /** DELETE /sessions/{id} — forget a session. */
  deleteSession(req: BunRequest<"/sessions/:id">): Response;
  /** POST /sessions/{id}/policies/{host} — remember a per-host policy. */
  postSessionPolicy(
    req: BunRequest<"/sessions/:id/policies/:host">,
  ): Promise<Response>;
  /** GET /sessions/{id}/policies/{host} — fetch one remembered policy. */
  getSessionPolicy(
    req: BunRequest<"/sessions/:id/policies/:host">,
  ): Response;
  /** DELETE /sessions/{id}/policies/{host} — revoke one remembered policy. */
  deleteSessionPolicy(
    req: BunRequest<"/sessions/:id/policies/:host">,
  ): Response;
}

/**
 * Parse the optional `policies` array on a POST /sessions/{id} body into a validated
 * host → allow map. A later duplicate host wins (last-write); not an error.
 * @param value The raw `policies` field.
 * @returns A Map on success (empty when absent), or an error string for the caller.
 */
function parseSessionPolicies(value: unknown): Map<string, boolean> | string {
  const policies = new Map<string, boolean>();
  if (value === undefined || value === null) return policies;
  if (!Array.isArray(value)) return "policies must be an array";
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return "each policy must be an object";
    }
    const record = item as Record<string, unknown>;
    const rawHost = record.host;
    if (typeof rawHost !== "string") return "policy host must be a string";
    const host = rawHost.trim().toLowerCase();
    if (!host) return "policy host required";
    const allow = parseAllow(record.allow);
    if (allow === undefined) return "policy allow must be a boolean";
    policies.set(host, allow);
  }
  return policies;
}

/**
 * Build the session controller bound to its store dependency.
 * @param sessions Store of live sessions and their remembered policies.
 * @returns A {@link SessionController} handler bundle ready for the route table.
 */
export function createSessionController(
  sessions: SessionStore,
): SessionController {
  /**
   * POST /sessions/{id} — create a session, optionally pre-populated with policies.
   * Token-gated. The client supplies the id in the path. An empty or absent body
   * creates an empty session; a `{ policies: [...] }` body bulk-loads policies.
   * @param req The incoming request with params.id populated by Bun's router.
   * @returns 201 with the Session, 400 on malformed body, 409 if the id already exists.
   */
  async function postSession(
    req: BunRequest<"/sessions/:id">,
  ): Promise<Response> {
    const now = Date.now();
    // Existence is checked up front so a 409 preempts body-validation 400s, matching the
    // original precedence; create() re-checks atomically below.
    if (sessions.get(req.params.id, now)) {
      return Response.json(
        { error: "session already exists" },
        { status: 409 },
      );
    }

    // Body is all-optional, so tolerate an empty body (create an empty session).
    let body: Record<string, unknown> = {};
    const text = await req.text();
    if (text.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }
      if (typeof parsed !== "object" || parsed === null) {
        return Response.json(
          { error: "body must be a json object" },
          { status: 400 },
        );
      }
      body = parsed as Record<string, unknown>;
    }

    const policies = parseSessionPolicies(body.policies);
    if (typeof policies === "string") {
      return Response.json({ error: policies }, { status: 400 });
    }

    const session = sessions.create(req.params.id, policies, now);
    if (!session) {
      return Response.json(
        { error: "session already exists" },
        { status: 409 },
      );
    }
    return Response.json(session, { status: 201 });
  }

  /**
   * GET /sessions/{id} — fetch a session and its remembered policies.
   * Token-gated.
   * @param req The incoming request with params.id populated by Bun's router.
   * @returns 200 with the Session, or 404 if unknown or expired.
   */
  function getSession(req: BunRequest<"/sessions/:id">): Response {
    const session = sessions.get(req.params.id, Date.now());
    if (!session) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(session);
  }

  /**
   * DELETE /sessions/{id} — forget a session and all its policies.
   * Token-gated. This is the explicit "forget" primitive (and the extension's
   * best-effort cleanup on window close).
   * @param req The incoming request with params.id populated by Bun's router.
   * @returns 204 on delete, or 404 if unknown or already expired.
   */
  function deleteSession(req: BunRequest<"/sessions/:id">): Response {
    if (!sessions.delete(req.params.id, Date.now())) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  }

  /**
   * POST /sessions/{id}/policies/{host} — remember a per-host policy for a session.
   * Token-gated. Key (`host`) in the path, attribute (`allow`) in the body. Never
   * upserts the session: an unknown session is a 404. Re-adding an existing host is
   * a 409 — flip a policy via DELETE + POST.
   * @param req The incoming request with params.id and params.host populated by Bun's router.
   * @returns 201 with `{ session, host, allow }`, 400 on bad body, 404 no session, 409 host exists.
   */
  async function postSessionPolicy(
    req: BunRequest<"/sessions/:id/policies/:host">,
  ): Promise<Response> {
    const now = Date.now();
    // Session existence is checked before the body so a missing session (404) preempts
    // body-validation 400s, matching the original precedence; setPolicy re-checks below.
    if (!sessions.get(req.params.id, now)) {
      return Response.json({ error: "session not found" }, { status: 404 });
    }

    const host = req.params.host.trim().toLowerCase();
    if (!host) {
      return Response.json({ error: "host required" }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }
    if (typeof body !== "object" || body === null) {
      return Response.json(
        { error: "body must be a json object" },
        { status: 400 },
      );
    }
    const allow = parseAllow((body as Record<string, unknown>).allow);
    if (allow === undefined) {
      return Response.json(
        { error: "allow must be a boolean" },
        { status: 400 },
      );
    }

    const result = sessions.setPolicy(req.params.id, host, allow, now);
    if (!result.ok) {
      return result.reason === "no-session"
        ? Response.json({ error: "session not found" }, { status: 404 })
        : Response.json({ error: "policy already exists" }, { status: 409 });
    }
    return Response.json(result.policy, { status: 201 });
  }

  /**
   * GET /sessions/{id}/policies/{host} — fetch one remembered policy.
   * Token-gated.
   * @param req The incoming request with params.id and params.host populated by Bun's router.
   * @returns 200 with `{ session, host, allow }`, or 404 if the session or host is unknown.
   */
  function getSessionPolicy(
    req: BunRequest<"/sessions/:id/policies/:host">,
  ): Response {
    const host = req.params.host.trim().toLowerCase();
    const result = sessions.getPolicy(req.params.id, host, Date.now());
    if (!result.ok) {
      return result.reason === "no-session"
        ? Response.json({ error: "session not found" }, { status: 404 })
        : Response.json({ error: "not found" }, { status: 404 });
    }
    return Response.json(result.policy);
  }

  /**
   * DELETE /sessions/{id}/policies/{host} — revoke one remembered policy.
   * Token-gated.
   * @param req The incoming request with params.id and params.host populated by Bun's router.
   * @returns 204 on delete, or 404 if the session or host is unknown.
   */
  function deleteSessionPolicy(
    req: BunRequest<"/sessions/:id/policies/:host">,
  ): Response {
    const host = req.params.host.trim().toLowerCase();
    const result = sessions.deletePolicy(req.params.id, host, Date.now());
    if (!result.ok) {
      return result.reason === "no-session"
        ? Response.json({ error: "session not found" }, { status: 404 })
        : Response.json({ error: "not found" }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  }

  return {
    postSession,
    getSession,
    deleteSession,
    postSessionPolicy,
    getSessionPolicy,
    deleteSessionPolicy,
  };
}
