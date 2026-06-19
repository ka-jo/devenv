import * as vscode from "vscode";

/** Resolved extension configuration, read from the `egressApprover.*` settings. */
export interface ApproverConfig {
  /** Base URL of the approver sidecar (host loopback publish). */
  endpoint: string;
  /** Pinned dev token; empty means "retrieve from the container". */
  token: string;
  /**
   * Explicit container name or ID for token retrieval; empty means
   * "auto-discover via `docker ps --filter label=com.docker.compose.service=approver`".
   */
  containerName: string;
}

/**
 * Read the current `egressApprover.*` configuration.
 * @returns The resolved {@link ApproverConfig}, with trailing slashes stripped from the endpoint.
 */
export function readConfig(): ApproverConfig {
  const cfg = vscode.workspace.getConfiguration("egressApprover");
  const endpoint = cfg.get<string>("endpoint", "http://127.0.0.1:3129");
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    token: cfg.get<string>("token", "").trim(),
    containerName: cfg.get<string>("containerName", "").trim(),
  };
}
