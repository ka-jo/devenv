# Approver Protocol

The contract between the three parties in the egress-approval system:

- **Proxy helper** — Squid's `external_acl` backend (`firewall/approve_helper.sh`),
  later a MITM proxy. Submits egress requests and blocks for a verdict. Runs on the
  `external` Docker network; reaches the approver by service name. **The only creator
  of requests, by design — and the only one there will ever be.**
- **Approver** — this service (`approver/server.ts`). Holds in-flight requests in
  process memory, brokers verdicts, and is the **policy engine**: it owns the
  durable firewall policy lists (via writable bind mounts) and the in-memory per-session
  policy that short-circuits verdicts for novel domains.
- **Extension** — the host-side VS Code extension. Observes pending requests, issues
  human verdicts, and drives the policy surface (durable policies + session policy).
  Reaches the approver over the host loopback publish on `127.0.0.1`; the host port
  is ephemeral (so concurrent stacks don't collide) and discovered per-window via
  `docker port <containerName> 3129/tcp`.

This document is the pinned contract; the approver refactor and the extension build
against it. It supersedes the Phase 1 surface (`POST /pending`, `GET /pending`,
`POST /decision`), which is collapsed into the single resource below.

---

## The resource

There is **one** resource: an **egress request awaiting a verdict**. Everything the
old surface called "pending" or "decision" is a *state* or a *state transition* on
this resource, not a resource of its own.

```ts
/** Lifecycle states. `pending` is the only non-terminal state; the rest are terminal and immutable. */
type RequestStatus = "pending" | "allowed" | "denied" | "expired";

/**
 * The one request representation — byte-identical across the REST JSON body, SSE
 * `snapshot` elements, and SSE `added` frames, so every consumer uses one parser.
 */
interface EgressRequest {
  /** UUID. The only correlation key. Never derived from request content (e.g. host). */
  id: string;
  /** Current lifecycle state. Always `"pending"` in stream `snapshot`/`added` frames. */
  status: RequestStatus;
  /** Opaque, proxy-supplied, render-only. The evolving part of the contract (see below). */
  metadata: RequestMetadata;
  /** Epoch ms the request entered `pending`. */
  createdAt: number;
  /** Epoch ms the request reached a terminal state. Present iff `status !== "pending"`. */
  decidedAt?: number;
}
```

### Envelope vs. metadata — the forward-compat seam

The **envelope** (`id`, `status`, `createdAt`, `decidedAt`) is stable: both halves
pin to it. The **metadata** is the part allowed to evolve. Today Squid's
`external_acl` only yields host-shaped data:

```ts
/** Squid era. Under MITM this grows (full URL, headers, SNI, body excerpt, …) — the envelope above does not move. */
interface RequestMetadata {
  /** Trimmed, lowercased target hostname. */
  host: string;
  /** Uppercased HTTP method, or `""` when the helper omitted it. */
  method: string;
  /** Full request URL when available (plain HTTP); `""` for HTTPS CONNECT tunnels where Squid sees only host:port. */
  url: string;
  /**
   * The Claude session this egress is attributed to, or `""` when untagged
   * (anonymous). The proxy adapter decodes it: the launcher embeds a per-session
   * token as the Basic-auth username in the egress proxy URL, so it arrives in the
   * `Proxy-Authorization` header; `firewall/approve_helper.sh` decodes it and emits
   * it here. The approver keys per-session policy on it (see below). Attribution
   * only — a process can forge or drop the token, so it is never a trust boundary;
   * the worst a forged `sessionId` can do is borrow another session's *self-granted*
   * policy, never escalate past a human verdict.
   */
  sessionId: string;
}
```

The approver **is the policy engine** for egress decisions. An earlier version of this
doc held the opposite line — "the approver never reasons about `metadata` semantically;
per-session policy lives in the extension" — but that stopped being true the moment the
approver took ownership of the firewall policy lists (`POST /policies`, below). The
broker now reasons about exactly two metadata fields, and only these two:

- **`host`** — the key for both the durable policy lists and per-session policy.
- **`sessionId`** — the key for per-session policy: the approver remembers
  `(sessionId, host) → allow` and auto-settles matching requests (`POST /requests`
  short-circuit, below).

Everything else in `metadata` stays render-only. The forward-compat seam still holds:
under MITM `RequestMetadata` grows and the adapter decodes `host`/`sessionId` its own
way, but the envelope, the stream, the verdict path, and correlation do not move.
Host-keying is the one thing MITM will force a reckoning on — see [Out of scope](#out-of-scope-deliberately).

---

## Trust positioning (why the gating is split)

Recap of the network model (`docker-compose.yml`) that the auth rules below follow:

- The **proxy helper** creates requests from the `external` network. The sandboxed
  app container has **no route** to the approver at all (it is on `proxy_net` only).
- The **extension** reaches the approver solely via the host loopback publish.

Therefore:

| Operation | Caller | Auth |
|---|---|---|
| Create a request | proxy helper | **none** — gated by network segmentation; the helper can't hold the host token and doesn't need to |
| Read requests (list / stream / fetch) | extension | **token** |
| Issue a verdict | extension | **token** |
| Append to a policy list | extension | **token** |
| Manage session policy | extension | **token** |

The token is the per-start secret minted by the approver and written to its tmpfs
(`/run/approver/token`); the extension retrieves it out-of-band
(`docker compose exec approver cat /run/approver/token`, re-fetched per session — it
rotates) and sends it in the **`x-approver-token`** header. It is defense-in-depth on
the one unavoidable surface (the published loopback port), not the primary control.

---

## REST surface

One collection (`/requests`) plus an ops endpoint. All bodies are JSON unless noted.

### `POST /requests` — create and await verdict

The proxy helper's sole call. **Always blocks** until the request reaches a terminal
state, then returns its terminal representation. (No `?wait` modifier: there is
exactly one consumer and it always wants to block. A non-blocking variant is YAGNI.)

- **Auth:** none.
- **Request body:** `RequestMetadata`.
- **Response `200 OK`:** the terminal `EgressRequest` (`status` ∈
  `allowed | denied | expired`, `decidedAt` set).
- **Response `400`:** malformed body.

**Session-policy short-circuit.** Before a request is ever broadcast or made to block,
the approver consults per-session policy: if `metadata.sessionId` is non-empty and a
`(sessionId, host)` entry exists (see [`/sessions`](#sessions)), the request is settled
*immediately* to that remembered verdict — `200` with `status` already `allowed`/`denied`
and `decidedAt` set, the same shape a human verdict produces. It never enters `pending`,
never emits an `added` frame, and never consumes a helper slot beyond the one blocking
`curl` that returns at once. Any `POST /requests` carrying a known `sessionId` also
refreshes that session's idle clock (see eviction). Only requests with *no* matching
session policy fall through to the human path below. (Allowlisted and denylisted hosts
never reach the approver at all — Squid resolves them — so session policy only ever
decides genuinely-novel domains; there is no precedence question against the lists.)

Blocking is the idiomatic shape for a Squid `external_acl` helper — the protocol
expects the helper to block on stdin→stdout, and `curl`-then-parse-one-JSON-blob is
trivial in bash (an SSE stream would not be). Fail-closed: if the caller's socket
aborts (the helper's `--max-time`) before a verdict lands, the request transitions to
`expired` and a `resolved` frame is emitted (see SSE below); the helper, having given
up, denies.

`200` rather than `201`: the returned representation is the *resolved* resource, not a
freshly-created one, and the helper never refetches via `Location`. Creation is
incidental to "submit and await verdict."

### `GET /requests` — list (snapshot) or stream

Content-negotiated on `Accept`. Same resource collection, two representations.

- **Auth:** token.
- **`Accept: application/json`** (default): a one-shot snapshot.
  - Optional filter `?status=pending` (any `RequestStatus` accepted).
  - **`200 OK`:** `{ "requests": EgressRequest[] }`.
- **`Accept: text/event-stream`:** a live stream (see [SSE](#sse-stream)).
  - **`200 OK`** with `Content-Type: text/event-stream`, held open.

### `GET /requests/{id}` — fetch one

Rounds out the resource; useful for the extension to refetch or for debugging. Not
required by current consumers.

- **Auth:** token.
- **`200 OK`:** the `EgressRequest`.
- **`404`:** unknown `id` (never created, or already evicted after resolution).

### `PATCH /requests/{id}` — issue a verdict

A human verdict, modeled as a state transition on the request — **not** a separate
"decision" resource.

- **Auth:** token.
- **Request body:** `{ "status": "allowed" | "denied" }`.
  - Only `allowed` / `denied` are accepted. `expired` is system-only (the approver
    sets it on timeout); a client may not.
- **`200 OK`:** the terminal `EgressRequest`. This unblocks the helper's `POST` and
  emits a `resolved` frame, both from one settle.
- **`400`:** body missing or `status` not one of `allowed | denied`.
- **`401`:** missing/invalid token.
- **`404`:** unknown `id`.
- **`409 Conflict`:** the request is already terminal (verdicts are immutable).

### `POST /policies` — append a durable policy

Adds a host to a firewall policy list. The approver holds **writable** bind mounts of
both files; this endpoint exists because the VS Code extension runs on the Windows host
and cannot write WSL filesystem paths directly.

A **policy** is the unit shared by the durable lists and session policy — the same shape
everywhere, so the client speaks one payload:

```ts
/** A stored allow/deny rule binding a host to a decision. Strictly binary — never `pending`/`expired`. */
interface Policy {
  /** Trimmed, lowercased target hostname. */
  host: string;
  /** Whether egress to `host` is permitted. */
  allow: boolean;
}
```

The list (allow vs deny) is selected by the **`allow` boolean in the body, not a path
segment**. Unlike a session policy (an addressable in-memory sub-resource), a durable
policy list is an append to a flat file with no per-host addressing (`GET`/`DELETE` of a
single host), so the host stays in the body: a command/append endpoint, not a keyed
resource.

- **Auth:** token.
- **Request body:** a `Policy` — `{ "host": "<bare hostname>", "allow": true | false }`.
- **Response `200 OK`:** `{ "added": true }` when written, or
  `{ "added": false, "reason": "already present" }` when the host was already
  in the list (idempotent — not an error).
- **Response `400`:** malformed body or non-boolean `allow`.
- **Response `401`:** missing/invalid token.
- **Side effect:** if the file does not yet exist (project predates the template
  adding it), it is created with a standard header comment before the entry is
  appended. The firewall sidecar's inotify watch fires on the shared host inode
  and SIGHUPs Squid, so the change is live immediately.

### `/sessions` {#sessions} — per-session policy

A **session** is a bag of remembered host verdicts scoped to one `sessionId`. When a
request carries a matching `(sessionId, host)`, `POST /requests` auto-settles it to the
remembered verdict instead of prompting a human (the short-circuit above). This is what
backs the extension's "Allow for this session" / "Deny for this session" actions.

State lives **only in the approver's process memory** — never on disk. It is not durable
remembered policy (that's the policy lists); it is a convenience that lives and dies with
the container, which is the natural bound for a session (the Claude session runs *inside*
that container). See [eviction](#session-eviction).

A session policy is a [`Policy`](#post-policies--append-a-durable-policy) plus the owning
session id:

```ts
/** A `Policy` remembered within one session; carries its owning session id. */
interface SessionPolicy extends Policy {
  /** The owning session id (mirrors the path `{id}` it was created under). */
  session: string;
}

/** A session's full representation (GET /sessions/{id}). */
interface Session {
  id: string;
  /** Remembered policies. */
  policies: SessionPolicy[];
  /** Epoch ms the session was created. */
  createdAt: number;
  /** Epoch ms of the last approver-visible activity (refreshed by matching POST /requests). */
  lastSeen: number;
}
```

The surface is one uniform lifecycle — **create-by-key / read / delete** — at both the
session and the policy level. There is **no update verb**: a `PUT`-style idempotent set is
the upsert flavor we deliberately avoid. To change a host's policy, `DELETE` then `POST`.

| Verb | Path | Body | Success | Errors |
|---|---|---|---|---|
| `POST` | `/sessions/{id}` | `{ policies?: Policy[] }` | `201` + `Session` | `400` bad body · `409` id exists |
| `GET` | `/sessions/{id}` | — | `200` + `Session` | `404` unknown |
| `DELETE` | `/sessions/{id}` | — | `204` | `404` unknown |
| `POST` | `/sessions/{id}/policies/{host}` | `{ allow }` | `201` + `SessionPolicy` | `400` bad allow · `404` no session · `409` host exists |
| `GET` | `/sessions/{id}/policies/{host}` | — | `200` + `SessionPolicy` | `404` unknown session or host |
| `DELETE` | `/sessions/{id}/policies/{host}` | — | `204` | `404` unknown session or host |

All token-gated. Notes:

- **Key in path, attributes in body** — mirrors `POST /sessions/{id}` (client supplies the
  id) down to the policy (`{host}` is the key; `{allow}` is the attribute). The `policies?`
  array on create is bulk sugar — each element is a full `Policy` (carrying its own `host`)
  because a bulk payload can't put keys in the path.
- **`404`, not upsert.** `POST /sessions/{id}/policies/{host}` on an unknown session is a
  `404` — adding a policy never implicitly creates the session. (The REST-pure choice; the
  ordering "ceremony" is paid willingly.)
- **`409` on duplicates.** Re-creating an existing session, or re-adding an existing host,
  is a `409` — `POST` stays honestly non-idempotent. Flip a policy via `DELETE` + `POST`.
- **No persistence, no history.** Evicting a session (manually or by TTL) simply forgets
  it; in-flight `pending` requests are unaffected (they are keyed by request `id`, not
  session).

#### Eviction {#session-eviction}

A session has no clean end signal the approver can rely on. The extension's `deactivate`
hook *can* `DELETE /sessions/{id}` on window close, and does so as a **best-effort
courtesy** — but it is host-side, fires on the wrong scope (a window outlives many
sessions; a detached container outlives a window), and isn't guaranteed (async budget,
`kill -9`). So it is never the correctness mechanism.

The backstop is an **idle-sliding TTL of 2 hours**, owned by the approver:

- `lastSeen` is refreshed on every `POST /requests` carrying the session's id (matched or
  not). A session active even sporadically never expires.
- A session idle longer than the TTL is evicted — lazily on next access, plus a cheap
  periodic sweep so idle sessions don't accumulate.
- **Idle, not absolute**, precisely because this is a safety net: it must never reap a
  *live* session and trigger a surprise re-prompt mid-work. The long 2h window makes a
  false eviction during a brief lull effectively impossible.
- Caveat: "idle" measures *approver-visible* activity. Allowlisted traffic is fast-pathed
  at Squid and never reaches the approver, so a session busy on only allowlisted hosts can
  idle out. Benign — the policy sat unused, and `deactivate` is the real cleanup.

### `GET /health` — liveness

- **Auth:** none. **`200 OK`**, body `OK`. Ops endpoint (the compose healthcheck);
  not a resource.

### Status transitions

```
            PATCH {status:"allowed"}        ┌──────────┐
   ┌───────────────────────────────────────▶│ allowed  │ (terminal)
   │                                         └──────────┘
┌──┴──────┐  PATCH {status:"denied"}         ┌──────────┐
│ pending ├────────────────────────────────▶ │ denied   │ (terminal)
└──┬──────┘                                   └──────────┘
   │        helper socket abort / timeout     ┌──────────┐
   └────────────────────────────────────────▶│ expired  │ (terminal, system-only)
                                              └──────────┘
```

Terminal states are immutable; any transition out of them is `409`.

A session-policy match (above) skips `pending` entirely: the request is born terminal,
so no `added`/`resolved` pair is observable for it. The diagram covers only requests that
reach the human path.

---

## SSE stream {#sse-stream}

Opened via `GET /requests` with `Accept: text/event-stream`. Standard SSE framing:

```
event: <type>
data: <json>

```

(blank line terminates a frame). We do **not** use `id:` / `Last-Event-ID` — reconnect
is "redial and re-snapshot," so per-event ids buy nothing.

### Frames

**`snapshot`** — sent once, immediately on connect; catches up a fresh or reconnected
client. Carries the full current pending set.

```
event: snapshot
data: {"requests":[{"id":"…","status":"pending","metadata":{"host":"api.foo.com","method":"GET","url":"http://api.foo.com/x"},"createdAt":1718000000000}]}
```

**`added`** — one request entered `pending`. Payload is an `EgressRequest` (same shape
as a snapshot element).

```
event: added
data: {"id":"…","status":"pending","metadata":{…},"createdAt":1718000000000}
```

**`resolved`** — a request left `pending`. **Lean delta**, not the full object: the
client already has `metadata` keyed by `id`, and resending it (potentially large under
MITM) is waste. One frame type covers human verdict and expiry — the consumer just
reads `status`.

```
event: resolved
data: {"id":"…","status":"denied","decidedAt":1718000000500}
```

```ts
/** Payload of a `resolved` frame. */
interface ResolvedFrame {
  id: string;
  /** Terminal status: `allowed`/`denied` (from PATCH) or `expired` (system timeout). */
  status: "allowed" | "denied" | "expired";
  decidedAt: number;
}
```

**keepalive** — an SSE comment line every ~20s (`:` prefix → ignored by every parser).
Cheap insurance against idle-drop; lets the client detect a dead server fast.

```
: keepalive

```

### Correctness requirements

- **Snapshot/subscribe atomicity.** The server must capture the snapshot *and*
  register the subscriber in the **same synchronous tick** (no `await` between). Bun
  is single-threaded, so this is free — and necessary, or an `added`/`resolved` can
  slip into the gap and be lost or duplicated.
- **Broadcast.** `added`/`resolved` fan out to **all** connected subscribers (multiple
  windows/reloads). A `Set` of stream controllers; remove a controller on its
  client's disconnect.
- **Tolerate unknown ids.** A client may receive a `resolved` for an `id` it never saw
  (resolved before it connected). Ignore it; not an error.

### Verdict fan-out

Both consumers learn a verdict from the **same** internal settle:

- **Helper** — its blocked `POST /requests` resolves and returns the terminal JSON.
- **Extension** — a `resolved` frame on its stream.

`PATCH /requests/{id}` (human) and the timeout path (system → `expired`) both flow
through that one settle, so neither consumer special-cases the source.

---

## Concurrency

Parallel pending requests come from Squid's helper **process pool**, not from
concurrency within one helper. `firewall/squid.conf`:

```
external_acl_type approver … children-startup=1 children-max=8 …
```

`children-max=8` ⇒ up to 8 independent helper processes, each one blocking `curl` →
one blocking `POST /requests` → one entry + waiter in the approver. The approver
already handles concurrent creates (each mints its own `id` + waiter; nothing shared).

- **Ceiling = `children-max` (8).** A 9th simultaneously-pending *novel* domain queues
  until one frees (a verdict, or a 120s expiry). Allowlisted traffic is fast-pathed
  and never consumes a child, so the pool is spent only on genuinely-new domains —
  human-speed, so 8 is generally plenty. Bump it if queuing appears.
- **`concurrency=N` is not the answer here.** It multiplexes N in-flight requests
  through *one* helper via channel ids, but a bash+`curl` helper can't multiplex
  (each `curl` blocks the process); it would require an async rewrite for no gain. The
  multi-process model fits one-blocking-`curl`-per-child exactly. Keep it.

---

## Out of scope (deliberately)

- **Durable, on-disk session policy** — session policy is in-memory only and dies with
  the container, by design (see [`/sessions`](#sessions)). *Durable* host policy already
  has a home: the firewall policy lists via `POST /policies`. Persisting session policy
  would need a DB; the live waiter map can't be serialized anyway (waiters are promise
  resolvers bound to open sockets). If durable audit/history is ever wanted, reach for
  *file-backed* SQLite (`bun:sqlite`); in-memory SQLite is the cost of a DB with none of
  its durability and is never the right call here.
- **In-place policy edits / upsert** — no `PUT`. Changing a remembered verdict is
  `DELETE` + `POST`; see the [`/sessions`](#sessions) rationale.
- **Host-keying under MITM** — both the durable policy lists and session policy key on `host`.
  When Squid is replaced by a MITM proxy the keying concept becomes URL/SNI-shaped and
  this is the seam that will need rework. It is host-shaped on purpose today (that's what
  the proxy yields) and deliberately deferred, not overlooked.
- **Frame/representation versioning** — YAGNI for two halves of one repo. A top-level
  `v` is cheap to add if the envelope ever breaks.
