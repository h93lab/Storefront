# syntax=docker/dockerfile:1.7
# One Dockerfile, two runtime targets:
#   web     – Next.js standalone server (UI)
#   service – worker and MCP server (TypeScript run with tsx)

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/mcp/package.json apps/mcp/
COPY packages/core/package.json packages/core/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS source
COPY . .

FROM source AS web-build
RUN pnpm --filter @lens/web build

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 MEDIA_DIR=/data/media
WORKDIR /app
RUN mkdir -p /data/media
COPY --from=web-build /app/apps/web/.next/standalone ./
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

FROM source AS service
ENV NODE_ENV=production MEDIA_DIR=/data/media MIGRATIONS_DIR=/app/db/migrations FONTCONFIG_FILE=/etc/fonts/lens.conf
# A font lets `pnpm seed` draw text into its demo screenshots (Geist ships with the web app's dependencies).
RUN mkdir -p /data/media /usr/share/fonts/geist /etc/fonts \
  && find /app/node_modules/.pnpm -path "*geist/dist/fonts/geist-sans/Geist-*.ttf" -exec cp {} /usr/share/fonts/geist/ \; \
  && cp /app/docker/fonts.conf /etc/fonts/lens.conf
# docker-compose.yml sets working_dir to apps/worker or apps/mcp
WORKDIR /app/apps/worker
CMD ["node_modules/.bin/tsx", "src/index.ts"]
