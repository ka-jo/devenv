/**
 * Lean SSE delta emitted when a request reaches a terminal state.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

/** Payload of a resolved SSE frame. Lean delta: client already has metadata keyed by id. */
export interface ResolvedFrame {
  /** Unique request ID. */
  id: string;
  /** Terminal status: allowed/denied (from PATCH) or expired (system timeout). */
  status: "allowed" | "denied" | "expired";
  /** Epoch ms when the request transitioned to terminal state. */
  decidedAt: number;
}
