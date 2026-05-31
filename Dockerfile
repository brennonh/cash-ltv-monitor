FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-lock.yaml* .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# ── Production image ──────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# curl for the healthcheck probe
RUN apk add --no-cache curl
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-lock.yaml* .npmrc ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/abis ./abis

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "dist/main"]
