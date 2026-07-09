# syntax=docker/dockerfile:1
# Multi-stage production image for @vaep/api. Parity only — dev runs on the host.
# Build context MUST be the repo root (platform/):
#   docker build -f apps/api/Dockerfile -t vaep-api .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --filter @vaep/api... --filter @vaep/types...
RUN pnpm --filter @vaep/api exec prisma generate
RUN pnpm --filter @vaep/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node", "dist/main.js"]
