/**
 * Access layer for per-session policy — the one store with a real persistence seam.
 * Today it is an in-process map of `(host → allow)` bags keyed by session id, reaped on
 * an idle TTL; state is never persisted and dies with the container, which is the natural
 * bound for a session (the Claude session runs inside that container). A future SQLite
 * backing would implement this same {@link SessionStore} interface — but note that doing
 * so changes the semantic (a session would then outlive its container), so it is a product
 * decision, not a free backend swap. The interface keeps the in-memory map private and
 * exposes operations only, so no caller depends on the representation.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

import { SESSION_SWEEP_MS, SESSION_TTL_MS } from "../core/config.ts";
import type { SessionJson } from "../types/session-json.ts";
import type { SessionPolicy } from "../types/session-policy.ts";

/**
 * In-memory per-session policy. A session is a bag of remembered `(host → allow)`
 * policies keyed by `sessionId`. Materialized as {@link SessionPolicy}[] on the wire.
 * @internal
 */
interface SessionEntry {
  /** The session id (mirrors the map key). */
  id: string;
  /** Remembered policies as `host → allow`. */
  policies: Map<string, boolean>;
  /** Epoch ms the session was created. */
  createdAt: number;
  /** Epoch ms of the last approver-visible activity; refreshed by matching POST /requests. */
  lastSeen: number;
}

/** Result of a single-policy lookup, distinguishing an unknown session from an unknown host. */
export type PolicyLookup =
  | { ok: true; policy: SessionPolicy }
  | { ok: false; reason: "no-session" | "no-policy" };

/** Result of remembering a policy, distinguishing an unknown session from a duplicate host. */
export type PolicySet =
  | { ok: true; policy: SessionPolicy }
  | { ok: false; reason: "no-session" | "exists" };

/** Result of revoking a policy, distinguishing an unknown session from an unknown host. */
export type PolicyDelete =
  | { ok: true }
  | { ok: false; reason: "no-session" | "no-policy" };

/**
 * Access pattern over sessions and their remembered policies. All reads take the
 * current epoch ms so the implementation can lazily evict idle sessions on access.
 */
export interface SessionStore {
  /**
   * Create a session, optionally pre-populated with policies.
   * @param id The client-supplied session id.
   * @param policies Initial `host → allow` map (may be empty).
   * @param now Current epoch ms.
   * @returns The serialized session, or undefined if a live session already exists.
   */
  create(
    id: string,
    policies: Map<string, boolean>,
    now: number,
  ): SessionJson | undefined;

  /**
   * Fetch a live session, lazily evicting it if it has idled past the TTL.
   * @param id The session id.
   * @param now Current epoch ms.
   * @returns The serialized session, or undefined if unknown or expired.
   */
  get(id: string, now: number): SessionJson | undefined;

  /**
   * Forget a session and all its policies.
   * @param id The session id.
   * @param now Current epoch ms.
   * @returns true if a live session was deleted, false if unknown or expired.
   */
  delete(id: string, now: number): boolean;

  /**
   * Resolve the remembered verdict for `(sessionId, host)`, refreshing the session's
   * idle clock as a side-effect when the session is live. Drives the `POST /requests`
   * short-circuit.
   * @param sessionId The attributed session id.
   * @param host The target host.
   * @param now Current epoch ms.
   * @returns The remembered `allow` boolean, or undefined when there is no live session
   *   or no remembered policy for the host.
   */
  resolvePolicy(
    sessionId: string,
    host: string,
    now: number,
  ): boolean | undefined;

  /**
   * Fetch one remembered policy.
   * @param id The session id.
   * @param host The normalized target host.
   * @param now Current epoch ms.
   * @returns A {@link PolicyLookup} discriminating session-vs-host absence.
   */
  getPolicy(id: string, host: string, now: number): PolicyLookup;

  /**
   * Remember a per-host policy for a session. Never upserts the session.
   * @param id The session id.
   * @param host The normalized target host.
   * @param allow The decision.
   * @param now Current epoch ms.
   * @returns A {@link PolicySet} discriminating an unknown session from a duplicate host.
   */
  setPolicy(id: string, host: string, allow: boolean, now: number): PolicySet;

  /**
   * Revoke one remembered policy.
   * @param id The session id.
   * @param host The normalized target host.
   * @param now Current epoch ms.
   * @returns A {@link PolicyDelete} discriminating session-vs-host absence.
   */
  deletePolicy(id: string, host: string, now: number): PolicyDelete;
}

/**
 * In-memory {@link SessionStore} keyed by session id, with idle TTL eviction.
 * Construct one at the composition root.
 */
export class InMemorySessionStore implements SessionStore {
  /** In-process map of live sessions, keyed by sessionId. @internal */
  private readonly sessions = new Map<string, SessionEntry>();

