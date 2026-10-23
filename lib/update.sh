cmd_update() {
    git -C "$REPO_DIR" pull
    cmd_link
    _install_deps
}

# Installs the Bun workspace's pinned JS dependencies (dashboard, devcontainer
# CLI) exactly as recorded in the committed bun.lock.
_install_deps() {
    command -v bun &>/dev/null || {
        echo "error: bun is required (https://bun.sh)" >&2
        exit 1
    }
    bun install --cwd "$REPO_DIR" --frozen-lockfile
}
