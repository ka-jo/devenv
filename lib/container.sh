SHARED_PN="devenv-shared"
SHARED_PROXY_NET="devenv-shared_proxy_net"
# Lives inside ~/devenv, which app containers mount read-only — only the
# approver (never an app container) writes it.
SHARED_FIREWALL_DIR="$REPO_DIR/devcontainer/infra/firewall"
# Where ~/devenv and ~/.claude are mounted inside every app container: fixed
# paths, the same whatever user an image runs as. They're siblings (as on the
# host) so the relative ~/.claude -> ../devenv/claude/... links resolve, and
# Claude finds its config via CLAUDE_CONFIG_DIR rather than the user's home.
# Worktrees are mounted at their mirrored path under the repo (not /workspace)
# so the relative gitdir links written by `git worktree add --relative-paths`
# resolve the same as on the host.
CONTAINER_REPO_DIR="/devenv"
CONTAINER_CLAUDE_DIR="/.claude"
# Also hardcoded in devcontainer/features/agent/install.sh and the dashboard
# (CONTAINER_REPO_DIR in dashboard/src/state/sources/agents.ts).
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/devenv"
# Per-worktree data that outlives containers: <project>/claude is mounted
# read-write at CONTAINER_CLAUDE_DIR, so it's agent-writable — devenv only ever
# seeds it (_container_seed_claude_data) and deletes it (_container_remove_data),
# never reads or runs anything from it. Kept apart from STATE_DIR, which no
# container may ever see.
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/devenv"
DEVCONTAINER_CLI="$REPO_DIR/node_modules/.bin/devcontainer"
# The config used for any worktree whose project doesn't define its own.
DEFAULT_CONFIG="$REPO_DIR/devcontainer/devcontainer.json"
# devenv's local Features. `agent` is injected into every generated config;
# the rest are available to configs that reference them as ./features/<id>.
DEVENV_FEATURES_DIR="$REPO_DIR/devcontainer/features"

_container_ensure_volume() {
    local name="$1"
    if ! docker volume inspect "$name" &>/dev/null; then
        docker volume create "$name" >/dev/null
        echo "created docker volume: $name"
    fi
}

_compose_project_name() {
    printf '%s-%s' "$1" "$(printf '%s' "$2" | tr '[:upper:]/' '[:lower:]-' | tr -cs 'a-z0-9-' '-')"
}

# Sets globals: CT_REPO, CT_BRANCH, CT_PATH (worktree checkout path), CT_PN (compose
# project name), CT_WORKDIR (CT_PATH's mirrored path inside the container),
# CT_STATE (host-only generated files, outside every container's mounts),
# CT_CONFIG (the generated devcontainer.json the CLI runs from),
# CT_CLAUDE_DATA (host dir mounted at CONTAINER_CLAUDE_DIR)
_container_resolve() {
    local repo="$1" branch="$2"
    if [[ -z "$repo" || -z "$branch" ]]; then
        echo "usage: devenv container <up|down|attach> <repo> <branch>"
        exit 1
    fi

    local bare="$WORKTREES_DIR/$repo/.git"
    CT_PATH="$WORKTREES_DIR/$repo/$branch"
    if [[ ! -d "$bare" || ! -d "$CT_PATH" ]]; then
        echo "error: no worktree at $CT_PATH (run: devenv worktree add $repo $branch)"
        exit 1
    fi

    CT_REPO="$repo"
    CT_BRANCH="$branch"
    CT_PN="$(_compose_project_name "$repo" "$branch")"
    CT_WORKDIR="$CONTAINER_REPO_DIR/${CT_PATH#"$REPO_DIR/"}"
    CT_STATE="$STATE_DIR/$CT_PN"
    CT_CONFIG="$CT_STATE/.devcontainer/devcontainer.json"
    CT_CLAUDE_DATA="$DATA_DIR/$CT_PN/claude"
}

