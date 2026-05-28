# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Personal dev environment config with two payloads:

1. **`claude/`** — global Claude Code config (CLAUDE.md, rules, skills, agents, commands, output-styles). `scripts/install.sh` symlinks each top-level entry into `~/.claude/` using **relative** links (`../devenv/claude/...`).
2. **`devcontainer/`** — a dev container template copied into other projects by `devenv devcontainer`. App container + Squid egress firewall sidecar on an `internal: true` Docker network; default-deny allowlist in `firewall/allowed_domains.txt`.

There is no build, test, or lint step. The repo is bash scripts + config files.

## Hard invariants

- **The repo must live at `~/devenv`.** `install.sh` hard-fails otherwise, and the dev container bind-mounts `~/devenv` at a fixed path. The `~/.claude/*` symlinks are relative so they resolve identically on host and inside any dev container that bind-mounts `~/.claude` and `~/devenv` at sibling paths. Do not change to absolute symlinks.
- **Runtime Claude state is deliberately not symlinked** (`sessions/`, `projects/`, `history.jsonl`, `.credentials.json`, `settings.json`, `cache/`). Stays per-machine. Don't add these to `install.sh`.
- **`devenv devcontainer` preserves project-local edits** to `devcontainer.json` and `firewall/allowed_domains.txt` (`PRESERVE` array in `scripts/devenv`). Anything else in `devcontainer/` is overwritten on re-run, so don't put project-specific state in other files.

## Adding a new top-level claude config folder

Add a `link_relative` line to `scripts/install.sh` and re-run it. The script is idempotent. New files inside an already-linked directory appear automatically — no re-run needed.

## CLI

- `devenv update` — `git pull` in `~/devenv`.
- `devenv devcontainer` — copy/refresh `.devcontainer/` in the cwd; creates the `shared-pnpm-store` Docker volume on first run.

## Commit conventions

Conventional Commits with a scope (this repo has documented scopes — see existing log: `devcontainer`, `scripts`, `claude`, `chore`). Issue refs use `Ref #N` footers, never state-changing keywords.
