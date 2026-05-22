FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN pnpm install --frozen-lockfile

COPY server ./server
COPY web ./web

RUN pnpm -C web build
# Prisma generate doesn't actually need the DB to exist, but it requires the
# env var be present syntactically. Provide a throwaway value at build time.
RUN DATABASE_URL="mysql://x:x@localhost:3306/x" pnpm -C server exec prisma generate
RUN pnpm -C server build

# Prune dev deps for the runtime image
RUN pnpm -C server install --prod --frozen-lockfile

# ----------------------------------------------------------------------------

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/server/prisma ./server/prisma
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./

EXPOSE 3000
CMD ["node", "server/dist/index.js"]
