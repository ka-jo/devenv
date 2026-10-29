import { describe, expect, test } from "bun:test";
import { deriveGeneratedConfig, localFeaturePaths } from "../src/config.ts";
import { GeneratorError } from "../src/errors.ts";

const inputs = {
  sourceDir: "/home/u/devenv/devcontainer",
  overridePath: "/home/u/.local/state/devenv/r-main/override.yaml",
  workspaceFolder: "/devenv/worktrees/r/main",
  isDefault: false,
};

describe("deriveGeneratedConfig", () => {
  test("makes compose paths absolute and appends the override last", () => {
    const { config, composeFiles } = deriveGeneratedConfig(
      { service: "app", dockerComposeFile: ["docker-compose.yml", "../other.yml"] },
      inputs,
    );
    expect(composeFiles).toEqual(["/home/u/devenv/devcontainer/docker-compose.yml", "/home/u/devenv/other.yml"]);
    expect(config.dockerComposeFile).toEqual([...composeFiles, inputs.overridePath]);
  });

  test("accepts a single compose path", () => {
    const { composeFiles } = deriveGeneratedConfig({ service: "app", dockerComposeFile: "compose.yml" }, inputs);
    expect(composeFiles).toEqual(["/home/u/devenv/devcontainer/compose.yml"]);
  });

  test("sets the mirrored workspace folder and injects devenv's agent Feature from its own subdir", () => {
    const { config } = deriveGeneratedConfig(
      { service: "app", dockerComposeFile: "compose.yml", workspaceFolder: "/workspaces/x", features: { "./features/fnm": {} } },
      inputs,
    );
    expect(config.workspaceFolder).toBe(inputs.workspaceFolder);
    expect(config.features).toEqual({ "./features/fnm": {}, "./.devenv-features/agent": {} });
  });

  test("says when a project's workspaceFolder is replaced, but not for the default config", () => {
    const source = { service: "app", dockerComposeFile: "compose.yml", workspaceFolder: "/workspaces/x" };
    expect(deriveGeneratedConfig(source, inputs).notices).toEqual([
      "workspaceFolder changed from /workspaces/x to /devenv/worktrees/r/main",
    ]);
    expect(deriveGeneratedConfig(source, { ...inputs, isDefault: true }).notices).toEqual([]);
    expect(deriveGeneratedConfig({ ...source, workspaceFolder: inputs.workspaceFolder }, inputs).notices).toEqual([]);
  });

  test("strips a project's initializeCommand, which would run on the host, and says so", () => {
    const { config, notices } = deriveGeneratedConfig(
      { service: "app", dockerComposeFile: "compose.yml", initializeCommand: "touch /tmp/x" },
      inputs,
    );
    expect(config).not.toHaveProperty("initializeCommand");
    expect(notices).toEqual(["initializeCommand removed (it would run on the host)"]);
  });

  test("keeps the default config's initializeCommand", () => {
    const { config, notices } = deriveGeneratedConfig(
      { service: "app", dockerComposeFile: "compose.yml", initializeCommand: "true" },
      { ...inputs, isDefault: true },
    );
    expect(config.initializeCommand).toBe("true");
    expect(notices).toEqual([]);
  });

  test("turns on updateRemoteUserUID for project configs only", () => {
    const source = { service: "app", dockerComposeFile: "compose.yml", updateRemoteUserUID: false };
    expect(deriveGeneratedConfig(source, inputs).config.updateRemoteUserUID).toBe(true);
    expect(deriveGeneratedConfig(source, { ...inputs, isDefault: true }).config.updateRemoteUserUID).toBe(false);
  });

  test("drops read-configuration's configFilePath and keeps everything else", () => {
    const { config } = deriveGeneratedConfig(
      { service: "app", dockerComposeFile: "compose.yml", remoteUser: "ka-jo", configFilePath: { fsPath: "/x" } },
      inputs,
    );
    expect(config).not.toHaveProperty("configFilePath");
    expect(config.remoteUser).toBe("ka-jo");
  });

  test("rejects configs that aren't compose-based", () => {
    expect(() => deriveGeneratedConfig({ image: "ubuntu" }, inputs)).toThrow(GeneratorError);
  });
});

describe("localFeaturePaths", () => {
  test("lists ./ Features as relative paths and ignores registry ones", () => {
    expect(localFeaturePaths({ features: { "./features/a": {}, "ghcr.io/x/y:1": {}, "./b/../features/c": {} } })).toEqual([
      "features/a",
      "features/c",
    ]);
  });

  test("rejects a local Feature outside the config's directory", () => {
    expect(() => localFeaturePaths({ features: { "../outside": {} } })).toThrow(GeneratorError);
  });
});
