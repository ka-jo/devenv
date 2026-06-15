import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ApproverConfig } from "./config";

/** Promisified {@link execFile} for awaiting child-process output. */
const execFileAsync = promisify(execFile);

/** Container-internal path the approver writes its generated token to (tmpfs). */
const TOKEN_PATH = "/run/approver/token";

/** Compose service name of the approver sidecar. */
const APPROVER_SERVICE = "approver";

/**
 * Resolve the approver token for the current session.
 *
 * Prefers an explicit `egressApprover.token` (dev: matches a pinned
 * `APPROVER_TOKEN`). Otherwise retrieves the per-start generated token from the
 * running container via `docker compose exec`. The token rotates each container
 * start, so this is called per (re)connect rather than cached across reconnects.
 *
 * @param config The resolved extension configuration.
 * @returns The trimmed token string.
 * @throws {Error} If no compose file can be located when one is required.
 * @throws {Error} If the `docker compose exec` invocation fails or returns empty.
 */
export async function resolveToken(config: ApproverConfig): Promise<string> {
  if (config.token) return config.token;

  const composeFile = resolveComposeFile(config);
  if (!composeFile) {
    throw new Error(
      "no docker-compose.yml found; set egressApprover.dockerComposeFile or egressApprover.token",
    );
  }

  try {
    const { stdout } = await execFileAsync("docker", [
      "compose",
      "-f",
      composeFile,
      "exec",
      "-T",
      APPROVER_SERVICE,
      "cat",
      TOKEN_PATH,
    ]);
    const token = stdout.trim();
    if (!token) throw new Error(`empty token from ${TOKEN_PATH}`);
    return token;
  } catch (err) {
    throw new Error(
      `failed to retrieve approver token via 'docker compose exec ${APPROVER_SERVICE}': ${String(err)}`,
    );
  }
}

/**
 * Locate the docker-compose.yml used for token retrieval: the explicit setting if
 * present, else `<first workspace folder>/.devcontainer/docker-compose.yml`.
 * @param config The resolved extension configuration.
 * @returns An absolute path, or undefined if none can be derived.
 */
function resolveComposeFile(config: ApproverConfig): string | undefined {
  if (config.dockerComposeFile) return config.dockerComposeFile;

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  return path.join(folder.uri.fsPath, ".devcontainer", "docker-compose.yml");
}
