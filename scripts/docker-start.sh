#!/bin/sh
# Container entrypoint: apply database migrations, start the hourly job, run the Worker.
set -eu
cd /app/apps/api
APP_URL="${APP_URL:-http://localhost:8787}"
if [ ! -s .dev.vars ]; then
  echo "apps/api/.dev.vars is missing or empty. Copy .dev.vars.example, fill it in and mount it (see README → Self-hosting)." >&2
  exit 1
fi
# Idempotent: only migrations not yet applied run.
npx wrangler d1 migrations apply viewproof --local --persist-to /data
node /app/scripts/docker-cron.mjs &
exec npx wrangler dev --ip 0.0.0.0 --port 8787 --persist-to /data --test-scheduled \
  --var SELF_HOSTED:true --var "APP_URL:$APP_URL"
