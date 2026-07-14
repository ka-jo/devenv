# Thin wrapper around claude's own native background-agent lifecycle
# (`claude --bg`, `claude agents`, `claude attach`, `claude rm`) — devenv's
# job is only repo/branch -> running container resolution, plus turning a
# devenv-chosen `name` into the short `id` those commands address (claude
# does not enforce name uniqueness, so name -> id resolution may need an
# fzf picker when more than one background agent shares a name).

CLAUDE_WRAPPER="/home/ka-jo/devenv/bin/claude-wrapper"

_require_jq() {
    command -v jq &>/dev/null || {
        echo "error: jq is required (used to parse 'claude agents --json' output)"
        exit 1
    }
}

# Resolves repo/branch (fzf picker over running containers if omitted) and
# requires the container to already be running. Sets CT_PATH/CT_PN.
_agent_resolve_running() {
    local repo="$1" branch="$2"
    if [[ -z "$repo" || -z "$branch" ]]; then
        _pick_worktree_running
        repo="$PICK_REPO"; branch="$PICK_BRANCH"
    fi

    _container_resolve "$repo" "$branch"
    if ! docker ps --filter "label=com.docker.compose.project=$CT_PN" --filter "status=running" -q | grep -q .; then
        echo "error: no running container for $repo/$branch (run: devenv agent up $repo $branch)"
        exit 1
    fi
    _container_write_env
}

# Prints `claude agents --json --all --cwd /workspace` for the worktree
# container last resolved via _agent_resolve_running/_container_resolve.
_agent_list_json() {
    _container_compose exec -T devcontainer "$CLAUDE_WRAPPER" agents --json --all --cwd /workspace
}

# Resolves a devenv agent `name` (optional) to a claude session id, scoped to
# background sessions in the worktree container last resolved. Sets
# AGENT_ID/AGENT_NAME. Opens an fzf picker when the name is omitted or
# ambiguous (claude does not enforce name uniqueness).
_agent_pick() {
    _require_jq
    local name="$1" json matches count
    json="$(_agent_list_json)"

    if [[ -n "$name" ]]; then
        matches="$(printf '%s' "$json" | jq -c --arg name "$name" '[.[] | select(.kind=="background" and .name==$name)]')"
    else
        matches="$(printf '%s' "$json" | jq -c '[.[] | select(.kind=="background")]')"
    fi
    count="$(printf '%s' "$matches" | jq 'length')"

    if [[ "$count" -eq 0 ]]; then
        if [[ -n "$name" ]]; then
            echo "error: no background agent named \"$name\" in $CT_PN"
        else
            echo "error: no background agents in $CT_PN"
        fi
        exit 1
    elif [[ "$count" -eq 1 ]]; then
        AGENT_ID="$(printf '%s' "$matches" | jq -r '.[0].id')"
        AGENT_NAME="$(printf '%s' "$matches" | jq -r '.[0].name')"
    else
        _require_fzf
        local sel
        sel="$(printf '%s' "$matches" \
            | jq -r '.[] | [.name, .id, .status, (.startedAt/1000 | gmtime | strftime("%Y-%m-%dT%H:%M:%SZ"))] | @tsv' \
            | sort \
            | fzf --prompt="agent> " --delimiter='\t' --with-nth=1,2,3,4)" || exit 1
        [[ -n "$sel" ]] || exit 1
        AGENT_NAME="${sel%%$'\t'*}"
        AGENT_ID="$(cut -f2 <<<"$sel")"
    fi
}

cmd_agent_up() {
    local repo="" branch="" name="agent" args=() extra=0
    for a in "$@"; do
        if [[ "$extra" -eq 1 ]]; then
            args+=("$a")
        elif [[ "$a" == "--" ]]; then
            extra=1
        elif [[ -z "$repo" ]]; then
            repo="$a"
        elif [[ -z "$branch" ]]; then
            branch="$a"
        else
            name="$a"
        fi
    done

    if [[ -z "$repo" || -z "$branch" ]]; then
        _pick_worktree_any
        repo="$PICK_REPO"; branch="$PICK_BRANCH"
    fi

    _container_resolve "$repo" "$branch"
    _shared_ensure_up
    _shared_wait_healthy
    _container_write_env
    _container_ensure_volume shared-pnpm-store
    _container_ensure_volume ka-jo-zsh-history
    _container_compose up -d --build

    _container_compose exec devcontainer "$CLAUDE_WRAPPER" --bg -n "$name" "${args[@]}"
    echo "agent up: $CT_PN (name: $name)"
}

cmd_agent_attach() {
    local repo="${1:-}" branch="${2:-}" name="${3:-}"
    _agent_resolve_running "$repo" "$branch"
    _agent_pick "$name"
    echo "attaching: $CT_PN (agent: $AGENT_NAME, id: $AGENT_ID)"
    _container_compose exec devcontainer "$CLAUDE_WRAPPER" attach "$AGENT_ID"
}

cmd_agent_rm() {
    local repo="${1:-}" branch="${2:-}" name="${3:-}"
    _agent_resolve_running "$repo" "$branch"
    _agent_pick "$name"
    _container_compose exec devcontainer "$CLAUDE_WRAPPER" rm "$AGENT_ID"
    echo "removed: $AGENT_NAME ($AGENT_ID) from $CT_PN"
}

cmd_agent_list() {
    _require_jq
    local repo="${1:-}" branch="${2:-}"
    local targets=()
    if [[ -n "$repo" && -n "$branch" ]]; then
        targets+=("$repo"$'\t'"$branch")
    else
        local r b pn
        while IFS=$'\t' read -r r b; do
            pn="$(_compose_project_name "$r" "$b")"
            if docker ps --filter "label=com.docker.compose.project=$pn" --filter "status=running" -q | grep -q .; then
                targets+=("$r"$'\t'"$b")
            fi
        done < <(_iter_worktrees)
    fi

    {
        printf 'REPO\tBRANCH\tNAME\tID\tSTATUS\tSTARTED\n'
        local t r b
        for t in "${targets[@]}"; do
            r="${t%%$'\t'*}"; b="${t#*$'\t'}"
            _container_resolve "$r" "$b"
            _container_write_env
            _agent_list_json | jq -r --arg repo "$r" --arg branch "$b" \
                '.[] | select(.kind=="background") | [$repo, $branch, .name, .id, .status, (.startedAt/1000 | gmtime | strftime("%Y-%m-%dT%H:%M:%SZ"))] | @tsv'
        done
    } | column -t -s $'\t'
}

cmd_agent() {
    case "${1:-}" in
        up)     shift; cmd_agent_up "$@" ;;
        attach) shift; cmd_agent_attach "$@" ;;
        rm)     shift; cmd_agent_rm "$@" ;;
        list)   shift; cmd_agent_list "$@" ;;
        *)
            echo "usage: devenv agent <up|attach|rm|list> ..."
            exit 1
            ;;
    esac
}
