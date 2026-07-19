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
const NO_CONTAINER: ContainerInfo = { status: "stopped", containerId: undefined, uptime: undefined };

/**
 * Looks up a worktree's container status via `docker ps -a`.
 * @param projectName - Compose project name from {@link composeProjectName} (agents.ts).
 * @returns The container's derived status/id/uptime. Degrades to {@link NO_CONTAINER} on any lookup failure.
 */
export async function getContainerInfo(projectName: string): Promise<ContainerInfo> {
    const proc = Bun.spawn(
        ["docker", "ps", "-a", "--filter", `label=com.docker.compose.project=${projectName}`, "--format", "{{.ID}}\t{{.Status}}"],
        { stdout: "pipe", stderr: "ignore" },
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
        return NO_CONTAINER;
    }

    // A compose project can have more than one container in general, but this repo's
    // devcontainer stack defines exactly one (`devcontainer`) per project.
    const firstLine = output.split("\n").find((line): boolean => line.trim().length > 0);
    if (firstLine === undefined) {
        return NO_CONTAINER;
    }

    const [containerId, statusText] = firstLine.split("\t");
    if (containerId === undefined || statusText === undefined) {
        return NO_CONTAINER;
    }

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
