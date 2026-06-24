/**
 * A {@link Policy} remembered within the scope of one session.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

import type { Policy } from "./policy.ts";

/** A {@link Policy} remembered within one session; carries its owning session id. */
export interface SessionPolicy extends Policy {
  /** The owning session's id (mirrors the path `{id}` it was created under). */
  session: string;
}
