import { describe, expect, test } from "bun:test";
import { parseGeneratorContext } from "../src/context.ts";
import { GeneratorError } from "../src/errors.ts";

const complete = {
  repoDir: "/home/u/devenv",
  worktreesDir: "/home/u/devenv/worktrees",
  repo: "r",
  branch: "main",
  worktreePath: "/home/u/devenv/worktrees/r/main",
  projectName: "r-main",
  home: "/home/u",
  stateDir: "/home/u/.local/state/devenv/r-main",
  claudeDataDir: "/home/u/.local/share/devenv/r-main/claude",
  containerHome: "/home/c",
  proxyNetwork: "devenv-shared_proxy_net",
  defaultConfig: "/home/u/devenv/devcontainer/default/devcontainer.json",
  featuresDir: "/home/u/devenv/devcontainer/features",
  devcontainerCli: "/home/u/devenv/node_modules/.bin/devcontainer",
  trustDir: "/home/u/.local/state/devenv/trust",
  isCreating: true,
};

describe("parseGeneratorContext", () => {
  test("returns every field of a complete context, with the container paths under the container home", () => {
    expect(parseGeneratorContext(JSON.stringify(complete))).toEqual({
      ...complete,
      containerRepoDir: "/home/c/devenv",
      containerClaudeDir: "/home/c/.claude",
    });
  });

  test("puts the container paths at the root for a home of /, the layout of containers created before", () => {
    const context = parseGeneratorContext(JSON.stringify({ ...complete, containerHome: "/" }));
    expect(context.containerRepoDir).toBe("/devenv");
    expect(context.containerClaudeDir).toBe("/.claude");
  });

  test("rejects a container home that isn't a normalized absolute path", () => {
    for (const containerHome of ["home/c", "/home/c/", "/home//c", "/home/c/..", "/home/./c", "/home/c\nx"]) {
      expect(() => parseGeneratorContext(JSON.stringify({ ...complete, containerHome }))).toThrow('malformed "containerHome"');
    }
  });

  test("rejects text that isn't JSON", () => {
    expect(() => parseGeneratorContext("not json")).toThrow(GeneratorError);
  });

  test("rejects JSON that isn't an object", () => {
    expect(() => parseGeneratorContext("[]")).toThrow(GeneratorError);
  });

  test("names a missing or empty field", () => {
    const { repo: _, ...missingRepo } = complete;
    expect(() => parseGeneratorContext(JSON.stringify(missingRepo))).toThrow('missing "repo"');
    expect(() => parseGeneratorContext(JSON.stringify({ ...complete, home: "" }))).toThrow('missing "home"');
  });

  test("keeps a requested config, and treats an empty one as none", () => {
    expect(parseGeneratorContext(JSON.stringify({ ...complete, configPath: "/c" })).configPath).toBe("/c");
    expect(parseGeneratorContext(JSON.stringify({ ...complete, configPath: "" }))).not.toHaveProperty("configPath");
  });

  test("requires flags to be booleans", () => {
    expect(() => parseGeneratorContext(JSON.stringify({ ...complete, isCreating: "true" }))).toThrow('missing "isCreating"');
  });
});
