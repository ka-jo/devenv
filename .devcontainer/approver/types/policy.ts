/**
 * The stored allow/deny rule — the shared vocabulary of both the durable firewall
 * lists and per-session policy.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

/**
 * A stored allow/deny rule binding a host to a decision. The unit of both the durable
 * firewall lists (`POST /policies`) and per-session policy. Strictly binary — a policy
 * can never be `pending`/`expired`, so the decision is an `allow` boolean, not a verdict.
 */
export interface Policy {
  /** Trimmed, lowercased target hostname the rule applies to. */
  host: string;
  /** Whether egress to {@link Policy.host} is permitted. */
  allow: boolean;
}
