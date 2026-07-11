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
  Dockerfile                  #   Debian Trixie base: zsh + oh-my-zsh, fnm, pnpm, Claude Code
  firewall/                   #   Squid sidecar image with default-deny egress allowlist
    Dockerfile                #     Ubuntu + squid + inotify-tools (for live allowlist reload)
    squid.conf                #     default-deny config; allowlist via dstdomain ACL
    allowed_domains.txt       #     the egress allowlist (one domain per line; leading "." = subdomains)
    start.sh                  #     launches squid, watches allowed_domains.txt, SIGHUPs on change
    verify.sh                 #     postStart check: allowed domains reachable, others blocked
bin/
  devenv                      # CLI entry point: `devenv update`, `devenv devcontainer`, ...
  claude-wrapper               # process wrapper referenced by the dev container's claudeCode.claudeProcessWrapper
lib/                         # one file per devenv subcommand, sourced by bin/devenv
install.sh                    # symlinks claude/* into ~/.claude and installs the `devenv` CLI
worktrees/                    # gitignored — repos managed by `devenv clone`/`devenv worktree`, see below
```

## Setting up a new machine

> **The repo must be cloned to `~/devenv`.** `install.sh` refuses to run from any other location.

```bash
git clone https://github.com/ka-jo/devenv.git ~/devenv
cd ~/devenv
./install.sh
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

**2.** Symlinks `bin/devenv` into `~/.local/bin/devenv` so the CLI is on `$PATH`.

Runtime state Claude Code writes into `~/.claude/` itself — `sessions/`, `projects/`, `history.jsonl`, `.credentials.json`, `settings.json`, `cache/`, etc. — is deliberately **not** symlinked. That state stays local to each machine.

### Why `~/devenv` is required

The dev container template bind-mounts your host's `~/.claude` and `~/devenv` into the container at fixed sibling paths (`/home/ka-jo/.claude` and `/home/ka-jo/devenv` — the container runs as the non-root user `ka-jo`). The `~/.claude/*` symlinks are **relative** (`../devenv/claude/...`), so they resolve correctly in either context — on the host or inside the container — **as long as `~/devenv` is the actual repo path** (or a symlink Docker can resolve to it).

Hard-requiring `~/devenv` keeps `install.sh` simple (no auto-healing symlink layer) and means edits to Claude files inside the dev container flow live back to the host repo, where you can commit and push them.

## The `devenv` CLI

```
devenv update                                  pull the latest devenv repo
devenv devcontainer [--name <name>]            copy/update .devcontainer in the current project
devenv install-extension [--skip-build]        install the egress approver VS Code extension on Windows
devenv clone <url> [name]                      bare-clone a repo into worktrees/<name>/.git + checkout its default branch
devenv worktree add <repo> <branch> [base]     add a worktree at worktrees/<repo>/<branch>
devenv worktree rm <repo> <branch> [--force]   remove a worktree and delete its local branch
devenv worktree list [repo]                    list worktrees for one repo, or all repos
```

### Working with git worktrees

`devenv clone`/`devenv worktree` manage repos under `worktrees/<repo>/` (gitignored, machine-local). Each repo is a **bare** clone at `worktrees/<repo>/.git`, and every branch — including the default one — is checked out as an ordinary worktree alongside it, e.g.:

```
worktrees/
  my-repo/
    .git/                # bare — never cd into this, no working tree here
    main/                # a normal checkout, like any other branch
    feature/my-branch/   # branch names with slashes nest naturally
    chore/my-branch/
```

No checkout is "the base repo": the bare `.git` holds no files itself, so every branch is a symmetric, independently addable/removable worktree, and none of them can be accidentally edited or committed to in place of another.

```bash
devenv clone git@github.com:me/my-repo.git          # -> worktrees/my-repo/<default-branch>
devenv worktree add my-repo feature/my-branch        # new branch off the default, or checks out an existing one
devenv worktree add my-repo chore/my-branch main      # new branch off an explicit base
devenv worktree list my-repo                          # or: devenv worktree list (all repos)
devenv worktree rm my-repo feature/my-branch           # removes the worktree + deletes the local branch (git branch -d semantics)
devenv worktree rm my-repo feature/my-branch --force   # force-removes a dirty worktree, force-deletes an unmerged branch (-D)
```

### Adding the dev container to a new project

From the root of any project:

```bash
devenv devcontainer            # or: devenv devcontainer --name my-project
```

This copies the contents of `devcontainer/` into `.devcontainer/` in the project. Re-running it pulls in template updates, but preserves project-local edits to `devcontainer.json` and `firewall/allowed_domains.txt` (never overwritten if they already exist). It also creates the shared `shared-pnpm-store` Docker volume on first run. `--name <name>` rewrites the `"name"` field in `devcontainer.json` (otherwise it stays `devcontainer`).

Then open the folder in VS Code and **Reopen in Container**. On creation the container runs `fnm install` (Node version from the project's `.nvmrc`/`.node-version`) and `pnpm install`; on every start it runs `firewall/verify.sh` to confirm the allowlist is enforced (allowed domains reachable, others blocked) — failures print a warning but don't block the container.

The template:

- Runs your dev container on an `internal: true` Docker network — **no direct external access**. The Squid firewall sidecar is the only egress path, reached via `HTTP(S)_PROXY` env vars (and `NODE_USE_ENV_PROXY=1` so Node's http/https honor them). The app container won't start until the firewall passes its health check.
- Builds on **Debian Trixie** with `zsh` + oh-my-zsh, **`fnm`** (Node version manager), `pnpm`, and Claude Code preinstalled. Runs as the non-root user **`ka-jo`** with passwordless sudo.
- Bind-mounts your host's `~/.claude` and `~/devenv` into the container, so Claude config and skills are shared live and edits made in either place are visible in both. Symlinks `devenv` onto `PATH` inside the container too.
- Shares a `pnpm` store across all dev containers via the external `shared-pnpm-store` Docker volume, so package downloads are cached once per host. Shell history persists in a named `ka-jo-zsh-history` volume.

### Controlling egress

Edit `.devcontainer/firewall/allowed_domains.txt` to control which domains the container can reach (one domain per line; a leading `.` matches subdomains, e.g. `.github.com`). Changes are picked up **live** — the firewall watches the file and reconfigures Squid on save, no rebuild needed. The starting allowlist covers Anthropic/Claude, GitHub, the npm registry, the VS Code marketplace, and `nodejs.org`.

> **Edit the allowlist from the host, not from inside the dev container.** The allowlist is a host-controlled trust boundary: it would defeat the firewall if a process inside the sandbox (e.g. an agent running with skipped permissions) could widen its own egress. The whole `firewall/` directory is re-mounted **read-only** into the dev container (over the read-write `/workspace` mount), so attempts to edit it from inside fail with a read-only-filesystem error. The firewall sidecar reads the same host file, so host-side edits still live-reload.
