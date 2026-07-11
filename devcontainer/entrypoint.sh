#!/bin/bash
set -e

sudo chown ka-jo:ka-jo /home/ka-jo/.pnpm-store

cd /workspace
fnm install || true
pnpm install || true

exec "$@"
