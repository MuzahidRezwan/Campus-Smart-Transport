# Build from the repository root: docker build -f frontend/web/Dockerfile --build-arg VITE_API_URL=https://api.example .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY backend/api/package.json backend/api/
COPY frontend/web/package.json frontend/web/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY shared shared
COPY frontend/web frontend/web
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build -w @diu/shared && npm run build -w @diu/web

FROM caddy:2-alpine
COPY devops/infra/caddy/web.Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/web/dist /srv
EXPOSE 80
