#!/bin/bash
# Squid external_acl backend: for each non-allowlisted request, ask the approver
# sidecar for a verdict and block until a human decides. Squid feeds one request
# per line on stdin ("<URI> <METHOD>") and expects "OK" / "ERR" per line on stdout.
#
# Fail closed: any error, timeout, or non-allow verdict prints ERR (deny).
set -u

APPROVER_URL="${APPROVER_URL:-http://approver:3129}"
# How long a single request waits for a human before auto-denying.
WAIT_SECONDS="${APPROVER_WAIT_SECONDS:-120}"

# Extract the bare hostname from a Squid %URI field.
#   http://example.com/path -> example.com
#   example.com:443         -> example.com   (CONNECT authority form)
extract_host() {
    local uri="$1"
    local rest="${uri#*://}"   # strip scheme if present (no-op otherwise)
    rest="${rest%%/*}"          # strip path
    rest="${rest%%:*}"          # strip :port
    printf '%s' "$rest"
}

while read -r uri method _rest; do
    host="$(extract_host "$uri")"
    if [ -z "$host" ]; then
        echo "ERR"
        continue
    fi

    body="{\"host\":\"${host}\",\"method\":\"${method}\"}"
    response="$(curl -fsS --max-time "$WAIT_SECONDS" \
        -H 'Content-Type: application/json' \
        --data "$body" \
        "${APPROVER_URL}/pending" 2>/dev/null)"

    case "$response" in
        *'"verdict":"allow"'*) echo "OK" ;;
        *)                     echo "ERR" ;;
    esac
done
