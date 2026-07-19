/** Health of a worktree's container, derived from `docker ps` status text. */
export type ContainerStatus = "running" | "stopped" | "error";

/** Container info for one worktree, as shown on its grid card. */
export interface ContainerInfo {
    /** Derived container health. `"stopped"` also covers "never started". */
    readonly status: ContainerStatus;
    /** Short container id (`docker ps` default form), or `undefined` if no container exists yet. */
    readonly containerId: string | undefined;
    /** Human-readable uptime, e.g. `"3 hours"` — only set while `status === "running"`. */
    readonly uptime: string | undefined;
}

/** A container that has never run, or was removed — nothing found for the compose project. */
export const NO_CONTAINER: ContainerInfo = { status: "stopped", containerId: undefined, uptime: undefined };

/**
 * Looks up every devenv-managed container in one `docker ps` sweep, keyed by compose project
 * name.
 * @returns Container info by compose project name. Worktrees with no container simply have no entry.
 */
export async function listAllContainerInfos(): Promise<Map<string, ContainerInfo>> {
    const proc = Bun.spawn(["docker", "ps", "-a", "--format", '{{.ID}}\t{{.Status}}\t{{.Label "com.docker.compose.project"}}'], {
        stdout: "pipe",
        stderr: "ignore",
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
        return new Map();
    }

    const infos = new Map<string, ContainerInfo>();
    for (const line of output.split("\n")) {
        if (line.trim().length === 0) {
            continue;
        }
        const [containerId, statusText, projectName] = line.split("\t");
        if (containerId === undefined || statusText === undefined || projectName === undefined || projectName.length === 0) {
            continue;
        }
        infos.set(projectName, parseContainerInfo(containerId, statusText));
    }
    return infos;
}

/**
 * Builds a {@link ContainerInfo} from one `docker ps` row.
 * @param containerId - Short container id (`docker ps` default form).
 * @param statusText - The raw `Status` column, e.g. `"Up 3 hours"` or `"Exited (0) 5 minutes ago"`.
 * @returns The derived status/id/uptime.
 */
function parseContainerInfo(containerId: string, statusText: string): ContainerInfo {
    return { status: deriveStatus(statusText), containerId, uptime: parseUptime(statusText) };
}

/** Maps a `docker ps` status string to {@link ContainerStatus}. */
function deriveStatus(statusText: string): ContainerStatus {
    if (statusText.startsWith("Up ")) {
        return "running";
    }
    const exitedMatch = /^Exited \((\d+)\)/.exec(statusText);
    if (exitedMatch !== null) {
        return exitedMatch[1] === "0" ? "stopped" : "error";
    }
    return "stopped";
}

/** Extracts the uptime clause from a `"Up ..."` status string, e.g. `"Up 3 hours"` → `"3 hours"`. */
function parseUptime(statusText: string): string | undefined {
    if (!statusText.startsWith("Up ")) {
        return undefined;
    }
    // Strips a trailing health annotation, e.g. "3 hours (healthy)" -> "3 hours".
    return statusText.slice("Up ".length).replace(/\s*\(healthy\)\s*$/, "").trim();
}
