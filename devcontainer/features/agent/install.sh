#!/bin/bash
# Installs devenv's agent tooling for $_REMOTE_USER. Runs as root at image
# build time.
set -euo pipefail

DEVENV_DIR="$DEVENVDIR"
MIN_GIT_VERSION="2.48"

# devenv creates worktrees with --relative-paths, which sets
# extensions.relativeWorktrees; older git refuses to open those repos at all.
git_version="$(git --version 2>/dev/null | awk '{print $3}')"
if [[ -z "$git_version" ]] || [[ "$(printf '%s\n%s\n' "$MIN_GIT_VERSION" "$git_version" | sort -V | head -1)" != "$MIN_GIT_VERSION" ]]; then
    echo "agent feature: git >= $MIN_GIT_VERSION is required (found: ${git_version:-none})." >&2
    echo "  Install a newer git in the image, e.g. via ghcr.io/devcontainers/features/git." >&2
    exit 1
fi

# libatomic1: runtime dependency of the native Claude Code binary.
if command -v apt-get >/dev/null; then
    apt-get update
    apt-get install -y --no-install-recommends curl ca-certificates libatomic1
    rm -rf /var/lib/apt/lists/*
elif ! command -v curl >/dev/null; then
    echo "agent feature: curl is required and only apt-based images are handled automatically." >&2
    exit 1
fi

su "$_REMOTE_USER" -c 'curl -fsSL https://claude.ai/install.sh | bash'
# Not $_REMOTE_USER_HOME: the CLI computes it before the build, so it's empty
# when the user is created by an earlier Feature (common-utils) in this build.
user_home="$(getent passwd "$_REMOTE_USER" | cut -d: -f6)"
# A symlink, not a copy: the native installer's auto-update repoints
# ~/.local/bin/claude, and this follows it.
ln -sf "$user_home/.local/bin/claude" /usr/local/bin/claude

# Dangling until the ~/devenv bind mount populates the target at runtime.
ln -sf "$DEVENV_DIR/bin/devenv" /usr/local/bin/devenv

# claude-wrapper attaches per-session proxy credentials (the approver's session
# id) and then execs `claude` from PATH.
for rc in /etc/zsh/zshrc /etc/bash.bashrc; do
    [[ -f "$rc" ]] && echo "alias claude='$DEVENV_DIR/bin/claude-wrapper'" >> "$rc"
done
