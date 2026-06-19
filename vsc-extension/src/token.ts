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
 * @throws {Error} If the approver container cannot be found.
 * @throws {Error} If `docker exec` fails or returns an empty token.
 */
export async function resolveToken(config: ApproverConfig): Promise<string> {
  if (config.token) return config.token;

  const containerId = await findApproverContainer(config.containerName);

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
 * Locate the running approver container.
 *
 * Uses the explicit container name when provided (injected into workspace
 * settings by `devenv devcontainer` via the `egressApprover.containerName`
 * setting in `devcontainer.json`). Falls back to querying Docker for the first
 * running container with `com.docker.compose.service=approver`; this handles
 * dev setups not bootstrapped by `devenv devcontainer`, but is ambiguous when
 * multiple devcontainers with an approver service are running simultaneously —
 * set `egressApprover.containerName` explicitly in that case.
 *
 * @param containerName Optional explicit container name or ID override.
 * @returns The container name to pass to `docker exec`.
 * @throws {Error} If no running approver container can be found.
 */
async function findApproverContainer(containerName: string): Promise<string> {
  if (containerName) return containerName;

  const { stdout } = await execFileAsync("docker", [
    "ps",
    "--filter",
    "label=com.docker.compose.service=approver",
    "--format",
    "{{.Names}}",
  ]);

  const name = stdout.trim().split("\n")[0]?.trim();
  if (!name) {
    throw new Error(
      "no running approver container found; set egressApprover.containerName or egressApprover.token",
    );
  }
  return name;
}
