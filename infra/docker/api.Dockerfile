# BidClean API — Production Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY services/api/package*.json ./services/api/
COPY packages/shared/package*.json ./packages/shared/
COPY package*.json ./

RUN npm ci --workspace=services/api --workspace=packages/shared

COPY packages/shared/ ./packages/shared/
COPY services/api/ ./services/api/

RUN npm run build --workspace=services/api

FROM node:20-alpine AS runner

WORKDIR /app
COPY --from=builder /app/services/api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/main"]
