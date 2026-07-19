import { composeProjectName } from "../identifiers.ts";
import { NO_CONTAINER, type ContainerStatus } from "../sources/containers.ts";
import type { DashboardState } from "../store.ts";

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
 * Derives one {@link WorktreeStatus} per checked-out worktree from a store snapshot.
 * @param state - The dashboard store's current snapshot.
 * @returns Statuses in {@link DashboardState.worktrees} order.
 */
export function selectWorktreeStatuses(state: DashboardState): WorktreeStatus[] {
    return state.worktrees.map((worktree): WorktreeStatus => {
        const projectName = composeProjectName(worktree.repo, worktree.branch);
        const { status, containerId, uptime } = state.containers.get(projectName) ?? NO_CONTAINER;
        return { repo: worktree.repo, branch: worktree.branch, status, containerId, uptime };
    });
}
