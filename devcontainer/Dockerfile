FROM ubuntu:26.04

# ubuntu:26.04 ships a `ubuntu` user at UID/GID 1000. ka-jo needs that UID to
# match the host user that owns the bind mounts, and every devenv path assumes
# /home/ka-jo.
RUN userdel -r ubuntu

# zsh is installed here rather than left to common-utils so /etc/zsh/zshrc
# exists (as the package's own conffile) before devenv.zsh is wired into it.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    zsh \
    libatomic1 \
    && rm -rf /var/lib/apt/lists/*

# common-utils (devcontainer.json) adopts this user for zsh/oh-my-zsh/sudo; it
# has to exist already so Claude Code can be installed into its home below.
RUN groupadd --gid 1000 ka-jo \
    && useradd --uid 1000 --gid ka-jo --shell /bin/zsh --create-home ka-jo

# Not ~/.zshrc: common-utils overwrites it with the oh-my-zsh template.
COPY devenv.zsh /etc/zsh/devenv.zsh
RUN echo 'source /etc/zsh/devenv.zsh' >> /etc/zsh/zshrc

USER ka-jo
ENV SHELL=/bin/zsh
ENV HOME=/home/ka-jo

RUN mkdir -p /home/ka-jo/.local/bin /home/ka-jo/commandhistory /home/ka-jo/.pnpm-store
ENV PATH="/home/ka-jo/.local/bin:${PATH}"

# Install Claude Code
RUN curl -fsSL https://claude.ai/install.sh | bash

# Dangling until the ${HOME}/devenv bind mount populates the target at runtime.
RUN ln -sf /home/ka-jo/devenv/bin/devenv /home/ka-jo/.local/bin/devenv

COPY --chown=ka-jo:ka-jo --chmod=755 entrypoint.sh /home/ka-jo/entrypoint.sh

ENTRYPOINT ["/home/ka-jo/entrypoint.sh"]
