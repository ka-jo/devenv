/**
 * Request lifecycle state.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

/** Request lifecycle state: pending is non-terminal; the rest are terminal and immutable. */
export type RequestStatus = "pending" | "allowed" | "denied" | "expired";
