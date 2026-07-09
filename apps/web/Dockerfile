# syntax=docker/dockerfile:1
# Multi-stage production image for @vaep/web. Parity only — dev runs on the host.
# Build context MUST be the repo root (platform/):
#   docker build -f apps/web/Dockerfile -t vaep-web .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --filter @vaep/web... --filter @vaep/types...
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @vaep/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
