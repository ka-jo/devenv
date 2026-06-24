/**
 * Access layer for the durable firewall policy lists. The backing is pinned to the
 * filesystem by the firewall contract: the Squid sidecar reads `allowed_domains.txt` /
 * `denied_domains.txt` and live-reloads on inotify, so the file IS the interface to the
 * firewall — a database would buy nothing here. The interface exists for symmetry with
 * the other stores and to keep the controller testable.
 *
 * See devcontainer/approver/PROTOCOL.md for the full contract.
 */

import { readFile, writeFile } from "node:fs/promises";
import { DOMAIN_LIST_HEADERS, DOMAIN_LIST_PATHS } from "../core/config.ts";

/** Outcome of appending a host to a policy list. */
export interface PolicyAddResult {
  /** Whether a new line was written (false when the host was already present). */
  added: boolean;
  /** Human-readable reason when `added` is false. */
  reason?: string;
}

/** Access pattern over the durable, file-backed firewall policy lists. */
export interface PolicyStore {
  /**
   * Append a host to the allow or deny list, selected by `allow`. Idempotent: a host
   * already present yields `{ added: false }`. Bootstraps the file with a standard header
   * when it does not yet exist (handles projects predating the denied list).
   * @param host The normalized target host.
   * @param allow True to append to the allow list, false to the deny list.
   * @returns Whether a line was written.
   */
  add(host: string, allow: boolean): Promise<PolicyAddResult>;
}

/**
 * Filesystem-backed {@link PolicyStore}. The firewall sidecar live-reloads on write.
 * Construct one at the composition root.
 */
export class FilePolicyStore implements PolicyStore {
  /** @inheritDoc */
  public async add(host: string, allow: boolean): Promise<PolicyAddResult> {
    const list = allow ? "allowed" : "denied";
    const filePath = DOMAIN_LIST_PATHS[list];

    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      // File doesn't exist yet (project predates this list being added to the template).
      // Bootstrap it with the standard header so the firewall sidecar can parse it.
      content = DOMAIN_LIST_HEADERS[list];
      console.log(`[policy-list] created ${filePath}`);
    }

    const lines = content.split("\n");
    if (lines.some((l) => l.trim() === host)) {
      return { added: false, reason: "already present" };
    }

    const updated = content.endsWith("\n")
      ? `${content}${host}\n`
      : `${content}\n${host}\n`;

    await writeFile(filePath, updated, "utf8");
    console.log(`[policy-list] ${list} ← ${host}`);

    return { added: true };
  }
}
