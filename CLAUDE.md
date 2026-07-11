# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Personal dev environment config with two payloads:

1. **`claude/`** — global Claude Code config (CLAUDE.md, rules, skills, agents, commands, output-styles). `install.sh` symlinks each top-level entry into `~/.claude/` using **relative** links (`../devenv/claude/...`).
2. **`devcontainer/`** — a dev container template copied into other projects by `devenv devcontainer`. Debian-Trixie app container (runs as non-root user `ka-jo`; zsh + fnm + pnpm + Claude Code) plus a Squid egress firewall sidecar on an `internal: true` Docker network; default-deny allowlist in `firewall/allowed_domains.txt`. The app container is gated on the firewall's health check (`depends_on: service_healthy`); `firewall/start.sh` watches the allowlist and SIGHUPs Squid to reload it live; `firewall/verify.sh` runs on `postStartCommand` to confirm enforcement (non-fatal). The `firewall/` dir is re-mounted **read-only** into the app container (overlaying the rw `/workspace` mount) so a sandboxed process can't widen its own egress — the allowlist is edited from the host only; don't remove that `:ro` overlay.

There is no build, test, or lint step. The repo is bash scripts + config files.

## Hard invariants

- **The repo must live at `~/devenv`.** `install.sh` hard-fails otherwise, and the dev container bind-mounts `~/devenv` at a fixed path. The `~/.claude/*` symlinks are relative so they resolve identically on host and inside any dev container that bind-mounts `~/.claude` and `~/devenv` at sibling paths. Do not change to absolute symlinks.
- **Runtime Claude state is deliberately not symlinked** (`sessions/`, `projects/`, `history.jsonl`, `.credentials.json`, `settings.json`, `cache/`). Stays per-machine. Don't add these to `install.sh`.
- **`devenv devcontainer` preserves project-local edits** to `devcontainer.json` and `firewall/allowed_domains.txt` (`PRESERVE` array in `lib/devcontainer.sh`). Anything else in `devcontainer/` is overwritten on re-run, so don't put project-specific state in other files.
- **`bin/` holds only entry points with an external contract** (`devenv`, `claude-wrapper`) — referenced by hardcoded absolute paths from `devcontainer.json`/`Dockerfile`. Only `devenv` gets symlinked onto `$PATH` (never the whole `bin/` dir). Per-subcommand implementation lives in `lib/*.sh`, one file per `devenv` subcommand, sourced by `bin/devenv`.
- **`install.sh` lives at the repo root, not in `bin/`** — it's the one-time bootstrap step run before `bin/devenv` is even on `$PATH`, and keeping it out of `bin/` sidesteps ever having a script named `install` on `$PATH` (it would shadow the coreutils `install` command used by build tooling).
- **`worktrees/<repo>/.git` is always bare, and no branch checkout is "the base repo".** `devenv clone`/`devenv worktree` treat every branch — including the default one — as an ordinary worktree under `worktrees/<repo>/<branch-path>`, symmetric with and independently removable from the rest. Don't reintroduce a non-bare "primary" checkout; it breaks that symmetry and risks accidental commits landing in the wrong place. `worktrees/` is gitignored (machine-local).

## Adding a new top-level claude config folder

Add a `link_relative` line to `install.sh` and re-run it. The script is idempotent. New files inside an already-linked directory appear automatically — no re-run needed.

## CLI

- `devenv update` — `git pull` in `~/devenv`.
- `devenv devcontainer [--name <name>]` — copy/refresh `.devcontainer/` in the cwd; creates the `shared-pnpm-store` Docker volume on first run. `--name` rewrites the `"name"` field in `devcontainer.json`.
- `devenv install-extension [--skip-build]` — build and install the egress approver VS Code extension on Windows.
- `devenv clone <url> [name]` — bare-clone into `worktrees/<name>/.git`, checkout the default branch as a worktree.
- `devenv worktree add <repo> <branch> [base]` / `rm <repo> <branch> [--force]` / `list [repo]` — manage worktrees under `worktrees/<repo>/`. `rm` also deletes the local branch (`-d`, or `-D` with `--force`).

## Commit conventions

Conventional Commits with a scope (this repo has documented scopes — see existing log: `devcontainer`, `scripts`, `claude`, `chore`). Issue refs use `Ref #N` footers, never state-changing keywords.
