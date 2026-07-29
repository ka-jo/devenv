import { composeProjectName } from "../identifiers.ts";
import type { AgentInfo } from "../sources/agents.ts";
import { NO_CONTAINER, type ContainerStatus } from "../sources/containers.ts";
import type { DashboardState } from "../store.ts";

/** A worktree row's derived health, one level up from raw {@link ContainerStatus}: `"attention"` is agent-derived and overrides `"running"` when any contained agent is blocked or failed. */
export type CardStatus = ContainerStatus | "attention";

/** One worktree's identity plus its container's derived status and agent sessions. */
export interface WorktreeStatus {
    /** Bare repo name under `worktrees/`. */
    readonly repo: string;
    /** Branch path relative to the repo, e.g. `"main"` or `"feature/x"`. */
    readonly branch: string;
    /** Absolute path to the worktree's checkout. */
    readonly path: string;
    /** Aggregated container/agent health, worst-first across both. */
    readonly status: CardStatus;
    /** The container's own health, independent of agent state. */
    readonly containerStatus: ContainerStatus;
    /** Short container id, or `undefined` if no container exists yet. */
    readonly containerId: string | undefined;
    /** Human-readable uptime, only set while the underlying container is running. */
    readonly uptime: string | undefined;
    /** Background agent sessions running in this worktree's container, if any. */
    readonly agents: readonly AgentInfo[];
}

/**
 * Derives one {@link WorktreeStatus} per checked-out worktree from a store snapshot.
 * @param state - The dashboard store's current snapshot.
 * @returns Statuses in {@link DashboardState.worktrees} order.
 */
export function selectWorktreeStatuses(state: DashboardState): WorktreeStatus[] {
    return state.worktrees.map((worktree): WorktreeStatus => {
        const projectName = composeProjectName(worktree.repo, worktree.branch);
        const { status: containerStatus, containerId, uptime } = state.containers.get(projectName) ?? NO_CONTAINER;
        const agents = state.agentsByProject.get(projectName) ?? [];
        const status = deriveAggregatedStatus(containerStatus, agents);
        return { repo: worktree.repo, branch: worktree.branch, path: worktree.path, status, containerStatus, containerId, uptime, agents };
    });
}

/** Worst-first: a running container whose agents include any `blocked` or `failed` one is surfaced as `"attention"`; otherwise the container's own status stands. */
function deriveAggregatedStatus(containerStatus: ContainerStatus, agents: readonly AgentInfo[]): CardStatus {
    const needsAttention = agents.some((agent): boolean => agent.state === "blocked" || agent.state === "failed");
    return containerStatus === "running" && needsAttention ? "attention" : containerStatus;
}
