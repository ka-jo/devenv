/**
 * Opaque, proxy-supplied metadata attached to an egress request.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

/**
 * Opaque, proxy-supplied request metadata. Never used as a key; render-only.
 * The envelope (id, status, createdAt, decidedAt) is stable; metadata evolves.
 */
export interface RequestMetadata {
  /** Trimmed, lowercased target hostname. */
  host: string;
  /** Uppercased HTTP method, or "" when the helper omitted it. */
  method: string;
  /** Full request URL when available (plain HTTP); "" for HTTPS CONNECT tunnels. */
  url: string;
  /**
   * The Claude session this egress is attributed to, decoded by the proxy adapter
   * from the client's Proxy-Authorization token, or "" when untagged (anonymous).
   * The approver keys per-session policy on it: a matching `(sessionId, host)` entry
   * short-circuits `POST /requests` to the remembered verdict. Attribution only — a
   * process can forge or drop the token, so it is never a trust boundary. See PROTOCOL.md.
   */
  sessionId: string;
}
