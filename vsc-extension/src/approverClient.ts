/**
 * Approver REST client — verdicts and domain list management.
 * The observe half lives in {@link ApproverStream}.
 */

/**
 * Issue an allow or deny verdict for a pending egress request.
 *
 * Silently succeeds on `409 Already Terminal` — the request was already decided
 * (e.g. the user clicked both the notification and the tree view inline button).
 *
 * @param endpoint Approver base URL (no trailing slash).
 * @param token The per-session token from `x-approver-token`.
 * @param id UUID of the pending request.
 * @param verdict `"allowed"` to permit or `"denied"` to block.
 * @throws {Error} On network failure or any non-OK, non-409 status.
 */
export async function patchVerdict(
  endpoint: string,
  token: string,
  id: string,
  verdict: "allowed" | "denied",
): Promise<void> {
  const res = await fetch(`${endpoint}/requests/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-approver-token": token,
    },
    body: JSON.stringify({ status: verdict }),
  });
  if (res.ok || res.status === 409) return;
  const text = await res.text().catch(() => "");
  throw new Error(`PATCH /requests/${id} → HTTP ${res.status}: ${text}`);
}

/**
 * Append a host to a firewall domain list via the approver server.
 *
 * The approver holds writable bind mounts of the domain list files and writes
 * on behalf of the extension — necessary because the extension runs on the
 * Windows host and cannot access files that live in WSL.
 *
 * Idempotent: the server returns `200` even when the host is already present.
 *
 * @param endpoint Approver base URL (no trailing slash).
 * @param token The per-session token for `x-approver-token`.
 * @param host Bare hostname to add (no scheme, no path).
 * @param kind Which list to append to.
 * @throws {Error} On network failure or any non-OK status.
 */
export async function postDomainEntry(
  endpoint: string,
  token: string,
  host: string,
  kind: "allowed" | "denied",
): Promise<void> {
  const res = await fetch(`${endpoint}/domains/${encodeURIComponent(kind)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-approver-token": token,
    },
    body: JSON.stringify({ host }),
  });
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  throw new Error(`POST /domains/${kind} → HTTP ${res.status}: ${text}`);
}
