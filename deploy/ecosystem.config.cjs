/**
 * PM2 process config for the SoftGlaze API on a VPS.
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup   (so it restarts on reboot)
 *
 * The API reads its secrets from apps/server/.env (copied from deploy/env.production.example).
 * Nginx serves apps/web/dist and proxies /api + /uploads to this process (see nginx-softglaze.conf).
 */
module.exports = {
  apps: [
    {
      name: "softglaze-api",
      cwd: "./apps/server",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production" },
      max_memory_restart: "400M",
      autorestart: true,
      // dotenv in the server loads apps/server/.env; nothing sensitive lives here.
    },
  ],
};
