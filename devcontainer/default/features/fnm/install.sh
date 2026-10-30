#!/bin/bash
# Installs fnm and standalone pnpm for $_REMOTE_USER. Runs as root at image
# build time. Bumping a version means updating its sha256 from the release's
# asset digests.
set -euo pipefail

FNM_VERSION="1.39.0"
PNPM_VERSION="11.4.0"
# Mirror containerEnv in devcontainer-feature.json.
FNM_DIR="${FNM_DIR:-/usr/local/share/fnm}"
PNPM_HOME="${PNPM_HOME:-/usr/local/share/pnpm}"

case "$(uname -m)" in
    x86_64)
        fnm_asset="fnm-linux.zip"
        fnm_sha256="7807664f39d39fc518da1c35ba0181e4b3267603c4b1dedeb4b5fc6ae440a224"
        pnpm_asset="pnpm-linux-x64.tar.gz"
        pnpm_sha256="f3f8d1217eef013bbc71a24d52efb1f1041e4aff55edd80e0b08e25f409305a4"
        ;;
    aarch64)
        fnm_asset="fnm-arm64.zip"
        fnm_sha256="4eaff58b2c5bf30d0934027572dd0b5bbb60d2a1af309230b53662d4b1d45599"
        pnpm_asset="pnpm-linux-arm64.tar.gz"
        pnpm_sha256="cc38ebd5b2610a5744f84576b963c49e6609a8df5aed714ae3de749998d4478c"
        ;;
    *)
        echo "fnm feature: unsupported architecture $(uname -m)" >&2
        exit 1
        ;;
esac

if ! command -v unzip >/dev/null || ! command -v curl >/dev/null; then
    apt-get update
    apt-get install -y --no-install-recommends unzip curl ca-certificates
    rm -rf /var/lib/apt/lists/*
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

fetch() {
    local url="$1" sha256="$2" dest="$3"
    curl -fsSL -o "$dest" "$url"
    echo "$sha256  $dest" | sha256sum -c -
}

fetch "https://github.com/Schniz/fnm/releases/download/v${FNM_VERSION}/${fnm_asset}" "$fnm_sha256" "$workdir/fnm.zip"
unzip -q "$workdir/fnm.zip" -d "$workdir"
install -m 0755 "$workdir/fnm" /usr/local/bin/fnm

# The standalone build bundles its own Node, so pnpm stays available whichever
# Node fnm has active. It runs from beside its dist/, hence a directory on PATH
# rather than a lone binary in /usr/local/bin. PNPM_HOME doubles as where pnpm
# caches the versions it switches to per project (packageManager field).
mkdir -p "$PNPM_HOME"
fetch "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/${pnpm_asset}" "$pnpm_sha256" "$workdir/pnpm.tgz"
tar -xzf "$workdir/pnpm.tgz" -C "$PNPM_HOME"

mkdir -p "$FNM_DIR"
chown -R "$_REMOTE_USER:" "$FNM_DIR" "$PNPM_HOME"

node_spec="$NODEVERSION"
[[ "$node_spec" == "lts" ]] && node_spec="--lts"
# fnm makes the first version it installs the `default` alias, which is what
# FNM_DIR/aliases/default/bin on PATH resolves to.
su "$_REMOTE_USER" -c "FNM_DIR='$FNM_DIR' fnm install $node_spec"

# Per-shell Node switching on cd. Each shell gets its own multishell dir, so a
# switch in one shell never changes Node for another process.
for rc in /etc/zsh/zshrc /etc/bash.bashrc; do
    [[ -f "$rc" ]] || continue
    shell="$(basename "$(dirname "$rc")")"
    [[ "$rc" == /etc/bash.bashrc ]] && shell=bash
    echo "eval \"\$(fnm env --use-on-cd --shell $shell)\"" >> "$rc"
done
