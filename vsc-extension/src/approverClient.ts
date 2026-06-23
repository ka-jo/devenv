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
 * Windows host and cannot access files that live in WSL. The list is selected by
 * the `policy` field in the body (not a path segment), matching the session-policy
 * payload shape.
 *
 * Idempotent: the server returns `200` even when the host is already present.
 *
 * @param endpoint Approver base URL (no trailing slash).
 * @param token The per-session token for `x-approver-token`.
 * @param host Bare hostname to add (no scheme, no path).
 * @param policy Which list to append to.
 * @throws {Error} On network failure or any non-OK status.
 */
export async function postDomainEntry(
  endpoint: string,
  token: string,
  host: string,
  policy: "allowed" | "denied",
): Promise<void> {
  const res = await fetch(`${endpoint}/domains`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-approver-token": token,
    },
    body: JSON.stringify({ host, policy }),
  });
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  throw new Error(`POST /domains → HTTP ${res.status}: ${text}`);
}

/**
 * Standard JSON headers carrying the approver token. @internal
 * @param token The per-session token for `x-approver-token`.
 * @returns A headers object for `fetch`.
 */
function authHeaders(token: string): Record<string, string> {
  return { "content-type": "application/json", "x-approver-token": token };
}

/**
 * Ensure a session resource exists, creating it empty if absent.
 *
 * `POST /sessions/{id}` returns `201` on create and `409` when it already exists;
 * both mean "the session now exists," so both resolve. This is the upsert the REST
 * surface deliberately omits, reassembled client-side from idempotent-friendly calls.
 *
 * @param endpoint Approver base URL (no trailing slash).
 * @param token The per-session token for `x-approver-token`.
 * @param sessionId The Claude session id.
 * @throws {Error} On network failure or any status other than 201/409.
 */
async function ensureSession(
  endpoint: string,
  token: string,
  sessionId: string,
): Promise<void> {
  const res = await fetch(
    `${endpoint}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "POST", headers: authHeaders(token), body: "{}" },
  );
  if (res.ok || res.status === 409) return;
  const text = await res.text().catch(() => "");
  throw new Error(`POST /sessions → HTTP ${res.status}: ${text}`);
}

/**
 * Remember a per-host verdict for a Claude session, so the approver auto-settles
 * future egress from that session to that host without prompting.
 *
 * Ensures `(sessionId, host) → policy` regardless of prior state: creates the
 * session if absent, and overwrites an existing host policy (the approver has no
 * in-place update, so a `409` is resolved by `DELETE` + re-`POST`).
 *
 * @param endpoint Approver base URL (no trailing slash).
 * @param token The per-session token for `x-approver-token`.
 * @param sessionId The Claude session id (from request metadata).
 * @param host Bare hostname to remember.
 * @param policy `"allowed"` or `"denied"`.
 * @throws {Error} On network failure or an unexpected status.
 */
export async function rememberSessionDomain(
  endpoint: string,
  token: string,
  sessionId: string,
  host: string,
  policy: "allowed" | "denied",
): Promise<void> {
  await ensureSession(endpoint, token, sessionId);

  const path = `${endpoint}/sessions/${encodeURIComponent(
    sessionId,
  )}/domains/${encodeURIComponent(host)}`;
  const body = JSON.stringify({ policy });

  let res = await fetch(path, { method: "POST", headers: authHeaders(token), body });
  if (res.status === 409) {
    // Host already has a policy; the surface has no update verb, so flip via delete + re-add.
    await fetch(path, { method: "DELETE", headers: authHeaders(token) });
    res = await fetch(path, { method: "POST", headers: authHeaders(token), body });
  }
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  throw new Error(`POST /sessions/${sessionId}/domains/${host} → HTTP ${res.status}: ${text}`);
}

/**
 * Forget a session and all its remembered policies (`DELETE /sessions/{id}`).
 *
 * Best-effort cleanup, called from the extension's `deactivate`. Treats `404` as
 * success — the session may have already idled out via the approver's TTL.
 *
 * @param endpoint Approver base URL (no trailing slash).
 * @param token The per-session token for `x-approver-token`.
 * @param sessionId The Claude session id to forget.
 * @throws {Error} On network failure or any non-OK, non-404 status.
 */
export async function deleteSession(
  endpoint: string,
  token: string,
  sessionId: string,
): Promise<void> {
  const res = await fetch(
    `${endpoint}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE", headers: authHeaders(token) },
  );
  if (res.ok || res.status === 404) return;
  const text = await res.text().catch(() => "");
  throw new Error(`DELETE /sessions/${sessionId} → HTTP ${res.status}: ${text}`);
}
