# Build from the repository root: docker build -f backend/api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY backend/api/package.json backend/api/
COPY frontend/web/package.json frontend/web/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY shared shared
COPY backend/api backend/api
RUN npm run build -w @diu/shared && npm run build -w @diu/api \
 && npm prune --omit=dev --ignore-scripts

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared/package.json shared/package.json
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/backend/api/package.json backend/api/package.json
COPY --from=build /app/backend/api/dist backend/api/dist
COPY --from=build /app/backend/api/drizzle backend/api/drizzle
WORKDIR /app/backend/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
# The jobs container runs the same image with: node dist/jobs/worker.js
CMD ["node", "dist/server.js"]
