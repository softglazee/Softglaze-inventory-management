#!/usr/bin/env bash
# Update the live SoftGlaze app to the latest committed code.
#   cd /var/www/softglaze && bash deploy/update.sh
set -euo pipefail

APP_DIR="/var/www/softglaze"
cd "$APP_DIR"

echo "==> Backup DB first (safety)"
bash deploy/backup.sh || echo "(backup step skipped)"

echo "==> Pull latest"
git pull

echo "==> Install + build"
npm install
npm run build

echo "==> Apply any new migrations"
cd apps/server && npx prisma migrate deploy && cd "$APP_DIR"

echo "==> Restart API"
pm2 restart softglaze-api

echo "Done. Hard-refresh the browser (Ctrl+F5) to pick up the new web build."
