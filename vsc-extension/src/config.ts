import * as vscode from "vscode";

/** Resolved extension configuration, read from the `egressApprover.*` settings. */
export interface ApproverConfig {
  /**
   * Explicit approver base URL override; empty means "discover this window's
   * container endpoint via `docker port`" (the normal path, now that the host
   * port is published ephemerally).
   */
  endpoint: string;
  /** Pinned dev token; empty means "retrieve from the container". */
  token: string;
  /**
   * Approver container name or ID, injected per-window by `devenv devcontainer`.
   * Used both to discover the endpoint and to retrieve the token; empty means
   * this window is not a devenv dev container (the extension stays dormant).
   */
  containerName: string;
}

/**
 * Read the current `egressApprover.*` configuration.
 * @returns The resolved {@link ApproverConfig}, with trailing slashes stripped from the endpoint.
 */
export function readConfig(): ApproverConfig {
  const cfg = vscode.workspace.getConfiguration("egressApprover");
  const endpoint = cfg.get<string>("endpoint", "").trim();
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    token: cfg.get<string>("token", "").trim(),
    containerName: cfg.get<string>("containerName", "").trim(),
  };
}