# Opens VS Code attached to the running container for the worktree last
# resolved via _container_resolve (uses CT_PN). A plain "attached-container"
# URI, not a "dev-container" one, so VS Code doesn't read the generated config.
_open_vscode() {
    command -v code &>/dev/null || {
        echo "error: 'code' CLI not found on PATH (run 'Shell Command: Install code command in PATH' from VS Code)"
        exit 1
    }
    local container_name="${CT_PN}-devcontainer"
    local hex
    hex="$(printf '%s' "$container_name" | od -An -tx1 | tr -d ' \n')"
    code --folder-uri "vscode-remote://attached-container+${hex}${CT_WORKDIR}"
}

# Generates everything the devcontainer CLI runs from for the resolved worktree
# — the generated devcontainer.json (+ local Features) in CT_STATE/.devcontainer
# and the agent-layer compose override, CT_STATE/override.yaml — via
# devcontainer/generator (TypeScript, on Bun). The rationale for every mount,
# pin and setting in the agent layer lives there (src/override.ts).
_container_generate() {
    _require_devcontainer_cli
    command -v bun &>/dev/null || {
        echo "error: bun is required (https://bun.sh)" >&2
        exit 1
    }
    jq -n \
        --arg repoDir "$REPO_DIR" --arg worktreesDir "$WORKTREES_DIR" --arg repo "$CT_REPO" \
        --arg worktreePath "$CT_PATH" --arg projectName "$CT_PN" --arg home "$HOME" \
        --arg stateDir "$CT_STATE" --arg claudeDataDir "$CT_CLAUDE_DATA" \
        --arg containerRepoDir "$CONTAINER_REPO_DIR" --arg containerClaudeDir "$CONTAINER_CLAUDE_DIR" \
        --arg proxyNetwork "$SHARED_PROXY_NET" --arg defaultConfig "$DEFAULT_CONFIG" \
        --arg featuresDir "$DEVENV_FEATURES_DIR" --arg devcontainerCli "$DEVCONTAINER_CLI" \
        '$ARGS.named' \
        | bun "$REPO_DIR/devcontainer/generator/src/cli.ts" >/dev/null
}

# Creates the worktree's Claude data dir on first use, with a .claude.json that
# skips Claude's first-run onboarding and pre-trusts the worktree — the sandbox,
# not the trust prompt, is what contains it, and the prompt would otherwise
# block background agents. Only written when missing: from then on the file is
# Claude's (and agent-writable), so it's never read or overwritten here.
_container_seed_claude_data() {
    mkdir -p "$CT_CLAUDE_DATA"
    [[ -e "$CT_CLAUDE_DATA/.claude.json" ]] && return 0
    jq -n --arg ws "$CT_WORKDIR" \
        '{hasCompletedOnboarding: true, projects: {($ws): {hasTrustDialogAccepted: true}}}' \
        > "$CT_CLAUDE_DATA/.claude.json"
}

# Deletes a worktree's per-worktree data (session history included). Called by
# `devenv worktree rm`; takes repo/branch so callers needn't resolve.
_container_remove_data() {
    local pn
    pn="$(_compose_project_name "$1" "$2")"
    rm -rf -- "${DATA_DIR:?}/${pn:?}"
}

# Runs a command in the resolved worktree's container as its remote user, in
# the worktree. --tty allocates a terminal when stdin is one.
_container_exec() {
    local tty=() user=()
    if [[ "${1:-}" == --tty ]]; then
        shift
        [[ -t 0 ]] && tty=(-it)
    fi
    [[ -e "$CT_STATE/meta.json" ]] && user=(-u "$(jq -r '.user' "$CT_STATE/meta.json")")
    docker exec "${tty[@]}" "${user[@]}" -w "$CT_WORKDIR" "$CT_PN-devcontainer" "$@"
}

_require_devcontainer_cli() {
    [[ -x "$DEVCONTAINER_CLI" ]] || {
        echo "error: devcontainer CLI not installed (run: devenv update)" >&2
        exit 1
    }
}

