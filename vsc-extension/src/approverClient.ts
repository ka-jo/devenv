/**
 * Approver REST client — the verdict half of the protocol.
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
