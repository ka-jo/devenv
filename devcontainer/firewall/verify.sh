#!/bin/bash
# Verify egress firewall: all allowed domains reachable, blocked domains are not.
set -euo pipefail

ALLOWED_DOMAINS_FILE="/workspace/.devcontainer/firewall/allowed_domains.txt"
BLOCKED_DOMAIN="google.com"

PASS=0
FAIL=0

check_reachable() {
    local domain="$1"
    # Strip leading '.' (subdomain wildcard) to get a testable hostname.
    local host="${domain#.}"
    if curl -fsS --max-time 10 -o /dev/null "https://${host}" 2>/dev/null; then
        echo "  [ok] ${host}"
        ((PASS++))
    else
        echo "  [FAIL] ${host} — expected reachable but got blocked" >&2
        ((FAIL++))
    fi
}

check_blocked() {
    local domain="$1"
    if curl -fsS --max-time 10 -o /dev/null "https://${domain}" 2>/dev/null; then
        echo "  [FAIL] ${domain} — expected blocked but got through" >&2
        ((FAIL++))
    else
        echo "  [ok] ${domain} (correctly blocked)"
        ((PASS++))
    fi
}

echo "==> Verifying firewall allowlist (${ALLOWED_DOMAINS_FILE})"
while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip blank lines and comments.
    [[ -z "$line" || "$line" == \#* ]] && continue
    check_reachable "$line"
done < "$ALLOWED_DOMAINS_FILE"

echo ""
echo "==> Verifying blocked domain"
check_blocked "$BLOCKED_DOMAIN"

echo ""
if [[ $FAIL -gt 0 ]]; then
    echo "Firewall verification FAILED: ${FAIL} check(s) failed, ${PASS} passed." >&2
    exit 1
else
    echo "Firewall verification passed: ${PASS} check(s) ok."
fi
