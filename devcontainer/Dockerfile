# git 2.48.0 isn't in trixie's apt repos; built from source in an isolated
# stage (see build-git.sh) so its build deps don't land in the final image.
FROM debian:trixie-slim AS git-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ca-certificates \
    libssl-dev \
    libcurl4-openssl-dev \
    zlib1g-dev \
    libexpat1-dev \
    gettext \
    autoconf \
    pkg-config \
    cargo \
    rustc \
    && rm -rf /var/lib/apt/lists/*
COPY build-git.sh /tmp/build-git.sh
RUN /tmp/build-git.sh --prefix /usr/local/git

# debian:trixie-slim = Debian 13 (Trixie)
FROM debian:trixie-slim

# Install base dependencies (git's runtime libs, not its build deps)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    libcurl4 \
    zlib1g \
    zsh \
    sudo \
    unzip \
    libatomic1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=git-builder /usr/local/git /usr/local/git
ENV PATH="/usr/local/git/bin:${PATH}"

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

RUN echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> /home/ka-jo/.zshrc \
 && echo "alias claude='/home/ka-jo/devenv/bin/claude-wrapper'" >> /home/ka-jo/.zshrc

# Dangling until the ${HOME}/devenv bind mount populates the target at runtime.
RUN ln -sf /home/ka-jo/devenv/bin/devenv /home/ka-jo/.local/bin/devenv

COPY --chown=ka-jo:ka-jo --chmod=755 entrypoint.sh /home/ka-jo/entrypoint.sh

ENTRYPOINT ["/home/ka-jo/entrypoint.sh"]
