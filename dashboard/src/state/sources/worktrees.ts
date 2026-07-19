import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** Absolute path to the devenv repo root, derived from this file's location. */
const REPO_DIR = path.resolve(import.meta.dir, "../../../..");

/** Absolute path to the `worktrees/` directory this repo's CLI manages. */
const WORKTREES_DIR = path.join(REPO_DIR, "worktrees");

/** One checked-out worktree, mirroring a row of `_iter_worktrees` (lib/worktree.sh). */
export interface WorktreeInfo {
    /** Name of the bare repo under `worktrees/`, e.g. `"torq"`. */
    readonly repo: string;
    /** Branch path relative to the repo, e.g. `"main"` or `"feature/x"`. */
    readonly branch: string;
    /** Absolute path to the worktree's checkout. */
    readonly path: string;
}

/**
 * Lists repo names with a bare `.git` under `worktrees/`.
 * @returns Repo names, sorted alphabetically.
 */
export function listRepos(): string[] {
    if (!existsSync(WORKTREES_DIR)) {
        return [];
    }
    return readdirSync(WORKTREES_DIR, { withFileTypes: true })
        .filter((entry): boolean => entry.isDirectory() && existsSync(path.join(WORKTREES_DIR, entry.name, ".git")))
        .map((entry): string => entry.name)
        .sort();
}

/** Lists every checked-out worktree for one bare repo via `git worktree list --porcelain`. */
async function listWorktreesForRepo(repo: string): Promise<WorktreeInfo[]> {
    const bare = path.join(WORKTREES_DIR, repo, ".git");
    const proc = Bun.spawn(["git", "-C", bare, "worktree", "list", "--porcelain"], {
        stdout: "pipe",
        stderr: "ignore",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const repoRoot = path.join(WORKTREES_DIR, repo);
    const prefix = `${repoRoot}${path.sep}`;
    const worktrees: WorktreeInfo[] = [];

    for (const line of output.split("\n")) {
        if (!line.startsWith("worktree ")) {
            continue;
        }
        const worktreePath = line.slice("worktree ".length).trim();
        // Excludes the bare repo's own entry (path === worktrees/<repo>, tagged `bare` in
        // porcelain output) and any worktree directory that no longer exists on disk.
        if (worktreePath === repoRoot || !worktreePath.startsWith(prefix) || !existsSync(worktreePath)) {
            continue;
        }
        worktrees.push({ repo, branch: worktreePath.slice(prefix.length), path: worktreePath });
    }
    return worktrees;
}

/**
 * Enumerates every checked-out worktree across every bare repo under `worktrees/`.
 *
 * @returns All worktrees, grouped by repo in the returned order but not sorted within a repo.
 */
export async function listWorktrees(): Promise<WorktreeInfo[]> {
    const repos = listRepos();
    const perRepo = await Promise.all(repos.map(listWorktreesForRepo));
    return perRepo.flat();
}
