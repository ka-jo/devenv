import { existsSync, readFileSync } from "node:fs";
import type { DevcontainerConfig } from "./config.ts";

/**
 * What devenv remembers about a worktree's container, kept in its generated `devcontainer.json` under
 * `customizations.devenv` — the spec's namespace for tool-specific settings, which the devcontainer CLI passes through.
 */
export interface DevenvRecord {
  /** The config the worktree last used, which later runs default to. */
  readonly sourceConfig?: string;
  /** The inputs hash the existing container was created from, for drift detection; set by `lib/container.sh` once a container is created. */
  readonly createdHash?: string;
}

/**
 * Reads the record from a generated `devcontainer.json`.
 *
 * @param generatedConfigPath - The generated file.
 * @returns The record; empty when there's no file or no record in it.
 */
export function readDevenvRecord(generatedConfigPath: string): DevenvRecord {
  if (!existsSync(generatedConfigPath)) {
    return {};
  }
  const config: unknown = JSON.parse(readFileSync(generatedConfigPath, "utf8"));
  const record = fieldOf(fieldOf(config, "customizations"), "devenv");
  const sourceConfig = fieldOf(record, "sourceConfig");
  const createdHash = fieldOf(record, "createdHash");
  return {
    ...(typeof sourceConfig === "string" ? { sourceConfig } : {}),
    ...(typeof createdHash === "string" ? { createdHash } : {}),
  };
}

/**
 * Adds a record to a config, replacing any `customizations.devenv` the config set itself.
 *
 * @param config - The config.
 * @param record - The record.
 * @returns A new config; `config` is not modified.
 */
export function withDevenvRecord<T extends DevcontainerConfig>(config: T, record: DevenvRecord): T {
  const customizations = typeof config.customizations === "object" && config.customizations !== null ? config.customizations : {};
  return { ...config, customizations: { ...customizations, devenv: record } };
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value ? Reflect.get(value, key) : undefined;
}
