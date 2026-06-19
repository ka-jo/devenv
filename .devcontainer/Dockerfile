# debian:trixie-slim = Debian 13 (Trixie)
FROM debian:trixie-slim

# Install base dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    zsh \
    sudo \
    unzip \
    libatomic1 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --gid 1000 ka-jo \
    && useradd --uid 1000 --gid ka-jo --shell /bin/zsh --create-home ka-jo \
    && echo "ka-jo ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/ka-jo

USER ka-jo
ENV SHELL=/bin/zsh
ENV HOME=/home/ka-jo

RUN mkdir -p /home/ka-jo/.local/bin /home/ka-jo/commandhistory /home/ka-jo/.pnpm-store
ENV PATH="/home/ka-jo/.local/bin:${PATH}"

# Install fnm
RUN curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir /home/ka-jo/.local/bin --skip-shell

# Install Oh My Zsh
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended

# Install pnpm
RUN curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=11.4.0 sh -

# Install Claude Code
RUN curl -fsSL https://claude.ai/install.sh | bash

RUN echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> /home/ka-jo/.zshrc

# Per-session egress attribution. Wrap `claude` so each launch mints a fresh token
# and embeds it as the Basic-auth username in the egress proxy URL. Every child
# process (Bash tool, curl, git, the API calls themselves) inherits the credentialed
# proxy via env, so the firewall's approver can decode the token from the
# Proxy-Authorization header and attribute the request to this session. The proxy
# host must match HTTP_PROXY in docker-compose.yml (firewall:3128). Running `claude`
# outside this function falls back to the credential-less compose proxy (anonymous).
# Attribution only — a process can forge or drop the token; not a security boundary.
RUN cat >> /home/ka-jo/.zshrc <<'ZSHRC'

claude() {
  local token proxy
  token="$(</proc/sys/kernel/random/uuid)"
  proxy="http://${token}:x@firewall:3128"
  HTTP_PROXY="$proxy" HTTPS_PROXY="$proxy" \
  http_proxy="$proxy" https_proxy="$proxy" \
    command claude "$@"
}
ZSHRC
