/**
 * Access layer for in-flight egress requests. Backed by an in-process map: a request
 * carries promise resolvers (waiters) for blocked `POST /requests` callers and is evicted
 * the moment it settles, so this state is inherently live coordination, not persistable
 * data — there is no database backing here, only the interface for symmetry with the other
 * stores. Settling a request resolves its waiters and broadcasts to SSE subscribers.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

import { broadcastAdded, broadcastResolved } from "../core/sse.ts";
import type { EgressRequest } from "../types/egress-request.ts";
import type { RequestMetadata } from "../types/request-metadata.ts";
import type { RequestStatus } from "../types/request-status.ts";
import type { ResolvedFrame } from "../types/resolved-frame.ts";

/**
 * In-flight request state. Holds the request envelope and waiters.
 * Waiters are promise resolvers from blocked POST /requests calls awaiting a verdict.
 */
export interface RequestEntry {
  /** The immutable envelope. */
  request: EgressRequest;
  /** Promise resolvers waiting on this request's terminal state. */
  waiters: Set<(resolved: EgressRequest) => void>;
}

/**
 * Access pattern over in-flight requests. The concrete {@link InMemoryRequestStore}
 * is the only meaningful implementation (the waiters bind to live HTTP connections),
 * but the interface keeps controllers decoupled and mockable.
 */
export interface RequestStore {
  /**
   * Create a pending request, store it, and broadcast an `added` frame.
   * @param metadata Validated, proxy-supplied metadata.
   * @returns The new entry, including its (initially empty) waiter set.
   */
  create(metadata: RequestMetadata): RequestEntry;

  /**
   * Fetch an entry by id.
   * @param id The request id.
   * @returns The entry, or undefined if unknown or already settled.
   */
  get(id: string): RequestEntry | undefined;

  /**
   * Snapshot all live requests, optionally filtered by status.
   * @param filterStatus Optional status filter.
   * @returns Array of request envelopes matching the filter.
   */
  snapshot(filterStatus?: RequestStatus): EgressRequest[];

  /**
   * Transition a request to a terminal state: resolve its waiters, broadcast a
   * `resolved` frame, and evict it from the store.
   * @param id The request id.
   * @param status The terminal status (allowed/denied/expired).
   * @returns The terminal envelope, or undefined if id was unknown.
   */
  settle(
    id: string,
    status: "allowed" | "denied" | "expired",
  ): EgressRequest | undefined;
}

/** In-memory {@link RequestStore} keyed by request id. Construct one at the composition root. */
export class InMemoryRequestStore implements RequestStore {
  /** In-process map of all requests (pending; evicted after resolution). @internal */
  private readonly requests = new Map<string, RequestEntry>();

  /** @inheritDoc */
  public create(metadata: RequestMetadata): RequestEntry {
    const now = Date.now();
    const request: EgressRequest = {
      id: crypto.randomUUID(),
      status: "pending",
      metadata,
      createdAt: now,
    };
    const entry: RequestEntry = { request, waiters: new Set() };
    this.requests.set(request.id, entry);
    broadcastAdded(request);
    return entry;
  }

  /** @inheritDoc */
  public get(id: string): RequestEntry | undefined {
    return this.requests.get(id);
  }

  /** @inheritDoc */
  public snapshot(filterStatus?: RequestStatus): EgressRequest[] {
    const results: EgressRequest[] = [];
    for (const entry of this.requests.values()) {
      if (!filterStatus || entry.request.status === filterStatus) {
        results.push(entry.request);
      }
    }
    return results;
  }

  /** @inheritDoc */
  public settle(
    id: string,
    status: "allowed" | "denied" | "expired",
  ): EgressRequest | undefined {
    const entry = this.requests.get(id);
    if (!entry) return undefined;

    const decidedAt = Date.now();
    entry.request.status = status;
    entry.request.decidedAt = decidedAt;

    this.requests.delete(id);

    // Resolve all blocked POST /requests callers.
    const resolved = entry.request;
    for (const waiter of entry.waiters) waiter(resolved);
    entry.waiters.clear();

    // Broadcast to all SSE subscribers.
    const frame: ResolvedFrame = { id, status, decidedAt };
    broadcastResolved(frame);

    return resolved;
  }
}
