import {
  composeProjectName,
  countBackgroundAgents,
  isContainerRunning,
} from "./agents.ts";
import { listRepos, listWorktrees, WorktreeInfo } from "./worktrees.ts";

/** Sidebar row data for one repo: how many worktrees it has checked out and how many agents are running across them. */
export interface RepoSummary {
  /** Bare repo name under `worktrees/`. */
  readonly repo: string;
  /** Number of checked-out worktrees for this repo. */
  readonly worktreeCount: number;
  /** Number of running background Claude Code agents across this repo's worktree containers. */
  readonly agentCount: number;
}

/** Counts running background agents for one worktree, `0` without an exec call if its container isn't running. */
async function countAgentsForWorktree(
  repo: string,
  branch: string,
  worktreePath: string,
): Promise<number> {
  const projectName = composeProjectName(repo, branch);
  if (!(await isContainerRunning(projectName))) {
    return 0;
  }
  return countBackgroundAgents(projectName, worktreePath);
}

/**
 * Builds one {@link RepoSummary} per repo under `worktrees/`.
 * @returns Per-repo summaries, in {@link listRepos} order.
 */
export async function listRepoSummaries(): Promise<RepoSummary[]> {
  const repos = listRepos();
  const worktrees = await listWorktrees();

  const byRepo = new Map<string, WorktreeInfo[]>();
  for (const worktree of worktrees) {
    const existing = byRepo.get(worktree.repo);
    if (existing) {
      existing.push(worktree);
    } else {
      byRepo.set(worktree.repo, [worktree]);
    }
  }

  return Promise.all(
    repos.map(async (repo): Promise<RepoSummary> => {
      const repoWorktrees = byRepo.get(repo) ?? [];
      const agentCounts = await Promise.all(
        repoWorktrees.map(
          (wt): Promise<number> =>
            countAgentsForWorktree(wt.repo, wt.branch, wt.path),
        ),
      );
      return {
        repo,
        worktreeCount: repoWorktrees.length,
        agentCount: agentCounts.reduce((sum, count): number => sum + count, 0),
      };
    }),
  );
}
