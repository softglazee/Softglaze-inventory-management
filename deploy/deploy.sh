#!/usr/bin/env bash
# First-time deploy of SoftGlaze on a fresh Ubuntu 22.04/24.04 VPS.
# Run as a sudo-capable user from an EMPTY /var/www/softglaze after cloning the repo there.
# Prereqs already installed: nginx, postgresql, node 20+, pm2 (see deploy/README.md step 1).
set -euo pipefail

APP_DIR="/var/www/softglaze"
UPLOAD_DIR="/var/www/softglaze-uploads"

cd "$APP_DIR"

echo "==> 1/6  Install dependencies"
npm install

echo "==> 2/6  Server env"
if [ ! -f apps/server/.env ]; then
  cp deploy/env.production.example apps/server/.env
  echo "!! Edit apps/server/.env now (DATABASE_URL + the two JWT secrets + CORS_ORIGIN), then re-run."
  echo "   Generate secrets with:  openssl rand -hex 32"
  exit 1
fi

echo "==> 3/6  Uploads folder"
mkdir -p "$UPLOAD_DIR"

echo "==> 4/6  Build web + server"
npm run build

echo "==> 5/6  Database migrate + seed"
cd apps/server
npx prisma migrate deploy
npx prisma db seed || echo "(seed already applied — continuing)"
cd "$APP_DIR"

echo "==> 6/6  Start under PM2"
pm2 start deploy/ecosystem.config.cjs
pm2 save

echo
echo "API is live on 127.0.0.1:4000."
echo "Next: install the nginx site + HTTPS (deploy/README.md step 4-5), then open the site and register the owner account."
