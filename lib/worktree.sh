cmd_worktree_add() {
    local repo="${1:-}" branch="${2:-}" base="${3:-}"
    if [[ -z "$repo" || -z "$branch" ]]; then
        echo "usage: devenv worktree add <repo> <branch> [base]"
        exit 1
    fi

    local bare="$WORKTREES_DIR/$repo/.git"
    if [[ ! -d "$bare" ]]; then
        echo "error: no repo at $WORKTREES_DIR/$repo (run: devenv clone <url> $repo)"
        exit 1
    fi

    local path="$WORKTREES_DIR/$repo/$branch"
    if git -C "$bare" show-ref --verify --quiet "refs/heads/$branch" \
        || git -C "$bare" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
        # existing local branch, or a remote branch not yet checked out anywhere -
        # `worktree add` DWIMs a tracking branch from origin/<branch> for the latter.
        git -C "$bare" worktree add --relative-paths "$path" "$branch"
    else
        base="${base:-$(git -C "$bare" symbolic-ref --short HEAD)}"
        git -C "$bare" worktree add --relative-paths -b "$branch" "$path" "$base"
    fi
    echo "worktree ready: $path"
}

cmd_worktree_rm() {
    local repo="${1:-}" branch="${2:-}"
    shift 2 2>/dev/null || true
    local force=0
    while [[ "${1:-}" == --* ]]; do
        case "$1" in
            --force) force=1; shift ;;
            *) echo "unknown option: $1"; exit 1 ;;
        esac
    done
    if [[ -z "$repo" || -z "$branch" ]]; then
        echo "usage: devenv worktree rm <repo> <branch> [--force]"
        exit 1
    fi

    local bare="$WORKTREES_DIR/$repo/.git"
    local path="$WORKTREES_DIR/$repo/$branch"
    local args=(worktree remove)
    [[ "$force" -eq 1 ]] && args+=(--force)
    git -C "$bare" "${args[@]}" "$path"

    # prune now-empty branch-path parent dirs (e.g. feature/ after removing
    # feature/x); -prune (not -delete, which forces -depth and breaks -prune)
    # keeps traversal from ever descending into the bare .git.
    find "$WORKTREES_DIR/$repo" -mindepth 1 -path "$bare" -prune -o -type d -empty -print0 \
        | sort -rz | xargs -0 -r rmdir 2>/dev/null || true
    echo "removed: $path"

    # -d refuses to delete a branch not fully merged; --force upgrades to -D.
    git -C "$bare" branch "$([[ "$force" -eq 1 ]] && echo -D || echo -d)" "$branch"
    echo "deleted branch: $branch"
}

cmd_worktree_list() {
    local repo="${1:-}"
    if [[ -n "$repo" ]]; then
        git -C "$WORKTREES_DIR/$repo/.git" worktree list
        return
    fi
    for d in "$WORKTREES_DIR"/*/; do
        [[ -d "$d/.git" ]] || continue
        echo "== $(basename "$d") =="
        git -C "$d/.git" worktree list
    done
}

cmd_worktree() {
    case "${1:-}" in
        add)  shift; cmd_worktree_add "$@" ;;
        rm)   shift; cmd_worktree_rm "$@" ;;
        list) shift; cmd_worktree_list "$@" ;;
        *)
            echo "usage: devenv worktree <add|rm|list> ..."
            exit 1
            ;;
    esac
}
