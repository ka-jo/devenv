#!/usr/bin/env bash
# Builds and installs git from source, pinned by version + sha256. Shared
# between the devcontainer image build and the host (WSL/Ubuntu) so both get
# a byte-identical build recipe instead of a binary copied across distros
# with different glibc/libcurl/libssl ABIs.
#
# Requires build deps already installed:
#   build-essential libssl-dev libcurl4-openssl-dev zlib1g-dev libexpat1-dev \
#   gettext autoconf pkg-config cargo rustc
#
# Usage: build-git.sh [--prefix DIR] [--version VER] [--sha256 HASH]
set -euo pipefail

GIT_VERSION="2.55.0"
GIT_SHA256="0842dc384a23ac33ba3e570c4f3a8ded85963ee4713b1cd21153c3db41813d1e"
PREFIX="/usr/local"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    --version) GIT_VERSION="$2"; shift 2 ;;
    --sha256) GIT_SHA256="$2"; shift 2 ;;
    *) echo "build-git.sh: unknown arg: $1" >&2; exit 1 ;;
  esac
done

workdir="$(mktemp -d)"
trap 'rm -rf "${workdir}"' EXIT

cd "${workdir}"
curl -fsSLo git.tar.gz "https://mirrors.edge.kernel.org/pub/software/scm/git/git-${GIT_VERSION}.tar.gz"
echo "${GIT_SHA256}  git.tar.gz" | sha256sum -c -

tar xzf git.tar.gz
cd "git-${GIT_VERSION}"

make configure
./configure --prefix="${PREFIX}"
make -j"$(nproc)" NO_TCLTK=1 NO_GETTEXT=1 NO_PERL=1
make NO_TCLTK=1 NO_GETTEXT=1 NO_PERL=1 install
