/**
 * The canonical egress request representation, shared across REST and SSE.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

import type { RequestMetadata } from "./request-metadata.ts";
import type { RequestStatus } from "./request-status.ts";

/**
 * The one request representation — used in REST JSON bodies, SSE snapshot/added frames,
 * and client parsers. Byte-identical across all representations.
 */
export interface EgressRequest {
  /** UUID correlation key; never derived from request content. */
  id: string;
  /** Current lifecycle state. Always "pending" in stream snapshot/added frames. */
  status: RequestStatus;
  /** Opaque, proxy-supplied, render-only. The evolving part of the contract. */
  metadata: RequestMetadata;
  /** Epoch ms when the request entered pending. */
  createdAt: number;
  /** Epoch ms when the request reached a terminal state; present iff status !== "pending". */
  decidedAt?: number;
}
