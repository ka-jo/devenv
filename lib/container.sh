SHARED_PN="devenv-shared"
SHARED_PROXY_NET="devenv-shared_proxy_net"
# Lives inside ~/devenv, which app containers mount read-only — only the
# approver (never an app container) writes it.
SHARED_FIREWALL_DIR="$REPO_DIR/devcontainer/infra/firewall"
# Where ~/devenv is mounted inside every app container. Worktrees are mounted at
# their mirrored path under it (not /workspace) so the relative gitdir links
# written by `git worktree add --relative-paths` resolve the same as on the host.
CONTAINER_REPO_DIR="/home/ka-jo/devenv"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/devenv"
DEVCONTAINER_CLI="$REPO_DIR/node_modules/.bin/devcontainer"
# The config used for any worktree whose project doesn't define its own.
DEFAULT_CONFIG="$REPO_DIR/devcontainer/devcontainer.json"

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

# Sets globals: CT_REPO, CT_PATH (worktree checkout path), CT_PN (compose
# project name), CT_WORKDIR (CT_PATH's mirrored path inside the container),
# CT_STATE (host-only generated files, outside every container's mounts),
# CT_CONFIG (the generated devcontainer.json the CLI runs from)
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
    CT_PN="$(_compose_project_name "$repo" "$branch")"
    CT_WORKDIR="$CONTAINER_REPO_DIR/${CT_PATH#"$REPO_DIR/"}"
    CT_STATE="$STATE_DIR/$CT_PN"
    CT_CONFIG="$CT_STATE/.devcontainer/devcontainer.json"
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

# Generates the per-worktree compose override: this worktree and its bare repo
# read-write at their mirrored paths, every other repo's bare .git read-only,
# and read-only pins over everything git takes config/hooks from. Without
# those pins a sandboxed process could plant core.hooksPath/core.fsmonitor (or
# repoint a worktree's .git file or commondir at a config it controls) and get
# code execution on the host the next time git runs there.
#
# Known gap: submodule git dirs (<bare>/modules/) stay writable, so the same
# applies to host-side submodule commands in repos that use submodules.
_container_write_override() {
    local bare="$WORKTREES_DIR/$CT_REPO/.git" gitdir admin other others=()
    gitdir="$(sed -n 's/^gitdir: //p' "$CT_PATH/.git")"
    if [[ "$gitdir" == /* ]]; then
        echo "error: $CT_PATH has an absolute gitdir link, which can't resolve inside the container" >&2
        echo "  fix: git -C $CT_PATH worktree repair --relative-paths" >&2
        exit 1
    fi
    admin="$(realpath -m "$CT_PATH/$gitdir")"
    for other in "$WORKTREES_DIR"/*/.git; do
        [[ -d "$other" && "$other" != "$bare" ]] && others+=("$other")
    done
    mkdir -p "$CT_STATE" "$bare/hooks"

    jq -n \
        --arg host "$REPO_DIR" --arg ct "$CONTAINER_REPO_DIR" \
        --arg wt "$CT_PATH" --arg bare "$bare" --arg admin "$admin" '
        def bind($ro): {type: "bind", source: ., target: ($ct + ltrimstr($host)), read_only: $ro};
        {services: {devcontainer: {
            working_dir: ($ct + ($wt | ltrimstr($host))),
            volumes: ([
                ($wt | bind(false)),
                ($wt + "/.git" | bind(true)),
                ($bare | bind(false)),
                ($bare + "/config" | bind(true)),
                ($bare + "/hooks" | bind(true)),
                ($bare + "/worktrees" | bind(true)),
                ($admin | bind(false)),
                ($admin + "/commondir" | bind(true))
            ] + [$ARGS.positional[] | bind(true)])
        }}}' --args "${others[@]}" > "$CT_STATE/override.json"
}

_container_compose() {
    COMPOSE_PROJECT_NAME="$CT_PN" docker compose -p "$CT_PN" \
        -f "$REPO_DIR/devcontainer/docker-compose.yml" -f "$CT_STATE/override.json" "$@"
}

# Generates the devcontainer.json the CLI actually runs from: the source config
# plus the per-worktree fields no devcontainer variable can express — the
# mirrored workspaceFolder, and compose paths made absolute (the generated file
# lives in CT_STATE, not beside its compose files) with override.json last.
_container_write_config() {
    local source="$DEFAULT_CONFIG" parsed
    _require_devcontainer_cli
    mkdir -p "$CT_STATE/.devcontainer"
    # read-configuration rather than jq on the raw file: configs are JSONC.
    parsed="$("$DEVCONTAINER_CLI" read-configuration --workspace-folder "$CT_PATH" --config "$source" 2>/dev/null)" || {
        echo "error: couldn't read $source (run: $DEVCONTAINER_CLI read-configuration --workspace-folder $CT_PATH --config $source)" >&2
        exit 1
    }
    printf '%s' "$parsed" | jq \
        --arg dir "$(dirname "$source")" --arg override "$CT_STATE/override.json" --arg wf "$CT_WORKDIR" '
        .configuration
        | del(.configFilePath)
        | .dockerComposeFile = ([.dockerComposeFile | if type == "string" then [.] else . end | .[] | $dir + "/" + .] + [$override])
        | .workspaceFolder = $wf' > "$CT_CONFIG"

    # The CLI resolves local Features ("./features/<id>") relative to the config
    # file and rejects any outside a directory named .devcontainer — hence
    # CT_CONFIG's location and copying them beside it.
    rm -rf "${CT_STATE:?}/.devcontainer/features"
    if [[ -d "$(dirname "$source")/features" ]]; then
        cp -r "$(dirname "$source")/features" "$CT_STATE/.devcontainer/features"
    fi
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
# (override.json does the mounting); it only uses it to locate local Features
# and to label the container so later calls find it again. Config variables
# like ${localWorkspaceFolder} were already resolved against the worktree by
# _container_write_config's read-configuration.
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
    cat "$CT_CONFIG" "$CT_STATE/override.json" \
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
    _shared_ensure_up
    _shared_wait_healthy
    _container_write_override
    _container_write_config
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
            echo "warning: config changed since this container was created; run 'devenv container up $repo $branch --rebuild' (or down/up) to apply it" >&2
        fi
    fi
    result="$(_devcontainer up "${up_args[@]}")" || {
        printf '%s\n' "$result" | jq -r '.message // .' >&2
        exit 1
    }
    if [[ "$is_creating" -eq 1 ]]; then
        printf '%s\n' "$hash" > "$CT_STATE/created.sha256"
    fi
    echo "up: $CT_PN"
    if [[ "$code" -eq 1 ]]; then
        _open_vscode
    fi
}

cmd_container_down() {
    local repo="${1:-}" branch="${2:-}"
    if [[ -z "$repo" || -z "$branch" ]]; then
        _pick_worktree_running
        repo="$PICK_REPO"; branch="$PICK_BRANCH"
    fi

    _container_resolve "$repo" "$branch"
    _container_write_override
    _container_compose down
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
    _container_write_override
    _container_write_config
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
