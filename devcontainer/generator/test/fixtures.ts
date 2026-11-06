import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GeneratorContext } from "../src/context.ts";

/** A throwaway host layout like devenv's, plus a context describing one of its worktrees. */
export interface HostFixture {
  /** Root of the temp dir holding everything. */
  readonly root: string;
  /** Context for the `r` repo's `feat/x` worktree. */
  readonly context: GeneratorContext;
  /** Removes the temp dir. */
  readonly cleanup: () => void;
}

/**
 * Creates `<root>/devenv/worktrees/{r/.git (bare, with a worktrees/x admin dir), r/feat/x (relative gitdir link),
 * other/.git, not-a-repo/}`.
 *
 * @returns The layout and a context for `r`/`feat/x`.
 */
export function createHostFixture(): HostFixture {
  const root = mkdtempSync(path.join(tmpdir(), "devenv-generator-"));
  const repoDir = path.join(root, "devenv");
  const worktreesDir = path.join(repoDir, "worktrees");
  const worktreePath = path.join(worktreesDir, "r", "feat", "x");
  mkdirSync(path.join(worktreesDir, "r", ".git", "worktrees", "x"), { recursive: true });
  mkdirSync(path.join(worktreesDir, "other", ".git"), { recursive: true });
  mkdirSync(path.join(worktreesDir, "not-a-repo"), { recursive: true });
  mkdirSync(worktreePath, { recursive: true });
  writeFileSync(path.join(worktreePath, ".git"), "gitdir: ../../.git/worktrees/x\n");

  return {
    root,
    context: {
      repoDir,
      worktreesDir,
      repo: "r",
      branch: "feat/x",
      worktreePath,
      projectName: "r-feat-x",
      home: "/home/u",
      stateDir: path.join(root, "state", "r-feat-x"),
      claudeDataDir: path.join(root, "data", "r-feat-x", "claude"),
      containerRepoDir: "/devenv",
      containerClaudeDir: "/.claude",
      proxyNetwork: "devenv-shared_proxy_net",
      defaultConfig: path.join(repoDir, "devcontainer", "default", "devcontainer.json"),
      featuresDir: path.join(repoDir, "devcontainer", "features"),
      devcontainerCli: "/unused",
      trustDir: path.join(root, "state", "trust"),
      isCreating: true,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Writes files under a directory, creating parents.
 *
 * @param dir - The base directory.
 * @param files - Contents by relative path.
 */
export function writeFiles(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [file, content] of Object.entries(files)) {
    const destination = path.join(dir, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
}
