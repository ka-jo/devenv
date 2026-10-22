#!/bin/bash
set -e

sudo chown ka-jo:ka-jo /home/ka-jo/.pnpm-store

fnm install || true
pnpm install || true

exec "$@"
