/**
 * A human verdict on an in-flight request.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

import type { Policy } from "./policy.ts";

/**
 * A human verdict on a request's lifecycle transition. Distinct from a {@link Policy}:
 * a verdict decides one in-flight request; a policy is a stored allow/deny rule.
 */
export type Verdict = "allowed" | "denied";
