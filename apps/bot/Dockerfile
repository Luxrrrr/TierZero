# Built from the repository root, because the bot is one package in a pnpm
# workspace and cannot be installed without the others.
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app

# Prisma's query engine links against libssl and picks its binary at generate
# time from whatever it detects here. Without this the slim image resolves to
# an OpenSSL 1.1 engine that Debian bookworm does not ship, and the client
# fails to load at startup rather than at build time.
RUN apt-get update   && apt-get install -y --no-install-recommends openssl ca-certificates   && rm -rf /var/lib/apt/lists/*

# The registry times out often enough on a home connection to fail an install
# that would otherwise succeed, and the default of two retries is not enough
# to ride it out.
ENV npm_config_fetch_retries=5
ENV npm_config_fetch_retry_maxtimeout=120000
ENV npm_config_fetch_timeout=600000
ENV npm_config_store_dir=/pnpm/store

COPY . .
# A cached store means a retry after a network failure resumes rather than
# downloading everything again.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @tier0/db exec prisma generate
RUN pnpm --filter "@tier0/bot..." build

FROM node:20-slim AS runtime
RUN corepack enable
WORKDIR /app

RUN apt-get update   && apt-get install -y --no-install-recommends openssl ca-certificates   && rm -rf /var/lib/apt/lists/*
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
