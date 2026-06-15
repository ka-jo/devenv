import * as vscode from "vscode";

/** Resolved extension configuration, read from the `egressApprover.*` settings. */
export interface ApproverConfig {
  /** Base URL of the approver sidecar (host loopback publish). */
  endpoint: string;
  /** Pinned dev token; empty means "retrieve from the container". */
  token: string;
  /** Explicit docker-compose.yml path for token retrieval; empty means "derive from workspace". */
  dockerComposeFile: string;
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
    dockerComposeFile: cfg.get<string>("dockerComposeFile", "").trim(),
  };
}
