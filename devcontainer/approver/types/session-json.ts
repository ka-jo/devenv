/**
 * Wire shape of a session as returned by the `/sessions` endpoints.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

import type { SessionPolicy } from "./session-policy.ts";

/**
 * Wire shape of a session as returned by the `/sessions` endpoints. The in-memory
 * `policies` map is materialized as a {@link SessionPolicy} array on the wire.
 */
export interface SessionJson {
  /** The session id. */
  id: string;
  /** Remembered policies, one entry per host. */
  policies: SessionPolicy[];
  /** Epoch ms the session was created. */
  createdAt: number;
  /** Epoch ms of the last approver-visible activity. */
  lastSeen: number;
}
