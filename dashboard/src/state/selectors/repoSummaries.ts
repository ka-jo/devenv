import { composeProjectName } from "../identifiers.ts";
import type { DashboardState } from "../store.ts";
import type { WorktreeInfo } from "../sources/worktrees.ts";

/** Sidebar row data for one repo: how many worktrees it has checked out and how many agents are running across them. */
export interface RepoSummary {
    /** Bare repo name under `worktrees/`. */
    readonly repo: string;
    /** Number of checked-out worktrees for this repo. */
    readonly worktreeCount: number;
    /** Number of running background Claude Code agents across this repo's worktree containers. */
    readonly agentCount: number;
}

/**
 * Derives one {@link RepoSummary} per repo under `worktrees/` from a store snapshot.
 * @param state - The dashboard store's current snapshot.
 * @returns Per-repo summaries, in {@link DashboardState.repos} order.
 */
export function selectRepoSummaries(state: DashboardState): RepoSummary[] {
    const byRepo = new Map<string, readonly WorktreeInfo[]>();
    for (const worktree of state.worktrees) {
        const existing = byRepo.get(worktree.repo);
        byRepo.set(worktree.repo, existing ? [...existing, worktree] : [worktree]);
    }

    return state.repos.map((repo): RepoSummary => {
        const repoWorktrees = byRepo.get(repo) ?? [];
        const agentCount = repoWorktrees.reduce((sum, worktree): number => {
            const projectName = composeProjectName(worktree.repo, worktree.branch);
            return sum + (state.agentCounts.get(projectName) ?? 0);
        }, 0);
        return { repo, worktreeCount: repoWorktrees.length, agentCount };
    });
}
