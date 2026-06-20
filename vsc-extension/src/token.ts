import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ApproverConfig } from "./config";

/** Promisified {@link execFile} for awaiting child-process output. */
const execFileAsync = promisify(execFile);

/** Container-internal path the approver writes its generated token to (tmpfs). */
const TOKEN_PATH = "/run/approver/token";

/**
 * Resolve the approver token for the current session.
 *
 * Prefers an explicit `egressApprover.token` (dev: matches a pinned
 * `APPROVER_TOKEN`). Otherwise locates the approver container and reads the
 * per-start generated token with `docker exec`. The token rotates each
 * container start, so this is called per (re)connect rather than cached across
 * reconnects.
 *
 * @param config The resolved extension configuration.
 * @returns The trimmed token string.
 * @throws {Error} If no `containerName` is configured (and no token is pinned).
 * @throws {Error} If `docker exec` fails or returns an empty token.
 */
export async function resolveToken(config: ApproverConfig): Promise<string> {
  if (config.token) return config.token;

  const containerId = findApproverContainer(config.containerName);

  try {
    const { stdout } = await execFileAsync("docker", [
      "exec",
      containerId,
      "cat",
      TOKEN_PATH,
    ]);
    const token = stdout.trim();
    if (!token) throw new Error(`empty token at ${TOKEN_PATH}`);
    return token;
  } catch (err) {
    throw new Error(
      `failed to retrieve approver token from container ${containerId}: ${String(err)}`,
    );
  }
}

/**
 * Resolve the approver container name for token retrieval.
 *
 * The name is the one `devenv devcontainer` injects into the dev container's
 * workspace settings (`egressApprover.containerName` in `devcontainer.json`),
 * which scopes each VS Code window to its own approver. There is deliberately
 * no `docker ps` auto-discovery fallback: first-match discovery would attach a
 * window to an arbitrary approver and is what caused requests to fan out across
 * unrelated windows. Callers gate on `containerName`/`token` being present
 * before reaching here, so an empty name is a programming error.
 *
 * @param containerName The explicit container name or ID.
 * @returns The container name to pass to `docker exec`.
 * @throws {Error} If `containerName` is empty.
 */
function findApproverContainer(containerName: string): string {
  if (!containerName) {
    throw new Error(
      "egressApprover.containerName is required to retrieve the token; set it or pin egressApprover.token",
    );
  }
  return containerName;
}
