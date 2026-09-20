# Multi-stage production build for MEP Management Platform
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production runtime container
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV MEP_DB_PATH=/data/mep_pm.db

# Persistent storage directory for SQLite database
RUN mkdir -p /data && chown -R node:node /data

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

USER node
EXPOSE 3000

VOLUME ["/data"]

CMD ["node", "dist/server.cjs"]
