# VPS Migration Runbook

This runbook prepares the OMS stack for a Linux VPS deployment:
- Backend: Node.js + Express + MongoDB
- Frontend: Vite build served by nginx
- Process manager: PM2

## 1. Pre-Migration Checklist

1. Rotate all secrets currently used in local `.env` files (JWT, MongoDB, Google OAuth).
2. Confirm production domain and DNS records:
   - `ghouse-sourcing.com` -> VPS public IP
   - `oms.ghouse-sourcing.com` -> VPS public IP
   - `api.ghouse-sourcing.com` -> VPS public IP
3. Confirm MongoDB access allowlist includes VPS IP.
4. Create server user (non-root) with `sudo` access.

## 2. Server Bootstrap (Ubuntu 22.04/24.04)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx git ufw curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

Optional firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## 3. App Setup

```bash
sudo mkdir -p /var/www
sudo chown -R $USER:$USER /var/www
cd /var/www
git clone <your-repo-url> order-management-system
cd order-management-system
```

### Backend env

```bash
cd /var/www/order-management-system/backend
cp .env.example .env.production
nano .env.production
```

Set real values for:
- `MONGO_URI`
- `JWT_SECRET`
- `CORS_ORIGIN`
- Google integration keys if those features are used

### Frontend env

```bash
cd /var/www/order-management-system/client/OMS
cp .env.example .env.production
nano .env.production
```

Recommended value:

```env
VITE_API_BASE_URL=https://api.ghouse-sourcing.com
```

## 4. Install + Build

```bash
cd /var/www/order-management-system/backend
npm ci --omit=dev
NODE_ENV=production npm run check:env

cd /var/www/order-management-system/client/OMS
npm ci
npm run build
```

## 5. PM2 Setup (Backend)

Use the prepared ecosystem file:
- [deploy/pm2/ecosystem.config.cjs](../deploy/pm2/ecosystem.config.cjs)

```bash
cd /var/www/order-management-system
pm2 start deploy/pm2/ecosystem.config.cjs
pm2 save
pm2 startup
```

Follow the command PM2 prints for enabling startup on boot.

## 6. nginx Setup (Frontend + API Domain)

Use the prepared nginx config:
- [deploy/nginx/order-management-system.conf](../deploy/nginx/order-management-system.conf)

```bash
sudo cp /var/www/order-management-system/deploy/nginx/order-management-system.conf /etc/nginx/sites-available/order-management-system.conf
sudo ln -s /etc/nginx/sites-available/order-management-system.conf /etc/nginx/sites-enabled/order-management-system.conf
sudo nginx -t
sudo systemctl reload nginx
```

If you cloned the repo somewhere other than `/var/www/order-management-system`, update the `root` path too.

## 7. HTTPS (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ghouse-sourcing.com -d oms.ghouse-sourcing.com -d api.ghouse-sourcing.com
```

Verify auto-renew:

```bash
sudo certbot renew --dry-run
```

## 8. Health Checks

```bash
curl -I https://oms.ghouse-sourcing.com
curl https://api.ghouse-sourcing.com/healthz
pm2 status
pm2 logs oms-backend --lines 100
```

Expected `/healthz` response: `200` with `{ ok: true, ... }`.

## 9. Zero-Downtime Deploy

Use the prepared deploy script:
- [deploy/scripts/deploy_vps.sh](../deploy/scripts/deploy_vps.sh)

```bash
cd /var/www/order-management-system
chmod +x deploy/scripts/deploy_vps.sh
bash deploy/scripts/deploy_vps.sh
```

The deploy script expects:
- `backend/.env.production`
- `client/OMS/.env.production`

Optional overrides:

```bash
GIT_BRANCH=main bash deploy/scripts/deploy_vps.sh
APP_DIR=/var/www/Order-management-system bash deploy/scripts/deploy_vps.sh
```

## 10. Post-Migration Operations

1. Backup plan:
   - MongoDB backups (Atlas snapshots or scheduled dumps)
   - Versioned deployment artifacts/tags
2. Monitoring:
   - PM2 process health
   - nginx error/access logs
   - Disk usage alerts
3. Security:
   - Disable password auth, use SSH keys
   - Keep OS packages updated
   - Rotate JWT/Google secrets periodically

## 11. Rollback Plan

1. Keep previous Git tag:
   - `git checkout <previous-tag>`
2. Rebuild frontend:
   - `cd client/OMS && npm run build`
3. Restart backend:
   - `pm2 restart oms-backend --update-env`
4. Reload nginx:
   - `sudo systemctl reload nginx`
