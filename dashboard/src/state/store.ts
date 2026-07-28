import { logError } from "../lib/log.ts";
import { composeProjectName } from "./identifiers.ts";
import { listBackgroundAgents, type AgentInfo } from "./sources/agents.ts";
import { listAllContainerInfos, type ContainerInfo } from "./sources/containers.ts";
import { listRepos, listWorktrees, type WorktreeInfo } from "./sources/worktrees.ts";

/** How often to refresh the store while it has at least one subscriber, in milliseconds. */
const POLL_INTERVAL_MS = 3000;

/** One consistent snapshot of every repo/worktree/container/agent fact the dashboard renders from. */
export interface DashboardState {
    /** Repo names with a bare `.git` under `worktrees/`, sorted alphabetically. */
    readonly repos: readonly string[];
    /** Every checked-out worktree, across every repo. */
    readonly worktrees: readonly WorktreeInfo[];
    /** Container info by compose project name ({@link composeProjectName}). Missing entry means no container exists yet. */
    readonly containers: ReadonlyMap<string, ContainerInfo>;
    /** Running background agent sessions by compose project name. Only populated for worktrees whose container is running. */
    readonly agentsByProject: ReadonlyMap<string, readonly AgentInfo[]>;
}

const EMPTY_STATE: DashboardState = { repos: [], worktrees: [], containers: new Map(), agentsByProject: new Map() };

let state: DashboardState = EMPTY_STATE;
const listeners = new Set<() => void>();
let pollHandle: ReturnType<typeof setInterval> | undefined;

/**
 * Reads the dashboard store's current snapshot. Safe to call from outside React (e.g. a
 * keybinding handler) — unlike a subscription, this never re-renders anything on its own.
 * @returns The most recent snapshot, or {@link EMPTY_STATE} before the first refresh resolves.
 */
export function getDashboardState(): DashboardState {
    return state;
}

/**
 * Forces an immediate snapshot refresh, notifying subscribers, instead of waiting for the
 * next {@link POLL_INTERVAL_MS} tick. Useful right after an action (dispatch/attach) that's
 * known to have changed agent/container state.
 */
export async function refreshDashboardState(): Promise<void> {
    await refresh();
}

/**
 * Subscribes to dashboard store updates, starting the poll loop on the first subscriber and
 * stopping it once the last one unsubscribes — mirrors the shared firewall stack's
 * start/stop-on-use lifecycle in this repo's own `lib/container.sh`.
 * @param listener - Called after every refresh, with no arguments; read {@link getDashboardState} for the new snapshot.
 * @returns A function that unsubscribes `listener`.
 */
export function subscribeToDashboardState(listener: () => void): () => void {
    listeners.add(listener);
    if (listeners.size === 1) {
        startPolling();
    }
    return (): void => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            stopPolling();
        }
    };
}

/** Refreshes immediately, then starts the recurring poll. */
function startPolling(): void {
    void refresh();
    pollHandle = setInterval((): void => void refresh(), POLL_INTERVAL_MS);
}

/** Stops the recurring poll. Does not reset {@link state} — the last snapshot stays available via {@link getDashboardState}. */
function stopPolling(): void {
    clearInterval(pollHandle);
    pollHandle = undefined;
}

/** Fetches one consistent snapshot (one `docker ps` sweep, not one per worktree) and notifies subscribers. */
async function refresh(): Promise<void> {
    try {
        const repos = listRepos();
        const worktrees = await listWorktrees();
        const containers = await listAllContainerInfos();

        const agentsByProject = new Map<string, readonly AgentInfo[]>();
        await Promise.all(
            worktrees.map(async (worktree): Promise<void> => {
                const projectName = composeProjectName(worktree.repo, worktree.branch);
                if (containers.get(projectName)?.status !== "running") {
                    return;
                }
                agentsByProject.set(projectName, await listBackgroundAgents(projectName, worktree.path));
            }),
        );

        setState({ repos, worktrees, containers, agentsByProject });
    } catch (error) {
        logError("dashboardStore.refresh", error);
    }
}

/** Replaces the current snapshot and notifies every subscriber. */
function setState(next: DashboardState): void {
    state = next;
    for (const listener of listeners) {
        listener();
    }
}
