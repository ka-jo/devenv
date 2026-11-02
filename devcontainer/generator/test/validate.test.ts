import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ComposeModel, ComposeService } from "../src/compose.ts";
import type { DevcontainerConfig } from "../src/config.ts";
import {
  isSandboxEscape,
  type ValidationInput,
  validateConfigFolder,
  validateMergedConfig,
  validateProjectConfig,
  type ViolationRule,
} from "../src/validate.ts";
import { createHostFixture, type HostFixture } from "./fixtures.ts";

let fixture: HostFixture;
let worktree: string;

beforeAll(() => {
  fixture = createHostFixture();
  worktree = fixture.context.worktreePath;
  mkdirSync(path.join(worktree, "data"), { recursive: true });
  symlinkSync("/etc", path.join(worktree, "sneaky-link"));
});

afterAll(() => fixture.cleanup());

function input(overrides: Partial<ValidationInput> & { services?: Record<string, ComposeService> }): ValidationInput {
  const model: ComposeModel = overrides.model ?? { services: overrides.services ?? { app: {} } };
  return {
    model,
    primaryService: "app",
    devcontainerConfig: {},
    composeFiles: [path.join(worktree, ".devcontainer", "compose.yml")],
    rawComposeFiles: [],
    allowedRoots: [worktree],
    ...overrides,
  };
}

function rulesOf(validationInput: ValidationInput): ViolationRule[] {
  return validateProjectConfig(validationInput).map((violation) => violation.rule);
}

describe("validateProjectConfig: services (primary and sidecars alike)", () => {
  test("accepts an ordinary project", () => {
    const services: Record<string, ComposeService> = {
      app: {
        volumes: [
          { type: "bind", source: worktree, target: "/workspaces/x" },
          { type: "bind", source: path.join(worktree, "data"), target: "/data" },
          { type: "volume", source: "cache", target: "/cache" },
        ],
        env_file: [{ path: path.join(worktree, ".env") }],
        build: { context: worktree, dockerfile: ".devcontainer/Dockerfile" },
        cap_add: ["SYS_NICE"],
      },
      db: { network_mode: "service:app" },
    };
    expect(rulesOf(input({ services }))).toEqual([]);
  });

  test.each<[string, ComposeService, ViolationRule]>([
    ["privileged", { privileged: true }, "privileged"],
    ["pid: host", { pid: "host" }, "host-namespaces"],
    ["ipc: host", { ipc: "host" }, "host-namespaces"],
    ["userns_mode: host", { userns_mode: "host" }, "host-namespaces"],
    ["cap_add SYS_ADMIN", { cap_add: ["SYS_ADMIN"] }, "capabilities"],
    ["cap_add CAP_NET_ADMIN (prefixed, lowercase)", { cap_add: ["cap_net_admin"] }, "capabilities"],
    ["seccomp unconfined", { security_opt: ["seccomp=unconfined"] }, "security-opt"],
    ["apparmor unconfined", { security_opt: ["apparmor:unconfined"] }, "security-opt"],
    ["devices", { devices: [{ source: "/dev/kvm" }] }, "devices"],
    ["bind outside the worktree", { volumes: [{ type: "bind", source: "/etc", target: "/etc-host" }] }, "host-paths"],
    ["bind through a symlink out of the worktree", { volumes: [{ type: "bind", source: "SNEAKY", target: "/x" }] }, "host-paths"],
    ["docker socket", { volumes: [{ type: "bind", source: "/var/run/docker.sock", target: "/var/run/docker.sock" }] }, "docker-socket"],
    ["env_file outside the worktree", { env_file: [{ path: "/home/u/.secrets" }] }, "host-paths"],
    ["build context outside the worktree", { build: { context: "/home/u" } }, "host-paths"],
    ["build network host", { build: { context: "WORKTREE", network: "host" } }, "build-network"],
  ])("flags a sidecar with %s", (_, service, rule) => {
    const resolved = JSON.parse(
      JSON.stringify(service).replaceAll("SNEAKY", path.join(worktree, "sneaky-link")).replaceAll("WORKTREE", worktree),
    );
    expect(rulesOf(input({ services: { app: {}, sidecar: resolved } }))).toContain(rule);
  });

  test("rejects any network_mode on the primary, and host/container modes on sidecars", () => {
    expect(rulesOf(input({ services: { app: { network_mode: "service:db" }, db: {} } }))).toEqual(["network-mode"]);
    expect(rulesOf(input({ services: { app: {}, db: { network_mode: "host" } } }))).toEqual(["network-mode"]);
    expect(rulesOf(input({ services: { app: {}, db: { network_mode: "container:abc" } } }))).toEqual(["network-mode"]);
  });

  test("flags a Dockerfile outside the worktree even with the context inside it", () => {
    expect(rulesOf(input({ services: { app: { build: { context: worktree, dockerfile: "../../../../Dockerfile" } } } }))).toEqual([
      "host-paths",
    ]);
  });
});

