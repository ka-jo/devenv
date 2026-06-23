import * as vscode from "vscode";
import { readConfig } from "./config";
import { resolveEndpoint } from "./endpoint";
import { resolveToken } from "./token";
import { postPolicy } from "./approverClient";

/** The two domain list files managed by the egress firewall. */
export type DomainListKind = "allowed" | "denied";

/**
 * Add a domain to a firewall domain list by calling the approver API.
 *
 * The approver server runs inside the dev container and holds writable bind
 * mounts of the domain list files. Routing through it is necessary because
 * the extension runs on the Windows host and cannot reach files in WSL directly.
 *
 * The firewall sidecar watches the list files via inotify and sends SIGHUP to
 * Squid on change, so the entry is live immediately — no container restart needed.
 *
 * Idempotent: returns `true` without error when the host is already present.
 *
 * @param host The bare hostname to add (no scheme, no path).
 * @param kind Which list to append to.
 * @param output Output channel for diagnostic logging.
 * @returns `true` on success (including already-present), `false` on error.
 */
export async function addToDomainList(
  host: string,
  kind: DomainListKind,
  output: vscode.OutputChannel,
): Promise<boolean> {
  const config = readConfig();
  try {
    const [endpoint, token] = await Promise.all([
      resolveEndpoint(config),
      resolveToken(config),
    ]);
    await postPolicy(endpoint, token, host, kind === "allowed");
    output.appendLine(
      `${new Date().toTimeString().slice(0, 8)} [domain-list] ${kind} ← ${host}`,
    );
    return true;
  } catch (err) {
    const msg = `failed to add ${host} to ${kind} list: ${String(err)}`;
    output.appendLine(
      `${new Date().toTimeString().slice(0, 8)} [domain-list] error: ${msg}`,
    );
    void vscode.window.showErrorMessage(`Egress approver: ${msg}`);
    return false;
  }
}
