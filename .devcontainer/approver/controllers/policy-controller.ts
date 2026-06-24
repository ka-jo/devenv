/**
 * Controller for the `/policies` resource: append a host to a durable firewall list.
 * Body validation lives here; the file append and idempotency live in the policy store.
 *
 * Built by {@link createPolicyController}, which closes the handler over its store
 * dependency so `server.ts` can inject the concrete (or, in tests, fake) store.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

import { parseAllow, parseJsonObject } from "../core/http.ts";
import type { PolicyStore } from "../data/policy-store.ts";

/** The handler bundle the policy controller exposes to the route table. */
export interface PolicyController {
  /** POST /policies — append a host to a durable firewall policy list. */
  postPolicy(req: Request): Promise<Response>;
}

/**
 * Build the policy controller bound to its store dependency.
 * @param policies Store of durable firewall policy lists.
 * @returns A {@link PolicyController} handler bundle ready for the route table.
 */
export function createPolicyController(policies: PolicyStore): PolicyController {
  /**
   * POST /policies — append a host to a durable firewall policy list.
   * Token-gated. The list (allow vs deny) is selected by the `allow` boolean in the body,
   * so the payload is the same `{ host, allow }` Policy shape used everywhere. Idempotent:
   * returns `200` even if the host is already present.
   * @param req The incoming request.
   * @returns 200 on success, 400 on bad input.
   */
  async function postPolicy(req: Request): Promise<Response> {
    const body = await parseJsonObject(req);
    if (typeof body === "string") {
      return Response.json({ error: body }, { status: 400 });
    }

    const rawHost = body.host;
    if (typeof rawHost !== "string") {
      return Response.json({ error: "host must be a string" }, { status: 400 });
    }
    const host = rawHost.trim().toLowerCase();
    if (!host) {
      return Response.json({ error: "host required" }, { status: 400 });
    }

    const allow = parseAllow(body.allow);
    if (allow === undefined) {
      return Response.json(
        { error: "allow must be a boolean" },
        { status: 400 },
      );
    }

    const result = await policies.add(host, allow);
    return Response.json(result);
  }

  return { postPolicy };
}
