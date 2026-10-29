import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { ComposeModel } from "../src/compose.ts";
import type { GeneratorContext } from "../src/context.ts";
import { GeneratorError } from "../src/errors.ts";
import { resolveWorktreeGitLayout } from "../src/git.ts";
import { buildOverride, COMPOSE_RESET, type ComposeMount, renderOverride } from "../src/override.ts";
import { createHostFixture, type HostFixture } from "./fixtures.ts";

let fixture: HostFixture;
let context: GeneratorContext;

beforeAll(() => {
  fixture = createHostFixture();
  context = fixture.context;
});

afterAll(() => fixture.cleanup());

// What compose normalizes the default config to: one service on the implicit default network.
const defaultModel: ComposeModel = {
  services: { devcontainer: { networks: { default: null } } },
  networks: { default: {} },
};

function mountAt(mounts: readonly ComposeMount[] | undefined, target: string): ComposeMount | undefined {
  return mounts?.find((mount) => mount.target === target);
}

describe("resolveWorktreeGitLayout", () => {
  test("resolves the admin dir from the relative gitdir link and lists only other bare repos", () => {
    const git = resolveWorktreeGitLayout(context);
    expect(git.bare).toBe(path.join(context.worktreesDir, "r", ".git"));
    expect(git.admin).toBe(path.join(context.worktreesDir, "r", ".git", "worktrees", "x"));
    expect(git.otherBares).toEqual([path.join(context.worktreesDir, "other", ".git")]);
  });

  test("rejects an absolute gitdir link", () => {
    const absolute = path.join(fixture.root, "absolute-wt");
    mkdirSync(absolute, { recursive: true });
    writeFileSync(path.join(absolute, ".git"), "gitdir: /somewhere/.git/worktrees/x\n");
    expect(() => resolveWorktreeGitLayout({ ...context, worktreePath: absolute })).toThrow(GeneratorError);
  });

  test("rejects a directory that isn't a git worktree", () => {
    expect(() => resolveWorktreeGitLayout({ ...context, worktreePath: fixture.root })).toThrow("not a git worktree");
  });
});

