#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPECTED_DIR="$HOME/devenv"
CLAUDE_DIR="$HOME/.claude"

# The repo must live at ~/devenv. The dev container template bind-mounts
# ${HOME}/devenv into the container at a fixed path, and the ~/.claude/*
# symlinks below are relative (../devenv/claude/...) — both assumptions
# break if the repo is anywhere else. See README for the rationale.
if [ "$REPO_DIR" != "$EXPECTED_DIR" ]; then
    echo "error: devenv must be cloned to $EXPECTED_DIR (found at $REPO_DIR)" >&2
    echo "       move or re-clone the repo there, then re-run this script." >&2
    exit 1
fi

mkdir -p "$CLAUDE_DIR"

# Relative symlinks so they resolve the same way on the host and inside any
# dev container that bind-mounts ~/.claude and ~/devenv at sibling paths.
link_relative() {
    local target_rel="$1"   # path relative to $CLAUDE_DIR
    local dest="$2"

    if [ -L "$dest" ]; then
        if [ "$(readlink "$dest")" = "$target_rel" ]; then
            echo "ok: $dest -> $target_rel"
            return
        fi
        echo "replacing existing symlink: $dest"
        rm "$dest"
    elif [ -e "$dest" ]; then
        echo "error: $dest exists and is not a symlink; refusing to overwrite" >&2
        exit 1
    fi

    ln -s "$target_rel" "$dest"
    echo "linked: $dest -> $target_rel"
}

link_relative "../devenv/claude/CLAUDE.md"      "$CLAUDE_DIR/CLAUDE.md"
link_relative "../devenv/claude/rules"          "$CLAUDE_DIR/rules"
link_relative "../devenv/claude/skills"         "$CLAUDE_DIR/skills"
link_relative "../devenv/claude/agents"         "$CLAUDE_DIR/agents"
link_relative "../devenv/claude/commands"       "$CLAUDE_DIR/commands"
link_relative "../devenv/claude/output-styles"  "$CLAUDE_DIR/output-styles"

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
DEVENV_BIN="$BIN_DIR/devenv"
if [ -L "$DEVENV_BIN" ] && [ "$(readlink "$DEVENV_BIN")" = "$REPO_DIR/bin/devenv" ]; then
    echo "ok: $DEVENV_BIN"
else
    ln -sf "$REPO_DIR/bin/devenv" "$DEVENV_BIN"
    chmod +x "$REPO_DIR/bin/devenv"
    echo "linked: $DEVENV_BIN -> $REPO_DIR/bin/devenv"
fi

# Ensure jq is available for JSON surgery on VS Code settings below.
if ! command -v jq > /dev/null 2>&1; then
    echo "installing jq..."
    sudo apt-get install -y jq
fi

# Ensure wslu is available for wslvar/wslpath helpers used by devenv commands.
if ! command -v wslvar > /dev/null 2>&1; then
    echo "installing wslu..."
    sudo apt-get install -y wslu
fi

# VS Code: register devcontainer-configs/ as a repository configuration path so
# per-project devcontainer setups can live in ~/devenv without being committed to
# project repos. VS Code derives the lookup path from `git remote -v`; place
# configs at devcontainer-configs/github.com/<user>/<repo>/.devcontainer/.
CONFIGS_DIR="$REPO_DIR/devcontainer-configs"
mkdir -p "$CONFIGS_DIR"

APPDATA=$(cmd.exe /c "echo %APPDATA%" 2>/dev/null | tr -d '\r\n')
if [ -z "$APPDATA" ]; then
    echo "warning: could not detect Windows APPDATA; skipping VS Code settings" >&2
    echo "         add this manually to VS Code user settings:" >&2
    echo "         \"dev.containers.repositoryConfigurationPaths\": [\"<path to devenv>/devcontainer-configs\"]" >&2
else
    VSCODE_SETTINGS=$(wslpath "$APPDATA/Code/User/settings.json")
    WIN_CONFIGS_DIR=$(wslpath -w "$CONFIGS_DIR")

    if [ ! -f "$VSCODE_SETTINGS" ]; then
        echo '{}' > "$VSCODE_SETTINGS"
    fi

    if ! jq . "$VSCODE_SETTINGS" > /dev/null 2>&1; then
        echo "warning: $VSCODE_SETTINGS is not valid JSON (may contain comments); skipping" >&2
        echo "         add this manually to VS Code user settings:" >&2
        echo "         \"dev.containers.repositoryConfigurationPaths\": [\"$WIN_CONFIGS_DIR\"]" >&2
    elif jq -e --arg p "$WIN_CONFIGS_DIR" \
            '.["dev.containers.repositoryConfigurationPaths"] | arrays | contains([$p])' \
            "$VSCODE_SETTINGS" > /dev/null 2>&1; then
        echo "ok: VS Code repositoryConfigurationPaths"
    else
        jq --arg p "$WIN_CONFIGS_DIR" \
            '.["dev.containers.repositoryConfigurationPaths"] = ((.["dev.containers.repositoryConfigurationPaths"] // []) + [$p] | unique)' \
            "$VSCODE_SETTINGS" > "$VSCODE_SETTINGS.tmp" && mv "$VSCODE_SETTINGS.tmp" "$VSCODE_SETTINGS"
        echo "updated: VS Code repositoryConfigurationPaths += $WIN_CONFIGS_DIR"
    fi
fi

echo "done."
