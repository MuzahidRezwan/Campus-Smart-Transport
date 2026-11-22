# Public demo: web + API + ML + sample data in ONE container, on one port.
# Not for production (mock sign-in and payments, data resets on restart);
# production uses docker-compose.yml. Build from the repository root:
#   docker build -f devops/deploy/demo/Dockerfile -t diu-transport-demo .
#   docker run -p 7860:7860 diu-transport-demo        # then open http://localhost:7860
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ML service with a model trained on synthetic data
COPY backend/ml/requirements.txt backend/ml/requirements.txt
RUN python3 -m venv /opt/ml && /opt/ml/bin/pip install --no-cache-dir -r backend/ml/requirements.txt
COPY backend/ml backend/ml
RUN cd backend/ml && MODEL_DIR=/app/ml-models /opt/ml/bin/python -m app.train --synthetic > /dev/null

# API and web, built once; the web talks to the API at /api on the same origin
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY backend/api/package.json backend/api/
COPY frontend/web/package.json frontend/web/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY shared shared
COPY backend/api backend/api
COPY frontend/web frontend/web
RUN npm run build -w @diu/shared \
 && npm run build -w @diu/api \
 && VITE_API_URL=/api npm run build -w @diu/web \
 && npm prune --omit=dev --ignore-scripts

COPY devops/deploy/demo devops/deploy/demo

# Hugging Face Spaces run containers as UID 1000, which is "node" in this image.
USER node
ENV PORT=7860
EXPOSE 7860
CMD ["sh", "devops/deploy/demo/start.sh"]
