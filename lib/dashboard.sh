cmd_dashboard() {
    command -v bun &>/dev/null || {
        echo "error: bun is required (https://bun.sh)"
        exit 1
    }
    exec bun run --cwd "$REPO_DIR/dashboard" src/App.tsx
}
