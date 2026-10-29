import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GeneratorError } from "../src/errors.ts";
import { resolveSourceConfig } from "../src/source.ts";
import { approveConfigSet, collectConfigSet, isConfigSetApproved, latestApprovedSnapshot } from "../src/trust.ts";
import { createHostFixture, type HostFixture, writeFiles } from "./fixtures.ts";

let fixture: HostFixture;

beforeEach(() => {
  fixture = createHostFixture();
});

afterEach(() => fixture.cleanup());

describe("resolveSourceConfig", () => {
  test("falls back to the default config when the project has none", () => {
    expect(resolveSourceConfig(fixture.context)).toMatchObject({ configPath: fixture.context.defaultConfig, isDefault: true });
  });

  test("prefers .devcontainer/devcontainer.json, then .devcontainer.json", () => {
    const { worktreePath } = fixture.context;
    writeFiles(worktreePath, { ".devcontainer.json": "{}" });
    expect(resolveSourceConfig(fixture.context)).toEqual({
      configPath: path.join(worktreePath, ".devcontainer.json"),
      configDir: worktreePath,
      isDefault: false,
    });
    writeFiles(worktreePath, { ".devcontainer/devcontainer.json": "{}" });
    expect(resolveSourceConfig(fixture.context).configPath).toBe(path.join(worktreePath, ".devcontainer", "devcontainer.json"));
  });

  test("uses the default when forced, even with a project config", () => {
    writeFiles(fixture.context.worktreePath, { ".devcontainer/devcontainer.json": "{}" });
    expect(resolveSourceConfig({ ...fixture.context, shouldForceDefault: true }).isDefault).toBe(true);
  });

  test("refuses to guess between configs in .devcontainer/ subfolders", () => {
    writeFiles(fixture.context.worktreePath, { ".devcontainer/a/devcontainer.json": "{}", ".devcontainer/b/devcontainer.json": "{}" });
    expect(() => resolveSourceConfig(fixture.context)).toThrow(GeneratorError);
  });
});

describe("collectConfigSet and approval", () => {
  function projectSet(): ReturnType<typeof collectConfigSet> {
    const { worktreePath } = fixture.context;
    return collectConfigSet(
      worktreePath,
      resolveSourceConfig(fixture.context),
      [path.join(worktreePath, ".devcontainer", "compose.yml")],
      { services: { app: { build: { context: worktreePath, dockerfile: "docker/app.Dockerfile" } } } },
    );
  }

  beforeEach(() => {
    writeFiles(fixture.context.worktreePath, {
      ".devcontainer/devcontainer.json": "{}",
      ".devcontainer/compose.yml": "services: {}",
      ".devcontainer/features/f/install.sh": "#!/bin/sh",
      "docker/app.Dockerfile": "FROM ubuntu",
      "src/unrelated.ts": "export {};",
    });
  });

  test("covers the whole .devcontainer folder, the compose files, and the Dockerfiles they build from", () => {
    expect([...projectSet().files.keys()]).toEqual([
      ".devcontainer/compose.yml",
      ".devcontainer/devcontainer.json",
      ".devcontainer/features/f/install.sh",
      "docker/app.Dockerfile",
    ]);
  });

  test("hashes content: stable when unchanged, different after any edit", () => {
    const before = projectSet().hash;
    expect(projectSet().hash).toBe(before);
    writeFileSync(path.join(fixture.context.worktreePath, "docker", "app.Dockerfile"), "FROM ubuntu\nRUN true");
    expect(projectSet().hash).not.toBe(before);
  });

  test("approval is per repo and exact content, and records the snapshot it approved", () => {
    const { trustDir, repo } = fixture.context;
    const configSet = projectSet();
    expect(isConfigSetApproved(trustDir, repo, configSet.hash)).toBe(false);
    expect(latestApprovedSnapshot(trustDir, repo)).toBeUndefined();

    approveConfigSet(trustDir, repo, configSet);
    expect(isConfigSetApproved(trustDir, repo, configSet.hash)).toBe(true);
    expect(isConfigSetApproved(trustDir, "other-repo", configSet.hash)).toBe(false);
    const snapshot = latestApprovedSnapshot(trustDir, repo);
    expect(snapshot !== undefined && existsSync(path.join(snapshot, "docker", "app.Dockerfile"))).toBe(true);
  });
});
