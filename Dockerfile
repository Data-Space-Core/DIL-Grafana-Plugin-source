# Build-only container. The default target exports a plugin, not a Grafana server.
FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json webpack.config.js ./
COPY src ./src
COPY app/src ./app/src
COPY app/README.md ./app/README.md
COPY README.md ./
COPY docs ./docs
RUN npm run typecheck && npm run build

FROM golang:1.25-bookworm AS backend
WORKDIR /build
COPY go.* ./
RUN go mod download
COPY pkg ./pkg
COPY scripts/build-backend.sh ./scripts/build-backend.sh
COPY app/pkg ./app/pkg
RUN --mount=type=cache,target=/root/.cache/go-build go test -mod=readonly ./pkg/... ./app/pkg/...
RUN --mount=type=cache,target=/root/.cache/go-build sh scripts/build-backend.sh /out

FROM python:3.12-slim AS package
WORKDIR /build
COPY --from=frontend /build/dist ./dist
COPY --from=backend /out ./dist
COPY package.json ./
COPY scripts/package-plugin.py scripts/test_package.py ./scripts/
RUN python -m unittest discover -s scripts -p 'test_*.py' && python scripts/package-plugin.py

FROM scratch AS artifact
COPY --from=package /build/artifacts /
