FROM mcr.microsoft.com/devcontainers/javascript-node:24

RUN corepack enable && corepack prepare pnpm@latest --activate

USER node
RUN curl -fsSL https://claude.ai/install.sh | bash