# Runs a devcontainer CLI subcommand against the generated config. Runs from
# CT_STATE because the CLI reads COMPOSE_PROJECT_NAME from a .env in its cwd
# when choosing a project name.
#
# --workspace-folder is CT_STATE, not the worktree: the CLI only accepts local
# Features under <workspace-folder>/.devcontainer/, and the worktree is
# writable from inside the container — Feature install scripts run as root at
# build time. In compose mode the CLI mounts nothing from the workspace folder
# (override.yaml does the mounting); it only uses it to locate local Features
# and to label the container so later calls find it again. Config variables
# like ${localWorkspaceFolder} were already resolved against the worktree by
# the generator's read-configuration.
#
# BUILDX_BAKE_ENTITLEMENTS_FS=0: Buildx >= 0.37.2 refuses the CLI's generated
# Dockerfile-with-features because it sits outside the build context, which
# breaks every build (devcontainers/cli#1320). Remove once Compose/the CLI
# ship the upstream fix.
_devcontainer() {
    local subcommand="$1"; shift
    (cd "$CT_STATE" && COMPOSE_PROJECT_NAME="$CT_PN" BUILDX_BAKE_ENTITLEMENTS_FS=0 \
        "$DEVCONTAINER_CLI" "$subcommand" --workspace-folder "$CT_STATE" --config "$CT_CONFIG" "$@")
}

# Hashes everything a container is created from: the generated config and
# override, local Features, plus every file beside the source config (compose
# file, Dockerfile, scripts it COPYs). Changes elsewhere in a build context
# aren't detected.
_container_inputs_hash() {
    cat "$CT_CONFIG" "$CT_STATE/override.yaml" \
        $(find "$CT_STATE/.devcontainer/features" -type f 2>/dev/null | sort) \
        $(find "$(dirname "$DEFAULT_CONFIG")" -maxdepth 1 -type f | sort) | sha256sum | cut -d' ' -f1
}

_container_exists() {
    docker ps -a -q --filter "label=com.docker.compose.project=$CT_PN" | grep -q .
}

# --- shared firewall+approver stack (one instance total, not per-worktree) ---

_shared_seed_firewall() {
    mkdir -p "$SHARED_FIREWALL_DIR"
    [[ -e "$SHARED_FIREWALL_DIR/allowed_domains.txt" ]] || cp "$SHARED_FIREWALL_DIR/allowed_domains.txt.default" "$SHARED_FIREWALL_DIR/allowed_domains.txt"
    [[ -e "$SHARED_FIREWALL_DIR/denied_domains.txt" ]] || cp "$SHARED_FIREWALL_DIR/denied_domains.txt.default" "$SHARED_FIREWALL_DIR/denied_domains.txt"
}

_shared_compose() {
    SHARED_FIREWALL_DIR="$SHARED_FIREWALL_DIR" COMPOSE_PROJECT_NAME="$SHARED_PN" \
        docker compose -p "$SHARED_PN" -f "$REPO_DIR/devcontainer/infra/docker-compose.yml" "$@"
}

_shared_ensure_up() {
    _shared_seed_firewall
    _shared_compose up -d --build
}

_shared_wait_healthy() {
    local status
    for _ in $(seq 1 30); do
        status="$(docker inspect -f '{{.State.Health.Status}}' "${SHARED_PN}-firewall" 2>/dev/null || true)"
        [[ "$status" == "healthy" ]] && return 0
        sleep 1
    done
    echo "error: shared firewall (${SHARED_PN}-firewall) did not become healthy" >&2
    exit 1
}

# Tear down the shared stack once no worktree app container is left on its
# network. Derived live from Docker state (not a counter file) so it can't
# drift out of sync on a crash.
_shared_maybe_down() {
    local remaining
    # The firewall itself is always attached to proxy_net, so exclude it —
    # "remaining" here means worktree app containers still attached.
    remaining="$(docker network inspect "$SHARED_PROXY_NET" --format '{{range .Containers}}{{.Name}}{{"\n"}}{{end}}' 2>/dev/null | grep -v "^\$" | grep -vc "^${SHARED_PN}-firewall\$" || true)"
    if [[ "${remaining:-0}" -eq 0 ]]; then
        _shared_compose down
    fi
}

