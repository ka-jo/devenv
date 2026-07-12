_require_fzf() {
    command -v fzf &>/dev/null || {
        echo "error: fzf is required for interactive selection (pass <repo> <branch> explicitly, or install fzf)"
        exit 1
    }
}

# Interactive pick across every worktree of every repo. Sets PICK_REPO/PICK_BRANCH.
_pick_worktree_any() {
    _require_fzf
    local sel
    sel="$(_iter_worktrees | sort | fzf --prompt="worktree> " --delimiter='\t' --with-nth=1,2)" || exit 1
    [[ -n "$sel" ]] || exit 1
    PICK_REPO="${sel%%$'\t'*}"
    PICK_BRANCH="${sel#*$'\t'}"
}

# Interactive pick restricted to worktrees with a currently running app
# container. Sets PICK_REPO/PICK_BRANCH.
_pick_worktree_running() {
    _require_fzf
    local repo branch pn candidates=()
    while IFS=$'\t' read -r repo branch; do
        pn="$(_compose_project_name "$repo" "$branch")"
        if docker ps --filter "label=com.docker.compose.project=$pn" --filter "status=running" -q | grep -q .; then
            candidates+=("$repo"$'\t'"$branch")
        fi
    done < <(_iter_worktrees)

    if [[ ${#candidates[@]} -eq 0 ]]; then
        echo "error: no running devenv containers"
        exit 1
    fi

    local sel
    sel="$(printf '%s\n' "${candidates[@]}" | sort | fzf --prompt="container> " --delimiter='\t' --with-nth=1,2)" || exit 1
    [[ -n "$sel" ]] || exit 1
    PICK_REPO="${sel%%$'\t'*}"
    PICK_BRANCH="${sel#*$'\t'}"
}
