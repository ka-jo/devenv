_container_ensure_volume() {
    local name="$1"
    if ! docker volume inspect "$name" &>/dev/null; then
        docker volume create "$name" >/dev/null
        echo "created docker volume: $name"
    fi
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

    # info/exclude lives in the bare repo's common git dir, shared by every
    # worktree of $repo, so this covers all branches with a single write.
    local exclude="$bare/info/exclude"
    mkdir -p "$(dirname "$exclude")"
    grep -qxF '.devcontainer/' "$exclude" 2>/dev/null || echo '.devcontainer/' >> "$exclude"

    CT_PN="${repo}-$(printf '%s' "$branch" | tr '[:upper:]/' '[:lower:]-' | tr -cs 'a-z0-9-' '-')"
}

_container_seed_firewall() {
    local dir="$CT_PATH/.devcontainer/firewall"
    mkdir -p "$dir"
    [[ -e "$dir/allowed_domains.txt" ]] || cp "$REPO_DIR/devcontainer/firewall/allowed_domains.txt.default" "$dir/allowed_domains.txt"
    [[ -e "$dir/denied_domains.txt" ]] || cp "$REPO_DIR/devcontainer/firewall/denied_domains.txt.default" "$dir/denied_domains.txt"
}

_container_write_env() {
    cat > "$CT_PATH/.devcontainer/.env" <<EOF
WORKSPACE_DIR=$CT_PATH
COMPOSE_PROJECT_NAME=$CT_PN
EOF
}

_container_compose() {
    docker compose -p "$CT_PN" --env-file "$CT_PATH/.devcontainer/.env" -f "$REPO_DIR/devcontainer/docker-compose.yml" "$@"
}

cmd_container_up() {
    _container_resolve "${1:-}" "${2:-}"
    _container_seed_firewall
    _container_write_env
    _container_ensure_volume shared-pnpm-store
    _container_ensure_volume ka-jo-zsh-history
    _container_compose up -d --build
    echo "up: $CT_PN"
}

cmd_container_down() {
    _container_resolve "${1:-}" "${2:-}"
    _container_write_env
    _container_compose down
    echo "down: $CT_PN"
}

cmd_container_attach() {
    _container_resolve "${1:-}" "${2:-}"
    _container_write_env
    _container_compose exec devcontainer zsh
}

cmd_container_list() {
    local repo branch pn
    for bare in "$WORKTREES_DIR"/*/.git; do
        [[ -d "$bare" ]] || continue
        repo="$(basename "$(dirname "$bare")")"
        while IFS= read -r path; do
            [[ -d "$path" && "$path" != "$WORKTREES_DIR/$repo" ]] || continue
            branch="${path#"$WORKTREES_DIR/$repo/"}"
            pn="${repo}-$(printf '%s' "$branch" | tr '[:upper:]/' '[:lower:]-' | tr -cs 'a-z0-9-' '-')"
            docker ps -a --filter "label=com.docker.compose.project=$pn" --format "$pn	{{.Names}}	{{.Status}}"
        done < <(git -C "$bare" worktree list --porcelain | awk '/^worktree /{print $2}')
    done | sort
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
