cmd_update() {
    git -C "$REPO_DIR" pull
    cmd_link
}
