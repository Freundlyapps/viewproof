# ViewProof self-hosted: the same Worker under workerd (wrangler dev / Miniflare), data persisted in /data (spec D3).
FROM node:24-bookworm-slim
ENV CI=true WRANGLER_SEND_METRICS=false
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter web build
EXPOSE 8787
VOLUME /data
CMD ["sh", "/app/scripts/docker-start.sh"]
