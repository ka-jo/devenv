import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { GeneratorContext } from "./context.ts";
import { GeneratorError } from "./errors.ts";

/** Host paths of the git metadata a worktree's container mounts. */
export interface WorktreeGitLayout {
  /** The worktree's own bare repo, `worktrees/<repo>/.git`. */
  readonly bare: string;
  /** The worktree's admin dir inside the bare repo, `<bare>/worktrees/<name>`. */
  readonly admin: string;
  /** Every other repo's bare `.git`, mounted read-only for cross-project research. */
  readonly otherBares: readonly string[];
}

/**
 * Locates the worktree's bare repo, its admin dir (via the worktree's `.git` file), and every other repo's bare dir.
 *
 * @param context - Supplies the worktree and the worktrees directory.
 * @returns The layout's host paths.
 * @throws {@link GeneratorError} when the worktree's gitdir link is absolute, which can't resolve in the container.
 */
export function resolveWorktreeGitLayout(context: GeneratorContext): WorktreeGitLayout {
  const bare = path.join(context.worktreesDir, context.repo, ".git");
  const gitFile = path.join(context.worktreePath, ".git");
  if (!statSync(gitFile, { throwIfNoEntry: false })?.isFile()) {
    throw new GeneratorError(`${context.worktreePath} is not a git worktree (no .git file)`);
  }
  const gitdir = /^gitdir: (.+)$/m.exec(readFileSync(gitFile, "utf8"))?.[1]?.trim();
  if (gitdir === undefined) {
    throw new GeneratorError(`${gitFile} has no gitdir link`);
  }
  if (path.isAbsolute(gitdir)) {
    throw new GeneratorError(
      `${context.worktreePath} has an absolute gitdir link, which can't resolve inside the container\n` +
        `  fix: git -C ${context.worktreePath} worktree repair --relative-paths`,
    );
  }

  const otherBares = readdirSync(context.worktreesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(context.worktreesDir, entry.name, ".git"))
    .filter((candidate) => candidate !== bare && statSync(candidate, { throwIfNoEntry: false })?.isDirectory() === true)
    .sort();

  return { bare, admin: path.resolve(context.worktreePath, gitdir), otherBares };
}
