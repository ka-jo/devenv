#!/bin/bash
# Verify egress firewall: all allowed domains reachable, blocked domains are not.
set -uo pipefail

ALLOWED_DOMAINS_FILE="/workspace/.devcontainer/firewall/allowed_domains.txt"
BLOCKED_DOMAIN="google.com"

PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

check_reachable() {
    local domain="$1"
    local host="${domain#.}"
    if curl -fsS --max-time 10 -o /dev/null "https://${host}" 2>/dev/null; then
        echo -e "  ${GREEN}[ok]${RESET} ${host}"
        ((PASS++))
    else
        echo -e "  ${RED}[FAIL]${RESET} ${host} — expected reachable but got blocked"
        ((FAIL++))
    fi
}

check_blocked() {
    local domain="$1"
    if curl -fsS --max-time 10 -o /dev/null "https://${domain}" 2>/dev/null; then
        echo -e "  ${RED}[FAIL]${RESET} ${domain} — expected blocked but got through"
        ((FAIL++))
    else
        echo -e "  ${GREEN}[ok]${RESET} ${domain} (correctly blocked)"
        ((PASS++))
    fi
}

echo -e "${BOLD}==> Verifying firewall allowlist (${ALLOWED_DOMAINS_FILE})${RESET}"
while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    check_reachable "$line"
done < "$ALLOWED_DOMAINS_FILE"

echo ""
echo -e "${BOLD}==> Verifying blocked domain${RESET}"
check_blocked "$BLOCKED_DOMAIN"

echo ""
if [[ $FAIL -gt 0 ]]; then
    echo -e "${YELLOW}warning:${RESET} firewall verification had ${FAIL} failure(s) — ${PASS} passed."
else
    echo -e "${GREEN}Firewall verification passed:${RESET} ${PASS} check(s) ok."
fi
