import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ApproverConfig } from "./config";

/** Promisified {@link execFile} for awaiting child-process output. */
const execFileAsync = promisify(execFile);

/** Container-internal port the approver listens on (published to an ephemeral host port). */
const APPROVER_CONTAINER_PORT = 3129;

/**
 * Resolve the approver base URL for the current window.
 *
 * Prefers an explicit `egressApprover.endpoint` override (dev/test, or non-Docker
 * setups). Otherwise discovers this window's container endpoint via
 * `docker port <containerName> 3129/tcp`: the host port is published ephemerally
 * (see docker-compose.yml) so concurrent stacks don't collide, and because
 * `containerName` is injected per-window by `devenv devcontainer`, the resolved
 * endpoint is unambiguously this window's own approver. Resolved per (re)connect
 * — like the token — since the mapping is stable for a container's lifetime but
 * changes across restarts.
 *
 * @param config The resolved extension configuration.
 * @returns The approver base URL (no trailing slash).
 * @throws {Error} If neither an endpoint override nor a `containerName` is set.
 * @throws {Error} If `docker port` fails or the container has no published mapping.
 */
export async function resolveEndpoint(config: ApproverConfig): Promise<string> {
  if (config.endpoint) return config.endpoint;
  if (!config.containerName) {
    // Reachable only via the pinned-token dev path: with the host port now
    // ephemeral there is no well-known fallback, so the endpoint must be given.
    throw new Error(
      "egressApprover.endpoint is required when egressApprover.token is pinned without a containerName",
    );
  }
  return discoverEndpoint(config.containerName);
}

/**
 * Discover the ephemeral host endpoint Docker assigned to the approver's port.
 *
 * @param containerName The approver container name or ID.
 * @returns The approver base URL (no trailing slash).
 * @throws {Error} If `docker port` fails or returns no mapping for the port.
 */
async function discoverEndpoint(containerName: string): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("docker", [
      "port",
      containerName,
      `${APPROVER_CONTAINER_PORT}/tcp`,
    ]));
  } catch (err) {
    throw new Error(
      `failed to resolve approver endpoint for container ${containerName}: ${String(err)}`,
    );
  }

  // `docker port` prints `host:port` per published binding, one per line.
  const mapping = stdout.trim().split("\n")[0]?.trim();
  if (!mapping) {
    throw new Error(
      `container ${containerName} has no published mapping for ${APPROVER_CONTAINER_PORT}/tcp`,
    );
  }

  // We publish to 127.0.0.1, so the host is loopback; normalize a wildcard host
  // defensively in case the binding was widened.
  const hostPort = mapping
    .replace(/^0\.0\.0\.0:/, "127.0.0.1:")
    .replace(/^\[::\]:/, "127.0.0.1:");
  return `http://${hostPort}`;
}
