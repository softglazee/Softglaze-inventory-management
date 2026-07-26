# SoftGlaze — VPS deployment runbook (Phase 8)

Turn the browser app on for you and your staff, reachable from any phone/PC, with
HTTPS and automatic daily backups. One clean session with your developer (me) —
you provide the VPS + domain, we run these steps together.

> The **desktop app** (single shop PC) needs none of this — see `apps/desktop/README.md`.

## What you need first
1. A small **Ubuntu 22.04/24.04 VPS** (2 GB RAM is plenty — Hetzner/DigitalOcean/Contabo, ~$5–7/mo) and its SSH login.
2. A **domain or sub-domain** (e.g. `stock.yourshop.com`) with an A-record pointing at the VPS IP.
3. The repo pushed to GitHub (already done).

## Step 1 — one-time system setup (as root)
```bash
apt update && apt upgrade -y
apt install -y nginx postgresql ufw git
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
npm i -g pm2
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
```

## Step 2 — database
```bash
sudo -u postgres psql -c "CREATE USER softglaze WITH PASSWORD 'STRONG_DB_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE softglaze OWNER softglaze;"
```

## Step 3 — app
```bash
mkdir -p /var/www && cd /var/www
git clone <YOUR_REPO_URL> softglaze && cd softglaze
bash deploy/deploy.sh          # first run stops so you can edit apps/server/.env, then run it again
```
Edit `apps/server/.env` when prompted (from `deploy/env.production.example`): real
`DATABASE_URL` password, two `openssl rand -hex 32` JWT secrets, and
`CORS_ORIGIN=https://stock.yourshop.com`. Re-run `bash deploy/deploy.sh`.

## Step 4 — nginx
```bash
sudo cp deploy/nginx-softglaze.conf /etc/nginx/sites-available/softglaze
sudo sed -i 's/stock.YOURSHOP.com/stock.yourshop.com/' /etc/nginx/sites-available/softglaze
sudo ln -s /etc/nginx/sites-available/softglaze /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## Step 5 — HTTPS (free, auto-renews)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d stock.yourshop.com
```

## Step 6 — daily backup at 3 AM
```bash
( crontab -l 2>/dev/null; echo "0 3 * * * cd /var/www/softglaze && bash deploy/backup.sh >> /var/log/softglaze-backup.log 2>&1" ) | crontab -
```

## First launch
Open `https://stock.yourshop.com`, register the **owner** account (the first account
becomes SUPER_ADMIN; registration then closes), pick your Business Type, and you're live.

## Updating later
```bash
cd /var/www/softglaze && bash deploy/update.sh   # pulls, builds, migrates, backs up first, restarts
```

## Files in this folder
- `deploy.sh` — first-time deploy · `update.sh` — safe update · `backup.sh` — pg_dump backup + prune
- `ecosystem.config.cjs` — PM2 process · `nginx-softglaze.conf` — nginx site · `env.production.example` — env template
