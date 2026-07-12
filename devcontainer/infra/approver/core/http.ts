/**
 * HTTP plumbing shared across controllers: token auth, a route wrapper that
 * enforces it, and small body-parsing helpers. Keeping these in one place lets
 * the route table read as `withAuth(handler)` instead of repeating the guard.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

import { TOKEN } from "./config.ts";

/** A Bun route handler: maps a request to a Response, synchronously or async. */
export type RouteHandler<T extends Request> = (
  req: T,
) => Response | Promise<Response>;

/**
 * Reject with 401 if `x-approver-token` does not match the shared {@link TOKEN}.
 * Used by every token-gated endpoint; prefer {@link withAuth} at the route table
 * over calling this directly.
 * @param req The incoming request.
 * @returns A 401 Response when the token is absent or wrong, otherwise null.
 */
export function requireToken(req: Request): Response | null {
  const token = req.headers.get("x-approver-token");
  if (token !== TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Wrap a route handler so it runs only after {@link requireToken} passes, returning
 * the 401 otherwise. Generic over the request type so a `BunRequest<"/path/:id">`
 * handler keeps its typed `params` through the wrapper.
 * @param handler The handler to guard.
 * @returns A handler that enforces the token before delegating.
 */
export function withAuth<T extends Request>(
  handler: RouteHandler<T>,
): RouteHandler<T> {
  return (req: T): Response | Promise<Response> => {
    const authErr = requireToken(req);
    if (authErr) return authErr;
    return handler(req);
  };
}

/**
 * Parse a request body as a non-null JSON object.
 * @param req The incoming request.
 * @returns The parsed object on success, or an error string for the caller to return verbatim.
 */
export async function parseJsonObject(
  req: Request,
): Promise<Record<string, unknown> | string> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return "invalid json";
  }
  if (typeof body !== "object" || body === null) {
    return "body must be a json object";
  }
  return body as Record<string, unknown>;
}

/**
 * Coerce an unknown value to a policy's `allow` boolean, or undefined when it is not a
 * boolean. Returns undefined (not `false`) on invalid input so callers can distinguish
 * "absent/malformed" from a legitimately-stored `false` (a remembered deny).
 * @param value The raw value (typically a request body field).
 * @returns The boolean, or undefined when not a boolean.
 */
export function parseAllow(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
