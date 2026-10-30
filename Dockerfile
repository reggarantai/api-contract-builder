# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:24-trixie-slim

# ---- base: Node + pnpm (version taken from package.json "packageManager") ----
# Runs on the build machine's platform: nothing installed here is compiled,
# so building for another platform needs no emulation.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS base
WORKDIR /app
COPY package.json ./
RUN npm install --global "$(node -p 'require("./package.json").packageManager')"

# ---- build: install all dependencies and build client + server ----
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- prod-deps: server runtime dependencies only ----
# better-sqlite3 ships a prebuilt binary for every platform plus its C
# sources. Keep only the binary for the target platform (Debian, so glibc).
FROM base AS prod-deps
ARG TARGETARCH
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod
RUN arch="$([ "$TARGETARCH" = amd64 ] && echo x64 || echo "$TARGETARCH")" \
 && cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 \
 && test -f "prebuilds/linux-${arch}.node" \
 && find prebuilds -type f ! -name "linux-${arch}.node" -delete \
 && rm -rf deps src binding.gyp

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.title="API Contract Builder" \
      org.opencontainers.image.description="Write API contracts page by page and export them to OpenAPI 3.1 and Markdown." \
      org.opencontainers.image.source="https://github.com/reggarantai/api-contract-builder" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY samples ./samples
COPY package.json ./

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "dist/server/index.js"]
