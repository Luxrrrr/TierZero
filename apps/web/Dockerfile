# Built from the repository root, because the dashboard is one package in a
# pnpm workspace and cannot be installed without the others.
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tier0/db exec prisma generate
RUN pnpm --filter "@tier0/web..." build

FROM node:20-slim AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

RUN mkdir -p /data && chown -R node:node /data
USER node

# The dashboard owns migrations, so it applies any outstanding ones before it
# starts serving. Running this in both images would race them against each
# other on first boot.
CMD ["sh", "-c", "pnpm --filter @tier0/db migrate && pnpm --filter @tier0/web start"]
