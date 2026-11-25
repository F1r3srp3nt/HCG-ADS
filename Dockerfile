# HCG ADS server + command center. Builds an image; it does NOT deploy anything.
# docker build -t hcg-ads:0.2.0 .
FROM node:22.21-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --no-audit --no-fund && npm run build

FROM node:22.21-bookworm-slim
# ffmpeg: video probing, thumbnails, optimisation, transcoding. Optional: without it the server falls back to its
# own inspection and says so (Ecosystem page). Build with --build-arg WITH_FFMPEG=0 where apt is unreachable.
ARG WITH_FFMPEG=1
RUN if [ "$WITH_FFMPEG" = "1" ]; then apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*; fi
WORKDIR /app
COPY --from=build /app /app
COPY config/hcg-news.json ./config/hcg-news.json
# Runs as an unprivileged user; all state lives on the /data volume.
RUN useradd --system --uid 10001 hcgads && mkdir -p /data && chown hcgads /data
USER hcgads
ENV HCG_ADS_ENV=production HCG_ADS_HOST=0.0.0.0 HCG_ADS_PORT=7800 HCG_ADS_DATA_DIR=/data HCG_ADS_LIVE_DELIVERY=off NODE_USE_ENV_PROXY=0
EXPOSE 7800
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:7800/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
