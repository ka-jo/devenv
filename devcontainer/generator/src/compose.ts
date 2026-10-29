import path from "node:path";
import { GeneratorError } from "./errors.ts";

// Narrow types for the parts of `docker compose config --format json --no-env-resolution` output that devenv reads.
// That output is normalized: long-syntax volumes/ports, absolute paths, only definitions some service uses, and the
// implicit `default` network spelled out. Fields not modeled here are ignored, not rejected.
// Schema reference: https://github.com/compose-spec/compose-go/blob/main/schema/compose-spec.json

/** A normalized compose project. */
export interface ComposeModel {
  /** Services by name. */
  readonly services: Readonly<Record<string, ComposeService>>;
  /** Top-level networks some service uses, by key. */
  readonly networks?: Readonly<Record<string, ComposeNetwork>> | null;
  /** Top-level named volumes some service uses, by key. */
  readonly volumes?: Readonly<Record<string, ComposeVolume>> | null;
  /** Top-level secrets some service uses, by key. */
  readonly secrets?: Readonly<Record<string, ComposeFileReference>> | null;
  /** Top-level configs some service uses, by key. */
  readonly configs?: Readonly<Record<string, ComposeFileReference>> | null;
}

/** A normalized service. */
export interface ComposeService {
  readonly build?: { readonly context?: string; readonly dockerfile?: string; readonly network?: string } | null;
  readonly volumes?: readonly ComposeServiceVolume[] | null;
  readonly env_file?: readonly { readonly path: string; readonly required?: boolean }[] | null;
  /** Networks by key; values carry per-network options this generator doesn't read. */
  readonly networks?: Readonly<Record<string, unknown>> | null;
  readonly network_mode?: string | null;
  readonly ports?: readonly unknown[] | null;
  readonly container_name?: string | null;
  readonly privileged?: boolean | null;
  readonly cap_add?: readonly string[] | null;
  readonly security_opt?: readonly string[] | null;
  readonly devices?: readonly unknown[] | null;
  readonly pid?: string | null;
  readonly ipc?: string | null;
  readonly uts?: string | null;
  readonly userns_mode?: string | null;
  readonly cgroup?: string | null;
}

/** A normalized service mount. */
export interface ComposeServiceVolume {
  readonly type: string;
  /** Absolute host path for binds; volume key for volumes; absent for tmpfs. */
  readonly source?: string;
  readonly target: string;
  readonly read_only?: boolean;
}

/** A normalized top-level network. */
export interface ComposeNetwork {
  readonly external?: boolean;
  readonly internal?: boolean;
  readonly ipam?: { readonly config?: readonly unknown[] } | null;
}

/** A normalized top-level named volume. */
export interface ComposeVolume {
  readonly external?: boolean;
  readonly driver_opts?: Readonly<Record<string, string>> | null;
}

/** A normalized top-level secret or config. */
export interface ComposeFileReference {
  /** Absolute host path, when sourced from a file. */
  readonly file?: string;
}

/**
 * Loads the normalized model of a set of compose files, as the devcontainer CLI's own compose invocation will merge
 * them (the first file's directory is the project directory).
 *
 * @param composeFiles - Absolute paths, in merge order.
 * @returns The normalized model.
 * @throws {@link GeneratorError} when compose rejects the files.
 *
 * @remarks
 * Runs compose with a minimal environment: compose interpolates `${VAR}` in the files from its own environment, and a
 * project's compose file must not be able to read the host user's. `env_file`s are left unresolved so their paths can
 * be validated rather than read.
 */
export async function loadComposeModel(composeFiles: readonly string[]): Promise<ComposeModel> {
  const proc = Bun.spawn(
    ["docker", "compose", ...composeFiles.flatMap((file) => ["-f", file]), "config", "--format", "json", "--no-env-resolution"],
    { env: minimalDockerEnv(), cwd: path.dirname(composeFiles[0] ?? "."), stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new GeneratorError(`docker compose rejected ${composeFiles.join(", ")}:\n${errors.trim()}`);
  }
  // compose emits this exact normalized shape; the interfaces above only narrow which fields are read.
  return JSON.parse(output) as ComposeModel;
}

/** The environment compose needs to reach the Docker daemon, and nothing else from the host user's. */
function minimalDockerEnv(): Record<string, string> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  for (const key of ["HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"]) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}
