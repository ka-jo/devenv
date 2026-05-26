#!/bin/bash
set -e

if [ ! -f /etc/squid/allowed_domains.txt ]; then
    echo "ERROR: /etc/squid/allowed_domains.txt is not mounted. Add an allowed_domains.txt to your project's .devcontainer/proxy/ directory." >&2
    exit 1
fi

exec squid -N -f /etc/squid/squid.conf
