SHARED_PN="devenv-shared"
SHARED_PROXY_NET="devenv-shared_proxy_net"
# TODO: this puts the live allowlist inside ~/devenv, which every app
# container bind-mounts read-write at /home/ka-jo/devenv (for the ~/.claude
# symlink trick) — a sandboxed process can currently reach its own allowlist
# through that mount. Revisit (e.g. a read-only remount, or moving the file
# back out of the repo) before relying on this as a real trust boundary.
SHARED_FIREWALL_DIR="$REPO_DIR/devcontainer/infra/firewall"

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

# Sets globals: CT_PATH (worktree checkout path), CT_PN (compose project name)
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

    CT_PN="$(_compose_project_name "$repo" "$branch")"
}

# Opens VS Code attached to the running container for the worktree last
# resolved via _container_resolve (uses CT_PN). No devcontainer.json is
# involved — this is a plain "attached-container" URI.
_open_vscode() {
    command -v code &>/dev/null || {
        echo "error: 'code' CLI not found on PATH (run 'Shell Command: Install code command in PATH' from VS Code)"
        exit 1
    }
    local container_name="${CT_PN}-devcontainer"
    local hex
    hex="$(printf '%s' "$container_name" | od -An -tx1 | tr -d ' \n')"
    code --folder-uri "vscode-remote://attached-container+${hex}/workspace"
}

_container_write_env() {
    cat > "$CT_PATH/.devenv" <<EOF
WORKSPACE_DIR=$CT_PATH
COMPOSE_PROJECT_NAME=$CT_PN
EOF
}

_container_compose() {
    docker compose -p "$CT_PN" --env-file "$CT_PATH/.devenv" -f "$REPO_DIR/devcontainer/docker-compose.yml" "$@"
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
    local code=0 args=()
    for a in "$@"; do
        if [[ "$a" == "--code" ]]; then code=1; else args+=("$a"); fi
    done
    local repo="${args[0]:-}" branch="${args[1]:-}"
    if [[ -z "$repo" || -z "$branch" ]]; then
        _pick_worktree_any
        repo="$PICK_REPO"; branch="$PICK_BRANCH"
    fi

    _container_resolve "$repo" "$branch"
    _shared_ensure_up
    _shared_wait_healthy
    _container_write_env
    _container_ensure_volume shared-pnpm-store
    _container_ensure_volume ka-jo-zsh-history
    _container_compose up -d --build
    echo "up: $CT_PN"
    [[ "$code" -eq 1 ]] && _open_vscode
}

cmd_container_down() {
    local repo="${1:-}" branch="${2:-}"
    if [[ -z "$repo" || -z "$branch" ]]; then
        _pick_worktree_running
        repo="$PICK_REPO"; branch="$PICK_BRANCH"
    fi

    _container_resolve "$repo" "$branch"
    _container_write_env
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
    _container_write_env
    if [[ "$code" -eq 1 ]]; then
        _open_vscode
    else
        _container_compose exec devcontainer zsh
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
