# Relative symlinks so they resolve the same way on the host (~/.claude beside
# ~/devenv) and inside dev containers (/.claude beside /devenv), where the agent
# Feature runs `devenv link` on every start. Silent when the link is already
# correct.
_link_relative() {
    local target_rel="$1"   # path relative to the link's own directory
    local dest="$2"

    if [ -L "$dest" ]; then
        [ "$(readlink "$dest")" = "$target_rel" ] && return
        echo "replacing existing symlink: $dest"
        rm "$dest"
    elif [ -e "$dest" ]; then
        echo "error: $dest exists and is not a symlink; refusing to overwrite" >&2
        return 1
    fi

    ln -s "$target_rel" "$dest"
    echo "linked: $dest -> $target_rel"
}

# Make <claude dir>/<name> a real directory holding one symlink per child of
# claude/<name>/, so anything Claude writes there at runtime stays out of the repo.
_link_children() {
    local name="$1" claude_dir="$2"
    local src="$REPO_DIR/claude/$name"
    local dest="$claude_dir/$name"
    local entry base src_rel
    src_rel="$(_relative_to "$dest" "$src")"

    shopt -s nullglob dotglob

    # Migrate from the old whole-directory symlink: untracked entries in the repo
    # were written by Claude, not authored here, so they move to the real directory.
    if [ -L "$dest" ]; then
        rm "$dest"
        mkdir -p "$dest"
        for entry in "$src"/*; do
            base="$(basename "$entry")"
            if ! git -C "$REPO_DIR" ls-files --error-unmatch -- "claude/$name/$base" > /dev/null 2>&1; then
                mv "$entry" "$dest/$base"
                echo "moved untracked: claude/$name/$base -> $dest/$base"
            fi
        done
    fi
    mkdir -p "$dest"

    for entry in "$src"/*; do
        base="$(basename "$entry")"
        [ "$base" = .gitkeep ] && continue
        _link_relative "$src_rel/$base" "$dest/$base"
    done

    # Prune links whose repo-side target was deleted.
    for entry in "$dest"/*; do
        if [ -L "$entry" ] && [ ! -e "$entry" ] \
            && [[ "$(readlink "$entry")" == "$src_rel"/* ]]; then
            rm "$entry"
            echo "pruned: $entry"
        fi
    done

    shopt -u nullglob dotglob
}

# Path of $2 relative to directory $1, without resolving symlinks in either.
_relative_to() {
    realpath -ms --relative-to="$1" "$2"
}

cmd_link() {
    # Wherever Claude reads its config: ~/.claude on the host, /.claude in dev
    # containers (CLAUDE_CONFIG_DIR, set by the generated override).
    local claude_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
    mkdir -p "$claude_dir"
    _link_relative "$(_relative_to "$claude_dir" "$REPO_DIR/claude/CLAUDE.md")" "$claude_dir/CLAUDE.md"
    local name
    for name in rules skills agents commands output-styles; do
        _link_children "$name" "$claude_dir"
    done
}
