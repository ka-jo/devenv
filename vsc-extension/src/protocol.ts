/**
 * Client-side mirror of the approver contract in
 * `devcontainer/approver/PROTOCOL.md`. Kept in sync by hand; the envelope
 * (id/status/createdAt/decidedAt) is stable, while {@link RequestMetadata}
 * evolves when Squid is replaced by a MITM proxy.
 */

/** Request lifecycle state; `pending` is non-terminal, the rest are terminal. */
export type RequestStatus = "pending" | "allowed" | "denied" | "expired";

/** Terminal subset of {@link RequestStatus}. */
export type TerminalStatus = "allowed" | "denied" | "expired";

/**
 * Opaque, proxy-supplied request metadata. Render-only; never a key. Host-shaped
 * today; grows under MITM (full URL, headers, SNI, …) without touching the envelope.
 */
export interface RequestMetadata {
  /** Trimmed, lowercased target hostname. */
  host: string;
  /** Uppercased HTTP method, or "" when the proxy omitted it. */
  method: string;
  /** Full request URL when available (plain HTTP); "" for HTTPS CONNECT tunnels. */
  url: string;
}

/** The one request representation — identical across REST bodies and stream frames. */
export interface EgressRequest {
  /** UUID correlation key. */
  id: string;
  /** Current lifecycle state. Always "pending" in `snapshot`/`added` frames. */
  status: RequestStatus;
  /** Opaque proxy metadata. */
  metadata: RequestMetadata;
  /** Epoch ms the request entered `pending`. */
  createdAt: number;
  /** Epoch ms the request reached a terminal state; present iff terminal. */
  decidedAt?: number;
}

/** Payload of a `snapshot` frame: the full current pending set. */
export interface SnapshotFrame {
  /** All currently-pending requests. */
  requests: EgressRequest[];
}

/** Payload of a `resolved` frame: a lean terminal delta. */
export interface ResolvedFrame {
  /** The request that left `pending`. */
  id: string;
  /** Terminal status carrying verdict (allowed/denied) or expiry. */
  status: TerminalStatus;
  /** Epoch ms of the transition. */
  decidedAt: number;
}

/**
 * Narrow an unknown value to a string-keyed record.
 * @param value The value to test.
 * @returns True if `value` is a non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate a decoded value as an {@link EgressRequest} (shallow).
 * @param value The decoded JSON value.
 * @returns True if `value` matches the envelope shape.
 */
export function isEgressRequest(value: unknown): value is EgressRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    typeof value.createdAt === "number" &&
    isRecord(value.metadata)
  );
}

/**
 * Validate a decoded value as a {@link SnapshotFrame}.
 * @param value The decoded JSON value.
 * @returns True if `value` is a snapshot payload.
 */
export function isSnapshotFrame(value: unknown): value is SnapshotFrame {
  return (
    isRecord(value) &&
    Array.isArray(value.requests) &&
    value.requests.every(isEgressRequest)
  );
}

/**
 * Validate a decoded value as a {@link ResolvedFrame}.
 * @param value The decoded JSON value.
 * @returns True if `value` is a resolved payload.
 */
export function isResolvedFrame(value: unknown): value is ResolvedFrame {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    (value.status === "allowed" ||
      value.status === "denied" ||
      value.status === "expired") &&
    typeof value.decidedAt === "number"
  );
}