cmd_container_up() {
    local code=0 rebuild=0 args=()
    for a in "$@"; do
        case "$a" in
            --code) code=1 ;;
            --rebuild) rebuild=1 ;;
            *) args+=("$a") ;;
        esac
    done
    local repo="${args[0]:-}" branch="${args[1]:-}"
    if [[ -z "$repo" || -z "$branch" ]]; then
        _pick_worktree_any
        repo="$PICK_REPO"; branch="$PICK_BRANCH"
    fi

    _container_resolve "$repo" "$branch"
    _container_up "$rebuild"
    echo "up: $CT_PN"
    if [[ "$code" -eq 1 ]]; then
        _open_vscode
    fi
}

# Creates or starts the resolved worktree's container (and the shared stack
# first). Shared by `container up` and `agent up`. Pass 1 to recreate it.
_container_up() {
    local rebuild="${1:-0}"
    _shared_ensure_up
    _shared_wait_healthy
    _container_generate
    _container_seed_claude_data
    _container_ensure_volume shared-pnpm-store
    _container_ensure_volume ka-jo-zsh-history

    # The CLI never recreates an existing container on its own, so config
    # drift is reported rather than silently applied (recreating discards
    # container-local state, e.g. background agent sessions).
    local hash is_creating=1 up_args=() result
    hash="$(_container_inputs_hash)"
    if [[ "$rebuild" -eq 1 ]]; then
        up_args+=(--remove-existing-container)
    elif _container_exists; then
        is_creating=0
        if [[ "$(cat "$CT_STATE/created.sha256" 2>/dev/null)" != "$hash" ]]; then
            echo "warning: config changed since this container was created; run 'devenv container up $CT_REPO $CT_BRANCH --rebuild' (or down/up) to apply it" >&2
        fi
    fi
    result="$(_devcontainer up "${up_args[@]}")" || {
        printf '%s\n' "$result" | jq -r '.message // .' >&2
        exit 1
    }
    if [[ "$is_creating" -eq 1 ]]; then
        printf '%s\n' "$hash" > "$CT_STATE/created.sha256"
    fi
    # What exec consumers (_container_exec, the dashboard) need to reach the
    # container without the compose files: who to run as.
    printf '%s' "$result" | jq --arg container "$CT_PN-devcontainer" \
        '{container: $container, user: .remoteUser, workdir: .remoteWorkspaceFolder}' > "$CT_STATE/meta.json"
}

cmd_container_down() {
    local repo="${1:-}" branch="${2:-}"
    if [[ -z "$repo" || -z "$branch" ]]; then
        _pick_worktree_running
        repo="$PICK_REPO"; branch="$PICK_BRANCH"
    fi

    _container_resolve "$repo" "$branch"
    # By project name alone: compose finds the stack's containers by label.
    docker compose -p "$CT_PN" down
    _shared_maybe_down
    echo "down: $CT_PN"
}

cmd_container_attach() {
    local code=0 args=()
    for a in "$@"; do
        if [[ "$a" == "--code" ]]; then code=1; else args+=("$a"); fi
    done
    local repo="${args[0]:-}" branch="${args[1]:-}"
    if [[ -z "$repo" || -z "$branch" ]]; then
        _pick_worktree_running
        repo="$PICK_REPO"; branch="$PICK_BRANCH"
    fi

    _container_resolve "$repo" "$branch"
    _container_generate
    if [[ "$code" -eq 1 ]]; then
        _open_vscode
    else
        _devcontainer exec zsh
    fi
}

cmd_container_list() {
    docker ps -a --filter "label=com.docker.compose.project=$SHARED_PN" --format "$SHARED_PN	{{.Names}}	{{.Status}}"
    local repo branch pn
    while IFS=$'\t' read -r repo branch; do
        pn="$(_compose_project_name "$repo" "$branch")"
        docker ps -a --filter "label=com.docker.compose.project=$pn" --format "$pn	{{.Names}}	{{.Status}}"
    done < <(_iter_worktrees) | sort
}

cmd_container() {
    case "${1:-}" in
        up)     shift; cmd_container_up "$@" ;;
        down)   shift; cmd_container_down "$@" ;;
        attach) shift; cmd_container_attach "$@" ;;
        list)   shift; cmd_container_list "$@" ;;
        *)
            echo "usage: devenv container <up|down|attach|list> ..."
            exit 1
            ;;
    esac
}
