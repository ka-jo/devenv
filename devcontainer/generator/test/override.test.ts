import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import type { GeneratorContext } from "../src/context.ts";
import { GeneratorError } from "../src/errors.ts";
import { resolveWorktreeGitLayout } from "../src/git.ts";
import { buildOverride, type ComposeMount, renderOverride } from "../src/override.ts";

let root: string;
let context: GeneratorContext;

// A host layout like devenv's: <repoDir>/worktrees/<repo>/{.git (bare), <branch>/} with relative gitdir links.
beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "devenv-generator-"));
  const repoDir = path.join(root, "devenv");
  const worktreesDir = path.join(repoDir, "worktrees");
  const worktreePath = path.join(worktreesDir, "r", "feat", "x");
  mkdirSync(path.join(worktreesDir, "r", ".git", "worktrees", "x"), { recursive: true });
  mkdirSync(path.join(worktreesDir, "other", ".git"), { recursive: true });
  mkdirSync(path.join(worktreesDir, "not-a-repo"), { recursive: true });
  mkdirSync(worktreePath, { recursive: true });
  writeFileSync(path.join(worktreePath, ".git"), "gitdir: ../../.git/worktrees/x\n");

  context = {
    repoDir,
    worktreesDir,
    repo: "r",
    worktreePath,
    projectName: "r-feat-x",
    home: "/home/u",
    stateDir: path.join(root, "state"),
    claudeDataDir: path.join(root, "data", "r-feat-x", "claude"),
    containerRepoDir: "/devenv",
    containerClaudeDir: "/.claude",
    proxyNetwork: "devenv-shared_proxy_net",
    defaultConfig: path.join(repoDir, "devcontainer", "devcontainer.json"),
    featuresDir: path.join(repoDir, "devcontainer", "features"),
    devcontainerCli: "/unused",
  };
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function mountAt(mounts: readonly ComposeMount[], target: string): ComposeMount | undefined {
  return mounts.find((mount) => mount.target === target);
}

describe("resolveWorktreeGitLayout", () => {
  test("resolves the admin dir from the relative gitdir link and lists only other bare repos", () => {
    const git = resolveWorktreeGitLayout(context);
    expect(git.bare).toBe(path.join(context.worktreesDir, "r", ".git"));
    expect(git.admin).toBe(path.join(context.worktreesDir, "r", ".git", "worktrees", "x"));
    expect(git.otherBares).toEqual([path.join(context.worktreesDir, "other", ".git")]);
  });

  test("rejects an absolute gitdir link", () => {
    const absolute = path.join(root, "absolute-wt");
    mkdirSync(absolute, { recursive: true });
    writeFileSync(path.join(absolute, ".git"), "gitdir: /somewhere/.git/worktrees/x\n");
    expect(() => resolveWorktreeGitLayout({ ...context, worktreePath: absolute })).toThrow(GeneratorError);
  });
});

describe("buildOverride", () => {
  test("targets the given service with the fixed name, workdir, proxy network and env", () => {
    const override = buildOverride(context, "app", resolveWorktreeGitLayout(context));
    const app = override.services.app;
    expect(override.name).toBe("r-feat-x");
    expect(app?.container_name).toBe("r-feat-x-devcontainer");
    expect(app?.working_dir).toBe("/devenv/worktrees/r/feat/x");
    expect(app?.networks).toEqual(["proxy_net"]);
    expect(override.networks.proxy_net).toEqual({ external: true, name: "devenv-shared_proxy_net" });
    expect(app?.environment.HTTPS_PROXY).toBe("http://firewall:3128");
    expect(app?.environment.CLAUDE_CONFIG_DIR).toBe("/.claude");
  });

  test("mounts devenv read-only, masks worktrees, and takes only auth and read-only settings from ~/.claude", () => {
    const volumes = buildOverride(context, "app", resolveWorktreeGitLayout(context)).services.app?.volumes ?? [];
    expect(mountAt(volumes, "/devenv")).toMatchObject({ source: context.repoDir, read_only: true });
    expect(mountAt(volumes, "/devenv/worktrees")).toEqual({ type: "tmpfs", target: "/devenv/worktrees", read_only: true });
    expect(mountAt(volumes, "/.claude")).toMatchObject({ source: context.claudeDataDir, read_only: false });
    expect(mountAt(volumes, "/.claude/.credentials.json")).toMatchObject({ read_only: false });
    expect(mountAt(volumes, "/.claude/settings.json")).toMatchObject({ read_only: true });
    const hostClaudeMounts = volumes.filter((mount) => mount.type === "bind" && mount.source.startsWith("/home/u/.claude"));
    expect(hostClaudeMounts).toHaveLength(2);
  });

  test("mirrors the worktree and its repo with read-only git pins, and other repos read-only", () => {
    const volumes = buildOverride(context, "app", resolveWorktreeGitLayout(context)).services.app?.volumes ?? [];
    const readOnlyOf = (target: string): boolean | undefined => mountAt(volumes, target)?.read_only;
    expect(readOnlyOf("/devenv/worktrees/r/feat/x")).toBe(false);
    expect(readOnlyOf("/devenv/worktrees/r/.git")).toBe(false);
    expect(readOnlyOf("/devenv/worktrees/r/.git/worktrees/x")).toBe(false);
    for (const pinned of [
      "/devenv/worktrees/r/feat/x/.git",
      "/devenv/worktrees/r/.git/config",
      "/devenv/worktrees/r/.git/hooks",
      "/devenv/worktrees/r/.git/worktrees",
      "/devenv/worktrees/r/.git/worktrees/x/commondir",
      "/devenv/worktrees/other/.git",
    ]) {
      expect(readOnlyOf(pinned)).toBe(true);
    }
  });

  test("renders YAML that parses back to the same override", () => {
    const override = buildOverride(context, "app", resolveWorktreeGitLayout(context));
    expect(parse(renderOverride(override))).toEqual(override);
  });
});
