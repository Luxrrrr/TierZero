# Built from the repository root, because the bot is one package in a pnpm
# workspace and cannot be installed without the others.
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tier0/db exec prisma generate
RUN pnpm --filter "@tier0/bot..." build

FROM node:20-slim AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

# Owned by the runtime user, because Next writes into .next at run time and
# Prisma writes its journal beside the database.
COPY --from=build --chown=node:node /app /app

# The database lives on a mounted directory so a backup is a file copy. It has
# to be writable by the same uid the process runs as, which is why the image
# creates it rather than leaving Docker to do it as root.
RUN mkdir -p /data && chown -R node:node /data
USER node

CMD ["node", "apps/bot/dist/index.js"]