describe("validateProjectConfig: top level", () => {
  test("flags external networks, host-binding volume driver_opts, and secret/config files outside the worktree", () => {
    const model: ComposeModel = {
      services: { app: {} },
      networks: { shared: { external: true } },
      volumes: { data: { driver_opts: { type: "none", o: "bind", device: "/home/u" } } },
      secrets: { token: { file: "/home/u/.token" } },
      configs: { local: { file: path.join(worktree, "config.json") } },
    };
    expect(rulesOf(input({ model }))).toEqual(["external-networks", "volume-driver-opts", "host-paths"]);
  });

  test("flags compose files outside every allowed root, and accepts them inside any", () => {
    expect(rulesOf(input({ composeFiles: ["/home/u/elsewhere/compose.yml"] }))).toEqual(["host-paths"]);
    expect(
      rulesOf(input({ composeFiles: ["/home/u/elsewhere/compose.yml"], allowedRoots: [worktree, "/home/u/elsewhere"] })),
    ).toEqual([]);
  });

  test("flags include: and extends: file, whose files would escape approval", () => {
    const rawComposeFiles = [
      { path: "a.yml", text: "include: [other.yml]\nservices: {}\n" },
      { path: "b.yml", text: "services:\n  app:\n    extends: { file: base.yml, service: app }\n  ok:\n    extends: app\n" },
    ];
    expect(rulesOf(input({ rawComposeFiles }))).toEqual(["compose-includes", "compose-includes"]);
  });
});

describe("validateProjectConfig: the dev container config as written", () => {
  test.each<[string, DevcontainerConfig, ViolationRule]>([
    ["privileged", { privileged: true }, "privileged"],
    ["capAdd", { capAdd: ["SYS_PTRACE"] }, "capabilities"],
    ["securityOpt", { securityOpt: ["seccomp=unconfined"] }, "security-opt"],
    ["a string mount outside the worktree", { mounts: ["type=bind,source=/etc,target=/etc-host"] }, "host-paths"],
    ["an object mount outside the worktree", { mounts: [{ type: "bind", source: "/etc", target: "/x" }] }, "host-paths"],
  ])("flags %s", (_, devcontainerConfig, rule) => {
    expect(rulesOf(input({ devcontainerConfig }))).toEqual([rule]);
  });

  test("accepts volume mounts and binds inside the worktree", () => {
    const devcontainerConfig = { mounts: ["type=volume,source=x,target=/x", { type: "bind", source: worktree, target: "/w" }] };
    expect(rulesOf(input({ devcontainerConfig }))).toEqual([]);
  });
});

describe("validateMergedConfig", () => {
  test("flags what Features or the base image add, e.g. docker-in-docker's privileged", () => {
    const violations = validateMergedConfig({ privileged: true, mounts: ["type=volume,source=dind,target=/var/lib/docker"] }, [worktree]);
    expect(violations.map((violation) => violation.rule)).toEqual(["privileged"]);
    expect(violations[0]?.location).toBe("Features / base image metadata");
  });
});

describe("isSandboxEscape", () => {
  test("only host exposure is approvable", () => {
    expect(isSandboxEscape("host-paths")).toBe(false);
    expect(isSandboxEscape("volume-driver-opts")).toBe(false);
    expect(isSandboxEscape("config-folder")).toBe(false);
    for (const rule of ["privileged", "docker-socket", "network-mode", "external-networks", "compose-includes"] as const) {
      expect(isSandboxEscape(rule)).toBe(true);
    }
  });
});

describe("validateConfigFolder", () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), "devenv-home-"));
    mkdirSync(path.join(home, "configs", "plain"), { recursive: true });
    mkdirSync(path.join(home, "configs", "keys", ".ssh"), { recursive: true });
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  test("accepts an ordinary folder", () => {
    expect(validateConfigFolder(path.join(home, "configs", "plain"), home)).toEqual([]);
  });

  test("flags the home directory and its ancestors", () => {
    expect(validateConfigFolder(home, home).map((violation) => violation.rule)).toEqual(["config-folder"]);
    expect(validateConfigFolder(path.dirname(home), home).map((violation) => violation.rule)).toEqual(["config-folder"]);
  });

  test("flags a folder holding credentials", () => {
    expect(validateConfigFolder(path.join(home, "configs", "keys"), home).map((violation) => violation.detail)).toEqual([
      "the config's folder holds .ssh",
    ]);
  });
});
