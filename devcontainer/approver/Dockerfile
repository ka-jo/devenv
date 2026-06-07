FROM node:22-slim

WORKDIR /app
COPY package.json ./
COPY server.js ./

# No dependencies — server uses only Node built-ins.

EXPOSE 3129

USER node
CMD ["node", "server.js"]
