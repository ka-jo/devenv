/**
 * Static configuration and the shared-secret bootstrap for the approver process.
 * Values resolve once at module load from the environment, with sane defaults for
 * local runs. The token bootstrap side-effect is deferred to {@link persistTokenIfGenerated}
 * so importing this module stays free of filesystem writes.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

/** Port the broker listens on. Override with `APPROVER_PORT`. @internal */
export const PORT: number = Number(process.env.APPROVER_PORT) || 3129;

/**
 * Absolute paths to the two domain list files, bind-mounted from the host's
 * `.devcontainer/firewall/` directory. The firewall container holds the same
 * host inodes read-only; inotify there fires when the approver writes here.
 * @internal
 */
export const DOMAIN_LIST_PATHS: Record<"allowed" | "denied", string> = {
  allowed:
    process.env.ALLOWED_DOMAINS_FILE ?? "/etc/approver/allowed_domains.txt",
  denied:
    process.env.DENIED_DOMAINS_FILE ?? "/etc/approver/denied_domains.txt",
};

/**
 * Header prepended when bootstrapping a domain list file that does not yet exist.
 * Mirrors the header written by `devenv devcontainer` for each list type.
 * @internal
 */
export const DOMAIN_LIST_HEADERS: Record<"allowed" | "denied", string> = {
  allowed:
    "# Allow list — domains permitted through the egress firewall.\n" +
    "# One entry per line. Leading \".\" matches all subdomains (e.g. .example.com allows sub.example.com).\n" +
    "# Edit from the host; the firewall sidecar live-reloads on change.\n",
  denied:
    "# Deny list — domains blocked before the approval flow.\n" +
    "# One entry per line. Leading \".\" matches all subdomains (e.g. .example.com blocks sub.example.com).\n" +
    "# Edit from the host; the firewall sidecar live-reloads on change.\n",
};

/**
 * Shared secret gating token-gated endpoints (GET /requests, GET /requests/{id}, PATCH /requests/{id}).
 * Prefer an explicit `APPROVER_TOKEN` (lets the operator pin one for tests); otherwise mint a
 * fresh 256-bit token per process start. Generating it here — rather than sourcing it from a
 * host file — keeps the secret out of the project tree the sandboxed app container bind-mounts,
 * so a rogue process there can never read it. The host retrieves a generated token out-of-band
 * via `docker compose exec approver cat ${@link TOKEN_FILE}`.
 */
export const TOKEN: string =
  process.env.APPROVER_TOKEN || randomBytes(32).toString("hex");

/**
 * Path the generated token is written to for host-side retrieval. Backed by a
 * tmpfs in the compose file, so the secret lives only in RAM and is wiped when the
 * container stops. Not written when the token came from the environment — the host
 * already knows it in that case.
 * @internal
 */
export const TOKEN_FILE: string =
  process.env.APPROVER_TOKEN_FILE || "/run/approver/token";

// PHASE 2 (VS Code extension): the host-side decider must read the token from
// here via `docker compose exec approver cat /run/approver/token` and send it in
// the `x-approver-token` header on `GET /requests` and `PATCH /requests/{id}`.
// It must NOT expect the token in .devcontainer/.env — that path was removed so
// the secret stays out of the app container's bind-mounted workspace. Token
// rotates each container start, so fetch it per session rather than caching.

/** Idle-sliding eviction window. A session untouched this long is reaped. @internal */
export const SESSION_TTL_MS: number = 2 * 60 * 60 * 1000;

/** How often the periodic sweep runs to reap idle sessions. @internal */
export const SESSION_SWEEP_MS: number = 10 * 60 * 1000;

/**
 * Write a freshly-minted {@link TOKEN} to {@link TOKEN_FILE} for host-side retrieval.
 * No-op when the token came from `APPROVER_TOKEN` (the host already knows it). Called
 * once from the server entrypoint before listening.
 * @throws {Error} Never returns on failure: logs and exits the process when the token
 *   file cannot be written, since the host would otherwise be unable to authenticate.
 */
export function persistTokenIfGenerated(): void {
  if (process.env.APPROVER_TOKEN) return;
  try {
    writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 });
  } catch (err) {
    console.error(
      `FATAL: could not write token to ${TOKEN_FILE}; host cannot retrieve it:`,
      err,
    );
    process.exit(1);
  }
}
