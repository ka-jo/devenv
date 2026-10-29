import { describe, expect, test } from "bun:test";
import { deriveGeneratedConfig } from "../src/config.ts";
import { GeneratorError } from "../src/errors.ts";

const inputs = {
  sourceDir: "/home/u/devenv/devcontainer",
  overridePath: "/home/u/.local/state/devenv/r-main/override.yaml",
  workspaceFolder: "/devenv/worktrees/r/main",
};

describe("deriveGeneratedConfig", () => {
  test("makes compose paths absolute and appends the override last", () => {
    const generated = deriveGeneratedConfig(
      { service: "app", dockerComposeFile: ["docker-compose.yml", "../other.yml"] },
      inputs,
    );
    expect(generated.dockerComposeFile).toEqual([
      "/home/u/devenv/devcontainer/docker-compose.yml",
      "/home/u/devenv/other.yml",
      inputs.overridePath,
    ]);
  });

  test("accepts a single compose path", () => {
    const generated = deriveGeneratedConfig({ service: "app", dockerComposeFile: "compose.yml" }, inputs);
    expect(generated.dockerComposeFile).toEqual(["/home/u/devenv/devcontainer/compose.yml", inputs.overridePath]);
  });

  test("sets the mirrored workspace folder and injects the agent Feature alongside existing ones", () => {
    const generated = deriveGeneratedConfig(
      { service: "app", dockerComposeFile: "compose.yml", features: { "./features/fnm": {} } },
      inputs,
    );
    expect(generated.workspaceFolder).toBe(inputs.workspaceFolder);
    expect(generated.features).toEqual({ "./features/fnm": {}, "./features/agent": {} });
  });

  test("drops read-configuration's configFilePath and keeps everything else", () => {
    const generated = deriveGeneratedConfig(
      { service: "app", dockerComposeFile: "compose.yml", remoteUser: "ka-jo", configFilePath: { fsPath: "/x" } },
      inputs,
    );
    expect(generated).not.toHaveProperty("configFilePath");
    expect(generated.remoteUser).toBe("ka-jo");
  });

  test("rejects configs that aren't compose-based", () => {
    expect(() => deriveGeneratedConfig({ image: "ubuntu" }, inputs)).toThrow(GeneratorError);
  });
});
