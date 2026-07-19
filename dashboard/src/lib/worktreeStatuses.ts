import { composeProjectName } from "./agents.ts";
import { getContainerInfo, type ContainerStatus } from "./containers.ts";
import { listWorktrees } from "./worktrees.ts";

/** One worktree's identity plus its container's derived status. */
export interface WorktreeStatus {
    /** Bare repo name under `worktrees/`. */
    readonly repo: string;
    /** Branch path relative to the repo, e.g. `"main"` or `"feature/x"`. */
    readonly branch: string;
    /** Derived container health. */
    readonly status: ContainerStatus;
    /** Short container id, or `undefined` if no container exists yet. */
    readonly containerId: string | undefined;
    /** Human-readable uptime, only set while `status === "running"`. */
    readonly uptime: string | undefined;
}

/**
 * Builds one {@link WorktreeStatus} per checked-out worktree, across every repo.
 * @returns Statuses in {@link listWorktrees} order.
 */
export async function listWorktreeStatuses(): Promise<WorktreeStatus[]> {
    const worktrees = await listWorktrees();
    return Promise.all(
        worktrees.map(async (worktree): Promise<WorktreeStatus> => {
            const projectName = composeProjectName(worktree.repo, worktree.branch);
            const { status, containerId, uptime } = await getContainerInfo(projectName);
            return { repo: worktree.repo, branch: worktree.branch, status, containerId, uptime };
        }),
    );
}
