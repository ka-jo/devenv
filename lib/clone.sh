# layout: worktrees/<repo>/.git is a bare repo; worktrees/<repo>/<branch-path>
# is a real checkout for every branch, including the default one. No checkout
# is "the base repo" - keeps every branch symmetric and independently removable.
cmd_clone() {
    local url="${1:-}"
    local name="${2:-$(basename "$url" .git)}"
    if [[ -z "$url" ]]; then
        echo "usage: devenv clone <url> [name]"
        exit 1
    fi

    local target="$WORKTREES_DIR/$name"
    if [[ -e "$target" ]]; then
        echo "error: $target already exists"
        exit 1
    fi

    mkdir -p "$target"
    git clone -q --bare "$url" "$target/.git"
    # bare clone leaves remote.origin.fetch unset, so `fetch` only ever
    # updates FETCH_HEAD - set the standard refspec so it tracks properly.
    git -C "$target/.git" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
    git -C "$target/.git" fetch -q origin

    local default_branch
    default_branch="$(git -C "$target/.git" symbolic-ref --short HEAD)"
    git -C "$target/.git" worktree add -q "$target/$default_branch" "$default_branch"
    echo "cloned $name -> $target/$default_branch"
}
