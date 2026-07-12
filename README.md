# devenv

My personal development environment configuration. Two purposes:

1. **Share Claude Code config across machines** by symlinking `claude/` into `~/.claude/`.
2. **Provide a shared dev container setup** (sandboxed via a Squid egress firewall) for every worktree-managed project.

## Layout

```
claude/                       # global Claude Code config — symlinked into ~/.claude
  CLAUDE.md                   #   global instructions
  rules/                      #   custom rules
  skills/                     #   user skills
  agents/                     #   custom subagents
  commands/                   #   custom slash commands
  output-styles/              #   custom output styles
devcontainer/                 # dev container base — referenced directly by `devenv container`, never copied
  docker-compose.yml          #   the app service only, joins the shared proxy_net (below) as its sole network
  Dockerfile                  #   Debian Trixie base: zsh + oh-my-zsh, fnm, pnpm, Claude Code
  infra/                      #   Squid firewall + egress approver — ONE shared instance for all worktrees
    docker-compose.yml        #     approver + firewall services (see lib/container.sh _shared_*)
    approver/                 #     Bun/TypeScript egress approval broker (see approver/PROTOCOL.md)
    firewall/                 #     Squid sidecar image with default-deny egress allowlist
      Dockerfile               #       Ubuntu + squid + inotify-tools (for live allowlist reload)
      squid.conf                #      default-deny config; allowlist via dstdomain ACL
      allowed_domains.txt.default  #   seed template (live allowlist: allowed_domains.txt, gitignored)
      start.sh                  #      launches squid, watches allowed_domains.txt, SIGHUPs on change
      verify.sh                 #      check: allowed domains reachable, others blocked
vsc-extension/                 # VS Code extension: host-side UI for approving/denying egress requests
bin/
  devenv                      # CLI entry point: `devenv update`, `devenv container`, ...
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
devenv clone <url> [name]                      bare-clone a repo into worktrees/<name>/.git + checkout its default branch
devenv worktree add <repo> <branch> [base]     add a worktree at worktrees/<repo>/<branch>
devenv worktree rm <repo> <branch> [--force]   remove a worktree and delete its local branch
devenv worktree list [repo]                    list worktrees for one repo, or all repos
devenv container up <repo> <branch>            build/start a worktree's dev container (and the shared firewall stack, if needed)
devenv container down <repo> <branch>          stop a worktree's dev container (and the shared firewall stack, if it was the last one)
devenv container attach <repo> <branch>        exec a zsh shell in a running dev container
devenv container list                          list running devenv-managed containers, including the shared stack
devenv install-extension [--skip-build]        install the egress approver VS Code extension on Windows
devenv devcontainer [--name <name>]            (legacy, currently unmaintained — see below)
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

### Running a worktree's dev container

This is the primary path, for any repo managed via `devenv clone`/`devenv worktree`:

```bash
devenv container up my-repo feature/my-branch      # build + start
devenv container attach my-repo feature/my-branch  # exec a zsh shell
devenv container down my-repo feature/my-branch    # stop
devenv container list                              # see what's running, across all worktrees
```

`up` references `devcontainer/docker-compose.yml` directly (nothing is copied into the worktree) and regenerates `<worktree>/.devenv` (`WORKSPACE_DIR`, `COMPOSE_PROJECT_NAME`) each run — a flat dotfile at the worktree root, deliberately not named `.devcontainer/` since that name is reserved for actual devcontainer.json-style tooling. There's no `devcontainer.json` and VS Code doesn't own the container lifecycle here — start/stop it with the CLI, and if you want VS Code attached, use **Attach to Running Container** against `${COMPOSE_PROJECT_NAME}-devcontainer` (i.e. `<repo>-<branch>-devcontainer`) once it's up.

Each worktree's container:

- Joins a **shared** `internal: true` Docker network (`devenv-shared_proxy_net`) — **no direct external access**. The only egress path is the shared Squid firewall, reached via `HTTP(S)_PROXY` env vars (and `NODE_USE_ENV_PROXY=1` so Node's http/https honor them).
- Builds on **Debian Trixie** with `zsh` + oh-my-zsh, **`fnm`** (Node version manager), `pnpm`, and Claude Code preinstalled. Runs as the non-root user **`ka-jo`** with passwordless sudo.
- Bind-mounts your host's `~/.claude` and `~/devenv` into the container, so Claude config and skills are shared live and edits made in either place are visible in both. Symlinks `devenv` onto `PATH` inside the container too.
- Shares a `pnpm` store across all dev containers via the external `shared-pnpm-store` Docker volume, so package downloads are cached once per host. Shell history persists in a named `ka-jo-zsh-history` volume.

Isolation between concurrently-running worktrees comes entirely from the Docker Compose **project name** (`<repo>-<branch>`) — each worktree gets its own container and its own project namespace, but they all share one firewall.

### The shared firewall + approver stack

Squid and the egress-approval broker (`devcontainer/infra/approver/`) run as **one instance total**, shared by every running worktree — not one pair per worktree. `devenv container up` starts this shared stack automatically if it isn't already running (building images and seeding the allowlist on first-ever use) and waits for it to be healthy before starting your worktree's container. `devenv container down` tears the shared stack down again once your worktree was the last one attached to it — that check is derived live from Docker network state, not a manually-tracked counter, so it can't drift out of sync if a container crashes.

The approver is published only to host loopback (`127.0.0.1`, ephemeral port — discover it with `docker port devenv-shared-approver 3129/tcp`) and sits on a network the sandboxed app containers can't reach at all, so it — not a token alone — is the real trust boundary between "an app container asked for network access" and "a human granted it." The **egress approver VS Code extension** (`devenv install-extension`) is the host-side UI for that approval flow; see `vsc-extension/README.md` and `devcontainer/infra/approver/PROTOCOL.md` for the wire protocol.

### Controlling egress

The allowlist is **global**, shared by every worktree (not per-worktree) — this is a deliberately constrained first cut; per-worktree allowlists are a possible future enhancement. Edit it at:

```
devcontainer/infra/firewall/allowed_domains.txt
devcontainer/infra/firewall/denied_domains.txt
```

One domain per line; a leading `.` matches subdomains, e.g. `.github.com`. Changes are picked up **live** — the firewall watches the files and reconfigures Squid on save, no rebuild needed. These files are gitignored and seeded once, ever, from the tracked `*.default` templates in the same directory (skip-if-exists) — edit the seeded copy, not the `.default` templates, to change what any worktree can reach.

> **Known gap (TODO):** these files live inside `~/devenv`, which every dev container bind-mounts **read-write** at `/home/ka-jo/devenv` (for the `~/.claude` symlink trick). That means a sandboxed process inside the container can currently reach its own allowlist through that mount — this isn't a real trust boundary yet. A fix (e.g. a read-only remount, or moving the live files back outside the repo) is intentionally deferred rather than solved here.

### `devenv devcontainer` (legacy, currently unmaintained)

For a project **not** managed as a `devenv worktree` checkout, `devenv devcontainer` copies `devcontainer/` into a project-local `.devcontainer/` instead of using `devenv container up`. It predates the switch to the CLI-managed container lifecycle and the shared firewall stack, and has not been kept in sync with either — it still expects a `devcontainer.json` that no longer exists in `devcontainer/`, and the `docker-compose.yml` it copies is now the app-only service (no bundled firewall/approver). Treat it as broken until someone specifically revives it; per `CLAUDE.md`, new work should extend `devcontainer/docker-compose.yml` + `lib/container.sh` instead of this path.