  /** Handle for the periodic idle-session reaper, cleared by {@link stop}. @internal */
  private readonly sweepTimer: Timer;

  /**
   * Start the store and its periodic idle-session reaper. Lazy eviction on access covers
   * most cases; this backstop stops idle sessions accumulating between accesses. The timer
   * is `unref`ed so it never keeps the process alive.
   */
  public constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SESSION_SWEEP_MS);
    this.sweepTimer.unref();
  }

  /**
   * Stop the periodic reaper. Not needed for the process-lifetime singleton (the timer is
   * `unref`ed), but lets tests dispose the store deterministically.
   */
  public stop(): void {
    clearInterval(this.sweepTimer);
  }

  /**
   * Fetch a session if it exists and has not idled past the TTL, lazily evicting it
   * if it has. Does NOT refresh `lastSeen` (only {@link resolvePolicy} does).
   * @param id The session id.
   * @param now Current epoch ms.
   * @returns The live {@link SessionEntry}, or undefined if unknown or expired.
   */
  private getLive(id: string, now: number): SessionEntry | undefined {
    const entry = this.sessions.get(id);
    if (!entry) return undefined;
    if (now - entry.lastSeen > SESSION_TTL_MS) {
      this.sessions.delete(id);
      console.log(`[session] evicted ${id} (idle > ${SESSION_TTL_MS}ms)`);
      return undefined;
    }
    return entry;
  }

  /**
   * Materialize a session entry as its wire shape.
   * @param entry The live entry.
   * @returns The serialized session.
   */
  private toJson(entry: SessionEntry): SessionJson {
    const policies: SessionPolicy[] = Array.from(
      entry.policies,
      ([host, allow]) => ({ session: entry.id, host, allow }),
    );
    return {
      id: entry.id,
      policies,
      createdAt: entry.createdAt,
      lastSeen: entry.lastSeen,
    };
  }

  /** @inheritDoc */
  public create(
    id: string,
    policies: Map<string, boolean>,
    now: number,
  ): SessionJson | undefined {
    if (this.getLive(id, now)) return undefined;
    const entry: SessionEntry = { id, policies, createdAt: now, lastSeen: now };
    this.sessions.set(id, entry);
    console.log(`[session] created ${id} (${policies.size} policy(ies))`);
    return this.toJson(entry);
  }

  /** @inheritDoc */
  public get(id: string, now: number): SessionJson | undefined {
    const entry = this.getLive(id, now);
    return entry ? this.toJson(entry) : undefined;
  }

  /** @inheritDoc */
  public delete(id: string, now: number): boolean {
    if (!this.getLive(id, now)) return false;
    this.sessions.delete(id);
    console.log(`[session] deleted ${id}`);
    return true;
  }

  /**
   * Reap every session idle past the TTL. Backstop for the lazy eviction on access,
   * driven by the internal {@link sweepTimer}.
   */
  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (now - entry.lastSeen > SESSION_TTL_MS) {
        this.sessions.delete(id);
        console.log(`[session] swept ${id} (idle > ${SESSION_TTL_MS}ms)`);
      }
    }
  }

  /** @inheritDoc */
  public resolvePolicy(
    sessionId: string,
    host: string,
    now: number,
  ): boolean | undefined {
    const session = this.getLive(sessionId, now);
    if (!session) return undefined;
    // Any request carrying a known session refreshes its idle clock, even when the
    // host is not remembered.
    session.lastSeen = now;
    // `false` is a valid stored decision (a remembered deny); the caller tests against
    // undefined, so returning the raw map lookup preserves that distinction.
    return session.policies.get(host);
  }

  /** @inheritDoc */
  public getPolicy(id: string, host: string, now: number): PolicyLookup {
    const session = this.getLive(id, now);
    if (!session) return { ok: false, reason: "no-session" };
    const allow = session.policies.get(host);
    if (allow === undefined) return { ok: false, reason: "no-policy" };
    return { ok: true, policy: { session: session.id, host, allow } };
  }

  /** @inheritDoc */
  public setPolicy(
    id: string,
    host: string,
    allow: boolean,
    now: number,
  ): PolicySet {
    const session = this.getLive(id, now);
    if (!session) return { ok: false, reason: "no-session" };
    if (session.policies.has(host)) return { ok: false, reason: "exists" };
    session.policies.set(host, allow);
    console.log(`[session] ${id} ${host} ← ${allow ? "allow" : "deny"}`);
    return { ok: true, policy: { session: session.id, host, allow } };
  }

  /** @inheritDoc */
  public deletePolicy(id: string, host: string, now: number): PolicyDelete {
    const session = this.getLive(id, now);
    if (!session) return { ok: false, reason: "no-session" };
    if (!session.policies.delete(host)) {
      return { ok: false, reason: "no-policy" };
    }
    console.log(`[session] ${id} ${host} removed`);
    return { ok: true };
  }
}
