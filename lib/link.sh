# Relative symlinks so they resolve the same way on the host and inside any
# dev container that bind-mounts ~/.claude/<entry> and ~/devenv at sibling paths.
# Silent when the link is already correct.
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

# Make ~/.claude/<name> a real directory holding one symlink per child of
# claude/<name>/, so anything Claude writes there at runtime stays out of the repo.
_link_children() {
    local name="$1"
    local src="$REPO_DIR/claude/$name"
    local dest="$HOME/.claude/$name"
    local entry base

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
        _link_relative "../../devenv/claude/$name/$base" "$dest/$base"
    done

    # Prune links whose repo-side target was deleted.
    for entry in "$dest"/*; do
        if [ -L "$entry" ] && [ ! -e "$entry" ] \
            && [[ "$(readlink "$entry")" == ../../devenv/claude/"$name"/* ]]; then
            rm "$entry"
            echo "pruned: $entry"
        fi
    done

    shopt -u nullglob dotglob
}

cmd_link() {
    mkdir -p "$HOME/.claude"
    _link_relative "../devenv/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
    local name
    for name in rules skills agents commands output-styles; do
        _link_children "$name"
    done
}
