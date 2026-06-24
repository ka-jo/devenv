/**
 * Approver REST client — verdicts and policy management.
 * The observe half lives in {@link ApproverStream}.
 */

import type { Policy, Verdict } from "./protocol";

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
  verdict: Verdict,
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
 * Append a host to a durable firewall policy list via the approver server.
 *
 * The approver holds writable bind mounts of the policy list files and writes
 * on behalf of the extension — necessary because the extension runs on the
 * Windows host and cannot access files that live in WSL. The list (allow vs deny)
 * is selected by the `allow` boolean in the body, matching the `Policy` payload
 * shape used everywhere.
 *
 * Idempotent: the server returns `200` even when the host is already present.
 *
 * @param endpoint Approver base URL (no trailing slash).
 * @param token The per-session token for `x-approver-token`.
 * @param host Bare hostname to add (no scheme, no path).
 * @param allow `true` for the allow list, `false` for the deny list.
 * @throws {Error} On network failure or any non-OK status.
 */
export async function postPolicy(
  endpoint: string,
  token: string,
  host: string,
  allow: boolean,
): Promise<void> {
  const res = await fetch(`${endpoint}/policies`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-approver-token": token,
    },
    body: JSON.stringify({ host, allow } satisfies Policy),
  });
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  throw new Error(`POST /policies → HTTP ${res.status}: ${text}`);
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
 * Remember a per-host policy for a Claude session, so the approver auto-settles
 * future egress from that session to that host without prompting.
 *
 * Ensures `(sessionId, host) → allow` regardless of prior state: creates the
 * session if absent, and overwrites an existing host policy (the approver has no
 * in-place update, so a `409` is resolved by `DELETE` + re-`POST`).
 *
 * @param endpoint Approver base URL (no trailing slash).
 * @param token The per-session token for `x-approver-token`.
 * @param sessionId The Claude session id (from request metadata).
 * @param host Bare hostname to remember.
 * @param allow `true` to remember an allow, `false` to remember a deny.
 * @throws {Error} On network failure or an unexpected status.
 */
export async function rememberSessionPolicy(
  endpoint: string,
  token: string,
  sessionId: string,
  host: string,
  allow: boolean,
): Promise<void> {
  await ensureSession(endpoint, token, sessionId);

  const path = `${endpoint}/sessions/${encodeURIComponent(
    sessionId,
  )}/policies/${encodeURIComponent(host)}`;
  const body = JSON.stringify({ allow } satisfies Pick<Policy, "allow">);

  let res = await fetch(path, { method: "POST", headers: authHeaders(token), body });
  if (res.status === 409) {
    // Host already has a policy; the surface has no update verb, so flip via delete + re-add.
    await fetch(path, { method: "DELETE", headers: authHeaders(token) });
    res = await fetch(path, { method: "POST", headers: authHeaders(token), body });
  }
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  throw new Error(`POST /sessions/${sessionId}/policies/${host} → HTTP ${res.status}: ${text}`);
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
