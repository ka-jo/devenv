#!/bin/bash
set -e

if [ ! -f /etc/squid/allowed_domains.txt ]; then
    echo "ERROR: /etc/squid/allowed_domains.txt is not mounted. Add an allowed_domains.txt to your project's .devcontainer/proxy/ directory." >&2
    exit 1
fi

# Watch for changes to the allowlist and send SIGHUP to squid, which triggers
# a reconfigure (re-reads ACL files). Runs in the background; exits when squid does.
watch_allowlist() {
    while inotifywait -e close_write,moved_to,create /etc/squid/allowed_domains.txt 2>/dev/null; do
        if [ -n "$SQUID_PID" ] && kill -0 "$SQUID_PID" 2>/dev/null; then
            echo "allowed_domains.txt changed, reconfiguring squid (PID $SQUID_PID)" >&2
            kill -HUP "$SQUID_PID"
        fi
    done
}

squid -N -f /etc/squid/squid.conf &
SQUID_PID=$!

watch_allowlist &
WATCHER_PID=$!

# Propagate signals to squid and clean up watcher.
trap 'kill "$WATCHER_PID" 2>/dev/null; wait "$WATCHER_PID" 2>/dev/null; kill "$SQUID_PID" 2>/dev/null' TERM INT

wait "$SQUID_PID"
kill "$WATCHER_PID" 2>/dev/null
