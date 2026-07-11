cmd_install_extension() {
    local skip_build=0
    while [[ "${1:-}" == --* ]]; do
        case "$1" in
            --skip-build) skip_build=1; shift ;;
            *) echo "unknown option: $1"; exit 1 ;;
        esac
    done

    run_quiet() {
        local out code
        out="$("$@" 2>&1)" || { code=$?; echo "$out" >&2; exit $code; }
    }

    if [[ "$skip_build" -eq 0 ]]; then
        echo "building extension..."
        run_quiet env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm --dir "$REPO_DIR/vsc-extension" run package
    fi

    local vsix
    vsix="$(ls "$REPO_DIR/vsc-extension/"*.vsix 2>/dev/null | head -1)"
    if [[ -z "$vsix" ]]; then
        echo "error: no .vsix found in vsc-extension/"
        exit 1
    fi

    local win_temp
    win_temp="$(wslvar TEMP | tr -d '\r')"
    local dest="$win_temp\\egress-approver.vsix"
    local dest_wsl
    dest_wsl="$(wslpath "$dest")"

    run_quiet cp "$vsix" "$dest_wsl"
    echo "copied: $vsix → $dest"

    echo "installing extension..."
    run_quiet powershell.exe -NonInteractive -c "code --install-extension '$dest'"
    echo "done"
}
