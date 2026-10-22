# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ARG NGINX_IMAGE=nginx:stable-alpine@sha256:985220252f3863977e468f611ef118ebd01421289dd86ee1ae99cb068c3bce2b

FROM ${NODE_IMAGE} AS backend-dependencies
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM backend-dependencies AS backend-build
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY backend/ ./
RUN npm run prisma:generate && npm run build && test -f dist/src/main.js

FROM backend-dependencies AS backend-production-dependencies
RUN npm prune --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS backend-production
ENV NODE_ENV=production PORT=3000 WORKSPACE_ROOT=/app/.workspace-data
WORKDIR /app
COPY --from=backend-production-dependencies /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=backend-build /app/package.json ./package.json
RUN mkdir -p /app/.workspace-data && chown node:node /app/.workspace-data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health', {signal: AbortSignal.timeout(4000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/src/main.js"]

FROM ${NODE_IMAGE} AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build -- --configuration production && test -f dist/frontend/browser/index.html

FROM ${NGINX_IMAGE} AS frontend-production
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-build /app/dist/frontend/browser/ /usr/share/nginx/html/
RUN nginx -t
USER nginx
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
