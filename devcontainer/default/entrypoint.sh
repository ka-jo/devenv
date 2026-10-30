#!/bin/bash
set -e

# Docker creates missing volume mountpoints root-owned.
sudo chown ka-jo:ka-jo /home/ka-jo/.pnpm-store /home/ka-jo/commandhistory

# Make the worktree's Node version fnm's default, so non-interactive processes
# (agents included) get it too, not just interactive shells that cd here. Only
# the worktree's own file counts: a lookup further up would find ~/devenv's.
node_version="$(cat .node-version 2>/dev/null || cat .nvmrc 2>/dev/null || true)"
if [[ -n "$node_version" ]]; then
    fnm install "$node_version" && fnm default "$node_version" || true
fi
pnpm install || true

exec "$@"
