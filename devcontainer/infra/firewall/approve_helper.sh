#!/bin/bash
# Squid external_acl backend: for each non-allowlisted request, ask the approver
# sidecar for a verdict and block until a human decides. Squid feeds one request
# per line on stdin and expects "OK" / "ERR" per line on stdout.
#
# Per PROTOCOL.md the approver exposes a single resource: POST /requests creates an
# egress request and blocks until it reaches a terminal state, returning the terminal
# EgressRequest JSON. We allow only on status "allowed".
#
# Fail closed: any error, timeout, or non-"allowed" status prints ERR (deny).
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

# Decode the per-session token a client smuggled in its Proxy-Authorization header.
# The launcher embeds the token as the Basic-auth username in the proxy URL
# (http://<token>:x@firewall:3128), so every client emits
# "Proxy-Authorization: Basic base64(<token>:x)" on the CONNECT. Squid hands us that
# header value percent-encoded (or "-" when the client sent none). Reverse it:
# percent-decode, strip the "Basic " scheme, base64-decode, take the username before
# the first ":". Echoes the session id, or nothing when absent/malformed.
#
# Attribution only: any process in the app container can forge or omit the token, so
# this is never a trust boundary — it labels honest traffic for the approver/extension.
extract_session_id() {
    local raw="$1"
    [ -z "$raw" ] && return 0
    [ "$raw" = "-" ] && return 0
    # Percent-decode: rewrite every %XX as \xXX, then let printf emit the bytes.
    local decoded
    decoded="$(printf '%b' "${raw//%/\\x}")" || return 0
    case "$decoded" in
        [Bb]asic\ *) ;;
        *) return 0 ;;
    esac
    local creds
    creds="$(printf '%s' "${decoded#* }" | base64 -d 2>/dev/null)" || return 0
    # Username before ":"; sanitize to a safe charset so a hostile token cannot
    # inject characters into the JSON body or the approver's logs.
    printf '%s' "${creds%%:*}" | tr -cd 'A-Za-z0-9._-'
}

# Squid feeds: "<URI> <METHOD> <Proxy-Authorization> [trailing]". Field 3 is the
# percent-encoded Proxy-Authorization header value (or "-"); $_rest swallows the
# trailing field Squid appends to external_acl helper input.
while read -r uri method proxy_auth _rest; do
    host="$(extract_host "$uri")"
    if [ -z "$host" ]; then
        echo "ERR"
        continue
    fi

    session_id="$(extract_session_id "$proxy_auth")"

    # Plain-HTTP %URI is a full URL; the CONNECT authority form (host:port) is not.
    url=""
    case "$uri" in *://*) url="$uri" ;; esac

    # RequestMetadata per PROTOCOL.md. All fields are Squid-percent-encoded or
    # sanitized above, so none carry JSON-breaking characters.
    body="{\"host\":\"${host}\",\"method\":\"${method}\",\"url\":\"${url}\",\"sessionId\":\"${session_id}\"}"
    response="$(curl -fsS --max-time "$WAIT_SECONDS" \
        -H 'Content-Type: application/json' \
        --data "$body" \
        "${APPROVER_URL}/requests" 2>/dev/null)"

    case "$response" in
        *'"status":"allowed"'*) echo "OK" ;;
        *)                      echo "ERR" ;;
    esac
done
