import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GeneratorError } from "../src/errors.ts";
import { resolveSourceConfig } from "../src/source.ts";
import {
  approveConfigSet,
  collectConfigSet,
  configNameOf,
  isConfigSetApproved,
  lastApprovedSnapshot,
  OUTSIDE_ROOT_DIR,
} from "../src/trust.ts";
import { createHostFixture, type HostFixture, writeFiles } from "./fixtures.ts";

let fixture: HostFixture;

beforeEach(() => {
  fixture = createHostFixture();
});

afterEach(() => fixture.cleanup());

describe("resolveSourceConfig", () => {
  test("falls back to the default config when the project has none", () => {
    expect(resolveSourceConfig(fixture.context).configPath).toBe(fixture.context.defaultConfig);
  });

  test("prefers .devcontainer/devcontainer.json, then .devcontainer.json", () => {
    const { worktreePath } = fixture.context;
    writeFiles(worktreePath, { ".devcontainer.json": "{}" });
    expect(resolveSourceConfig(fixture.context)).toEqual({
      configPath: path.join(worktreePath, ".devcontainer.json"),
      configDir: worktreePath,
      rootDir: worktreePath,
    });
    writeFiles(worktreePath, { ".devcontainer/devcontainer.json": "{}" });
    expect(resolveSourceConfig(fixture.context)).toEqual({
      configPath: path.join(worktreePath, ".devcontainer", "devcontainer.json"),
      configDir: path.join(worktreePath, ".devcontainer"),
      rootDir: worktreePath,
    });
  });

  test("uses the default when forced, even with a project config", () => {
    writeFiles(fixture.context.worktreePath, { ".devcontainer/devcontainer.json": "{}" });
    expect(resolveSourceConfig({ ...fixture.context, shouldForceDefault: true }).configPath).toBe(fixture.context.defaultConfig);
  });

  test("refuses to guess between configs in .devcontainer/ subfolders", () => {
    writeFiles(fixture.context.worktreePath, { ".devcontainer/a/devcontainer.json": "{}", ".devcontainer/b/devcontainer.json": "{}" });
    expect(() => resolveSourceConfig(fixture.context)).toThrow(GeneratorError);
  });
});

describe("collectConfigSet", () => {
  const CONFIG_FILES = {
    ".devcontainer/devcontainer.json": "{}",
    ".devcontainer/compose.yml": "services: {}",
    ".devcontainer/features/f/install.sh": "#!/bin/sh",
    "docker/app.Dockerfile": "FROM ubuntu",
    "src/unrelated.ts": "export {};",
  };

  function configSetIn(worktreePath: string, home = "/home/u"): ReturnType<typeof collectConfigSet> {
    return collectConfigSet(
      resolveSourceConfig({ ...fixture.context, worktreePath }),
      { features: { "./features/f": {} } },
      [path.join(worktreePath, ".devcontainer", "compose.yml")],
      { services: { app: { build: { context: worktreePath, dockerfile: "docker/app.Dockerfile" } } } },
      home,
    );
  }

  beforeEach(() => {
    writeFiles(fixture.context.worktreePath, CONFIG_FILES);
  });

  test("covers the whole .devcontainer folder, the compose files, and the Dockerfiles they build from", () => {
    expect([...configSetIn(fixture.context.worktreePath).files.keys()]).toEqual([
      ".devcontainer/compose.yml",
      ".devcontainer/devcontainer.json",
      ".devcontainer/features/f/install.sh",
      "docker/app.Dockerfile",
    ]);
  });

  test("hashes content: stable when unchanged, different after any edit", () => {
    const before = configSetIn(fixture.context.worktreePath).hash;
    expect(configSetIn(fixture.context.worktreePath).hash).toBe(before);
    writeFileSync(path.join(fixture.context.worktreePath, "docker", "app.Dockerfile"), "FROM ubuntu\nRUN true");
    expect(configSetIn(fixture.context.worktreePath).hash).not.toBe(before);
  });

  test("hashes the same config the same wherever it is", () => {
    const elsewhere = path.join(fixture.root, "configs", "copy");
    writeFiles(elsewhere, CONFIG_FILES);
    expect(configSetIn(elsewhere).hash).toBe(configSetIn(fixture.context.worktreePath).hash);
  });

  test("keys files outside the config's folder by their absolute path", () => {
    const outside = path.join(fixture.root, "shared", "compose.yml");
    writeFiles(path.dirname(outside), { "compose.yml": "services: {}" });
    const configSet = collectConfigSet(resolveSourceConfig(fixture.context), {}, [outside], { services: {} }, "/home/u");
    expect([...configSet.files.keys()]).toContain(path.join(OUTSIDE_ROOT_DIR, outside));
    expect(configSet.files.has(".devcontainer/devcontainer.json")).toBe(true);
  });

  test("covers only what a config references when its folder holds the home directory", () => {
    const { worktreePath } = fixture.context;
    const home = path.join(worktreePath, ".devcontainer");
    expect([...configSetIn(worktreePath, home).files.keys()]).toEqual([
      ".devcontainer/compose.yml",
      ".devcontainer/devcontainer.json",
      ".devcontainer/features/f/install.sh",
      "docker/app.Dockerfile",
    ]);
    writeFiles(worktreePath, { ".devcontainer/notes.md": "x" });
    expect(configSetIn(worktreePath, home).files.has(".devcontainer/notes.md")).toBe(false);
  });
});

describe("approval", () => {
  test("is per exact content, for any config, and records each name's last approved snapshot", () => {
    const { trustDir } = fixture.context;
    writeFiles(fixture.context.worktreePath, { ".devcontainer.json": "{}" });
    const configSet = collectConfigSet(resolveSourceConfig(fixture.context), {}, [], { services: {} }, "/home/u");
    expect(isConfigSetApproved(trustDir, configSet.hash)).toBe(false);
    expect(lastApprovedSnapshot(trustDir, "r:.devcontainer.json")).toBeUndefined();

    approveConfigSet(trustDir, "r:.devcontainer.json", configSet);
    expect(isConfigSetApproved(trustDir, configSet.hash)).toBe(true);
    expect(lastApprovedSnapshot(trustDir, "other:.devcontainer.json")).toBeUndefined();
    const snapshot = lastApprovedSnapshot(trustDir, "r:.devcontainer.json");
    expect(snapshot !== undefined && existsSync(path.join(snapshot, ".devcontainer.json"))).toBe(true);
  });
});

describe("configNameOf", () => {
  test("names a worktree's config by repo and path, the same on every branch", () => {
    const { worktreesDir } = fixture.context;
    const main = path.join(worktreesDir, "r", "main");
    writeFiles(main, { ".git": "gitdir: ../.git/worktrees/main\n", ".devcontainer/devcontainer.json": "{}" });
    writeFiles(fixture.context.worktreePath, { ".devcontainer/devcontainer.json": "{}" });

    expect(configNameOf(fixture.context, resolveSourceConfig(fixture.context))).toBe("r:.devcontainer/devcontainer.json");
    const mainSource = resolveSourceConfig({ ...fixture.context, worktreePath: main });
    expect(configNameOf(fixture.context, mainSource)).toBe("r:.devcontainer/devcontainer.json");
  });

  test("names any other config by its absolute path", () => {
    const source = resolveSourceConfig(fixture.context);
    expect(configNameOf(fixture.context, source)).toBe(fixture.context.defaultConfig);
  });
});
