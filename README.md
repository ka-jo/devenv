# devenv

My personal development environment configuration. Two purposes:

1. **Share Claude Code config across machines** by symlinking `claude/` into `~/.claude/`.
2. **Provide a shared dev container setup** (sandboxed via a Squid egress firewall) that any project can drop in.

## Layout

```
claude/                       # global Claude Code config — symlinked into ~/.claude
  CLAUDE.md                   #   global instructions
  rules/                      #   custom rules
  skills/                     #   user skills
  agents/                     #   custom subagents
  commands/                   #   custom slash commands
  output-styles/              #   custom output styles
devcontainer/                 # dev container template — copied into projects by `devenv devcontainer`
  devcontainer.json           #   VS Code dev container entrypoint
  docker-compose.yml          #   app container + Squid firewall sidecar on an internal network
  Dockerfile                  #   Node 24 base + pnpm + Claude Code (via Anthropic's installer)
  firewall/                   #   Squid sidecar image with default-deny egress allowlist
scripts/
  install.sh                  # symlinks claude/* into ~/.claude and installs the `devenv` CLI
  devenv                      # CLI: `devenv update`, `devenv devcontainer`
```

## Setting up a new machine

> **The repo must be cloned to `~/devenv`.** `scripts/install.sh` refuses to run from any other location.

```bash
git clone https://github.com/ka-jo/devenv.git ~/devenv
cd ~/devenv
./scripts/install.sh
```

This does two things:

**1.** Creates a **relative** symlink in `~/.claude/` for every entry in `claude/`:

```
~/.claude/CLAUDE.md      → ../devenv/claude/CLAUDE.md
~/.claude/rules          → ../devenv/claude/rules
~/.claude/skills         → ../devenv/claude/skills
~/.claude/agents         → ../devenv/claude/agents
~/.claude/commands       → ../devenv/claude/commands
~/.claude/output-styles  → ../devenv/claude/output-styles
```

Each entry is an explicit `link_relative` call in `install.sh`. To add a new top-level config folder, add a line to that script and re-run it. Edits to files inside any of the already-linked folders are picked up live with no re-run needed (the symlink is a directory; new files appear automatically). The script is idempotent.

**2.** Symlinks `scripts/devenv` into `~/.local/bin/devenv` so the CLI is on `$PATH`.

Runtime state Claude Code writes into `~/.claude/` itself — `sessions/`, `projects/`, `history.jsonl`, `.credentials.json`, `settings.json`, `cache/`, etc. — is deliberately **not** symlinked. That state stays local to each machine.

### Why `~/devenv` is required

The dev container template bind-mounts your host's `~/.claude` and `~/devenv` into the container at fixed sibling paths (`/home/node/.claude` and `/home/node/devenv`). The `~/.claude/*` symlinks are **relative** (`../devenv/claude/...`), so they resolve correctly in either context — on the host or inside the container — **as long as `~/devenv` is the actual repo path** (or a symlink Docker can resolve to it).

Hard-requiring `~/devenv` keeps `install.sh` simple (no auto-healing symlink layer) and means edits to Claude files inside the dev container flow live back to the host repo, where you can commit and push them.

## The `devenv` CLI

```
devenv update          pull the latest devenv repo
devenv devcontainer    copy/update .devcontainer in the current project
```

### Adding the dev container to a new project

From the root of any project:

```bash
devenv devcontainer
```

This copies the contents of `devcontainer/` into `.devcontainer/` in the project. Re-running it pulls in template updates, but preserves project-local edits to `devcontainer.json` and `firewall/allowed_domains.txt` (never overwritten if they already exist). It also creates the shared `shared-pnpm-store` Docker volume on first run.

The template:

- Runs your dev container on an `internal: true` Docker network — no direct external access.
- Spins up a Squid firewall sidecar as the only egress path, configured via `HTTP(S)_PROXY` env vars. Edit `.devcontainer/firewall/allowed_domains.txt` to control which domains the container can reach.
- Builds on `mcr.microsoft.com/devcontainers/javascript-node:24` with `pnpm` (via corepack) and Claude Code (installed via Anthropic's official installer) preinstalled.
- Bind-mounts your host's `~/.claude` and `~/devenv` into the container, so Claude config and skills are shared live and edits made in either place are visible in both.
- Shares a `pnpm` store across all dev containers via the external `shared-pnpm-store` Docker volume, so package downloads are cached once per host.
