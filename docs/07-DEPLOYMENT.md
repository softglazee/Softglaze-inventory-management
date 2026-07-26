# SoftGlaze — Deployment Guide

Two targets, same code.

---

## A. Desktop app (shop PC, Windows)

### How it works
`apps/desktop/main.cjs` (Electron) → starts the built Express server as a child
process on `localhost:4000` → opens a window at that address. To the user it's
one normal desktop program with an installer.

### Database on desktop — pick one:
1. **PostgreSQL installed on the shop PC** (recommended, identical to server):
   install Postgres for Windows once, set `DATABASE_URL` in the packaged app's
   config. Best reliability + same code path.
2. **SQLite (zero-install):** change `provider = "sqlite"` and
   `DATABASE_URL="file:./softglaze.db"` in schema/env, re-run
   `prisma migrate dev`. Note: Prisma's `@db.Decimal` annotations are Postgres-only —
   remove them for SQLite (values still stored fine; we keep 2/3-dp rounding in code).
   Good for single-PC shops; we'll decide together in Phase 7.

### Build steps (Phase 7)
```bash
# 1. Build everything
npm run build              # builds web (static) + server (dist/)

# 2. Package
cd apps/desktop
npm run dist               # electron-builder → release/SoftGlaze-Setup-x.x.x.exe
```
Details we'll wire in Phase 7: bundling Node runtime, copying prisma engines,
uploads folder location (`%APPDATA%/SoftGlaze/uploads`), tray icon, auto-start,
and printing to the thermal printer (80mm) via the OS print dialog silently.

### Backups on desktop
Daily scheduled task runs `pg_dump` (or copies the SQLite file) to a `Backups/`
folder + optional Google Drive folder sync. One-click backup also exists in Settings.

---

## B. Server / browser app (VPS — "SaaS mode")

### Recommended box
Any 2GB RAM Ubuntu 22.04/24.04 VPS (Hetzner/DigitalOcean/Contabo, ~$5–7/mo).

### One-time setup
```bash
# 1. System
apt update && apt upgrade -y
apt install -y nginx postgresql ufw
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
npm i -g pm2

# 2. Database
sudo -u postgres psql -c "CREATE USER softglaze WITH PASSWORD 'STRONG_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE softglaze OWNER softglaze;"

# 3. App
cd /var/www && git clone <your-repo> softglaze && cd softglaze
npm install
cp apps/server/.env.example apps/server/.env   # edit: DATABASE_URL, strong JWT secrets
npm run build
cd apps/server && npx prisma migrate deploy && npx prisma db seed

# 4. Run API under PM2
pm2 start dist/index.js --name softglaze-api
pm2 save && pm2 startup

# 5. Firewall
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
```

### Nginx (serves the built web app + proxies /api)
```nginx
server {
    server_name stock.yourshop.com;
    root /var/www/softglaze/apps/web/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /uploads/ {
        proxy_pass http://127.0.0.1:4000;
    }
    location / {
        try_files $uri /index.html;   # SPA routing
    }
    client_max_body_size 20m;         # product images
}
```

### HTTPS
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d stock.yourshop.com   # auto-renews
```

### Automatic daily backups (3 AM)
```bash
crontab -e
0 3 * * * pg_dump -U softglaze softglaze | gzip > /var/backups/softglaze-$(date +\%F).sql.gz
0 4 * * 0 find /var/backups -name "softglaze-*.gz" -mtime +30 -delete
```

### Updating the live app
```bash
cd /var/www/softglaze && git pull && npm install && npm run build
cd apps/server && npx prisma migrate deploy
pm2 restart softglaze-api
```

---

## C. Future SaaS (selling to other shops)
The schema is single-tenant on purpose (simpler, safer for v1). When you're ready
to sell it: add `shopId` to every table + a `Shop` table, scope every query by the
authenticated user's shop, add a signup/billing flow. We planned the code so this
is a mechanical change, not a rewrite. Park it until your own shop runs on v1.