describe("buildOverride: agent layer", () => {
  test("targets the primary with the fixed name, workdir, proxy network and env", () => {
    const { override } = buildOverride(context, defaultModel, "devcontainer", resolveWorktreeGitLayout(context));
    const primary = override.services.devcontainer;
    expect(override.name).toBe("r-feat-x");
    expect(primary?.container_name).toBe("r-feat-x-devcontainer");
    expect(primary?.working_dir).toBe("/devenv/worktrees/r/feat/x");
    expect(primary?.environment?.HTTPS_PROXY).toBe("http://firewall:3128");
    expect(primary?.environment?.CLAUDE_CONFIG_DIR).toBe("/.claude");
    expect(override.networks.proxy_net).toEqual({ external: true, name: "devenv-shared_proxy_net" });
  });

  test("keeps a lone primary on proxy_net only, defining no other network", () => {
    const { override, notices } = buildOverride(context, defaultModel, "devcontainer", resolveWorktreeGitLayout(context));
    expect(override.services.devcontainer?.networks).toEqual(["proxy_net"]);
    expect(Object.keys(override.networks)).toEqual(["proxy_net"]);
    expect(notices).toEqual([]);
  });

  test("mounts devenv read-only, masks worktrees, and takes only auth and read-only settings from ~/.claude", () => {
    const volumes = buildOverride(context, defaultModel, "devcontainer", resolveWorktreeGitLayout(context)).override
      .services.devcontainer?.volumes;
    expect(mountAt(volumes, "/devenv")).toMatchObject({ source: context.repoDir, read_only: true });
    expect(mountAt(volumes, "/devenv/worktrees")).toEqual({ type: "tmpfs", target: "/devenv/worktrees", read_only: true });
    expect(mountAt(volumes, "/.claude")).toMatchObject({ source: context.claudeDataDir, read_only: false });
    expect(mountAt(volumes, "/.claude/.credentials.json")).toMatchObject({ read_only: false });
    expect(mountAt(volumes, "/.claude/settings.json")).toMatchObject({ read_only: true });
    const hostClaude = (volumes ?? []).filter((mount) => mount.type === "bind" && mount.source.startsWith("/home/u/.claude"));
    expect(hostClaude).toHaveLength(2);
  });

  test("mirrors the worktree and its repo with read-only git pins, and other repos read-only", () => {
    const volumes = buildOverride(context, defaultModel, "devcontainer", resolveWorktreeGitLayout(context)).override
      .services.devcontainer?.volumes;
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
});

describe("buildOverride: project fixes", () => {
  const projectModel = (): ComposeModel => ({
    services: {
      app: {
        networks: { backend: null },
        ports: [{ target: 3000 }],
        volumes: [{ type: "bind", source: context.worktreePath, target: "/workspaces/x" }],
      },
      cache: {
        networks: { backend: null, default: null },
        ports: [{ target: 6379 }],
        container_name: "fixed",
        volumes: [{ type: "bind", source: context.worktreePath, target: "/src" }],
      },
    },
    networks: { backend: { ipam: { config: [{ subnet: "10.0.0.0/24" }] } }, default: {} },
  });

  test("puts the primary on its project networks plus proxy_net, keeping default when a sidecar shares it", () => {
    const { override } = buildOverride(context, projectModel(), "app", resolveWorktreeGitLayout(context));
    expect(override.services.app?.networks).toEqual(["backend", "proxy_net"]);
    const sharedDefault: ComposeModel = {
      services: { app: { networks: { default: null } }, cache: { networks: { default: null } } },
      networks: { default: {} },
    };
    expect(buildOverride(context, sharedDefault, "app", resolveWorktreeGitLayout(context)).override.services.app?.networks).toEqual(
      ["default", "proxy_net"],
    );
  });

  test("makes every used project network internal with no host-side address, dropping fixed subnets", () => {
    const { override, notices } = buildOverride(context, projectModel(), "app", resolveWorktreeGitLayout(context));
    expect(override.networks.backend).toEqual({
      internal: true,
      driver_opts: { "com.docker.network.bridge.inhibit_ipv4": "true" },
      ipam: COMPOSE_RESET,
    });
    expect(override.networks.default).toMatchObject({ internal: true });
    expect(notices).toContain("network backend: fixed subnet removed (it would collide across worktrees)");
  });

  test("leaves external networks alone (validation rejects them)", () => {
    const model: ComposeModel = { ...projectModel(), networks: { ...projectModel().networks, backend: { external: true } } };
    expect(buildOverride(context, model, "app", resolveWorktreeGitLayout(context)).override.networks.backend).toBeUndefined();
  });

  test("resets published ports everywhere and container_name on sidecars only", () => {
    const { override, notices } = buildOverride(context, projectModel(), "app", resolveWorktreeGitLayout(context));
    expect(override.services.app?.ports).toBe(COMPOSE_RESET);
    expect(override.services.cache?.ports).toBe(COMPOSE_RESET);
    expect(override.services.cache?.container_name).toBe(COMPOSE_RESET);
    expect(override.services.app?.container_name).toBe("r-feat-x-devcontainer");
    expect(notices).toContain("service cache: container_name removed (it would collide across worktrees)");
  });

  test("pins the worktree's .git file read-only wherever any service mounts the whole worktree", () => {
    const { override } = buildOverride(context, projectModel(), "app", resolveWorktreeGitLayout(context));
    const gitFile = path.join(context.worktreePath, ".git");
    expect(mountAt(override.services.app?.volumes, "/workspaces/x/.git")).toEqual({
      type: "bind",
      source: gitFile,
      target: "/workspaces/x/.git",
      read_only: true,
    });
    expect(mountAt(override.services.cache?.volumes, "/src/.git")).toMatchObject({ source: gitFile, read_only: true });
  });
});

describe("renderOverride", () => {
  test("renders resets as compose's !reset null and round-trips everything else", () => {
    const { override } = buildOverride(context, defaultModel, "devcontainer", resolveWorktreeGitLayout(context));
    expect(parse(renderOverride(override))).toEqual(override);
    const yaml = renderOverride({ name: "p", services: { app: { ports: COMPOSE_RESET } }, networks: {} });
    expect(yaml).toContain("ports: !reset null");
  });
});
