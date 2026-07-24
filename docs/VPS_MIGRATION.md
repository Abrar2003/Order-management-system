# VPS Migration Runbook

This runbook prepares the OMS stack for a Linux VPS deployment:
- Backend: Node.js + Express + MongoDB
- Frontend: Vite build served by nginx
- Process manager: PM2
- CI/CD: GitHub Actions triggers remote deploys over SSH
- Optional OMS Assistant: Groq Responses API + a separate read-only MongoDB credential

## 1. Pre-Migration Checklist

1. Rotate all secrets currently used in local `.env` files (JWT, MongoDB, Google OAuth).
2. Confirm production domain and DNS records:
   - `ghouse-sourcing.com` -> VPS public IP
   - `oms.ghouse-sourcing.com` -> VPS public IP
   - `api.ghouse-sourcing.com` -> VPS public IP
3. Confirm MongoDB access allowlist includes VPS IP.
4. Create server user (non-root) with `sudo` access.
5. Decide which GitHub repository branch should auto-deploy, typically `main`.

## 2. Server Bootstrap (Ubuntu 22.04/24.04)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx git ufw curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
sudo apt install -y libreoffice libreoffice-calc
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

If the repository is private, clone it with an SSH URL and configure a GitHub deploy key on the VPS before continuing.

### GitHub repo access on the VPS

The deploy script runs `git fetch` and `git pull`, so the VPS must be able to read the repository without interactive prompts.

Recommended setup:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
ssh-keygen -t ed25519 -C "oms-vps-deploy" -f ~/.ssh/id_ed25519_github -N ""
cat ~/.ssh/id_ed25519_github.pub
```

Add the printed public key to GitHub as a read-only Deploy Key for this repository, then create `~/.ssh/config`:

```sshconfig
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_github
    IdentitiesOnly yes
```

Then verify access:
 
```bash
ssh -T git@github.com
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
- `GROQ_API_KEY` and `OMS_CHAT_MONGO_URI` when OMS Assistant is enabled; `OMS_CHAT_LLM_MODEL` optionally overrides the default Groq model
- Google integration keys if those features are used

OMS Assistant values are backend-only. Never add them to a client/Vite env file, never reuse `MONGO_URI` as `OMS_CHAT_MONGO_URI`, and never grant its database user write privileges. Create and test the database user before deployment using [OMS_ASSISTANT.md](OMS_ASSISTANT.md#create-the-read-only-mongodb-user).

After editing, restrict the production env file:

```bash
chmod 600 /var/www/order-management-system/backend/.env.production
```

If PIS spreadsheet uploads are enabled, make sure LibreOffice is installed on the VPS. If the executable is not on the default `PATH`, set:

```env
LIBREOFFICE_BIN=/usr/bin/soffice
```

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
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/order-management-system.conf /etc/nginx/sites-enabled/order-management-system.conf
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

## 8. GitHub Actions CI/CD Setup

This repository now includes:
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-vps.yml`

Required GitHub secrets:
- `VPS_SSH_HOST`: VPS public IP or hostname
- `VPS_SSH_PORT`: optional, defaults to `22`
- `VPS_SSH_USER`: deploy user on the VPS
- `VPS_SSH_PRIVATE_KEY`: private key used by GitHub Actions to SSH into the VPS
- `VPS_SSH_KNOWN_HOSTS`: output of `ssh-keyscan -H <host>`
- `VPS_APP_DIR`: optional, defaults to `/var/www/order-management-system`

Recommended secret creation steps:

```bash
ssh-keygen -t ed25519 -C "github-actions-oms" -f ~/.ssh/github-actions-oms -N ""
cat ~/.ssh/github-actions-oms.pub
cat ~/.ssh/github-actions-oms
ssh-keyscan -H <your-vps-host>
```

Add the public key to `~/.ssh/authorized_keys` for the VPS deploy user.
Store the private key as `VPS_SSH_PRIVATE_KEY`.
Store the `ssh-keyscan` output as `VPS_SSH_KNOWN_HOSTS`.

How the workflows behave:
- `CI` runs backend env validation and frontend build on pushes and pull requests.
- `Deploy VPS` runs on push to `main` and on manual dispatch.
- The deploy workflow SSHes into the VPS and runs `deploy/scripts/deploy_vps.sh`.
- nginx reload is off by default for automated deploys and can be enabled in manual dispatch when config changes.

If you enable nginx validation or reload from GitHub Actions, the deploy user must be able to run these without an interactive password prompt:
- `sudo nginx -t`
- `sudo systemctl reload nginx`

## 9. Health Checks

```bash
curl -I https://oms.ghouse-sourcing.com
curl https://api.ghouse-sourcing.com/healthz
pm2 status
pm2 logs oms-backend --lines 100
```

Expected `/healthz` response: `200` with `{ ok: true, ... }`.

### OMS Assistant verification

Before restarting the app, independently confirm that `OMS_CHAT_MONGO_URI` can read an approved collection and receives an authorization error for an insert. The exact safe probes are in [OMS_ASSISTANT.md](OMS_ASSISTANT.md#verify-the-database-credential).

After deployment:

1. Sign in with an account whose effective permissions include `oms_assistant.view`.
2. Open `/oms-assistant` and submit an example question.
3. Confirm the answer includes safe metadata/supporting rows and does not expose an aggregation pipeline.
4. Confirm a user without the permission receives `403`.
5. Review the successful request's application audit output and verify it contains outcome metadata, not credentials or full result documents.

An authenticated API check can also target:

```text
POST https://api.ghouse-sourcing.com/api/oms-chat/ask
```

See [OMS_ASSISTANT.md](OMS_ASSISTANT.md#production-deployment-and-verification) for the request and exact deployment verification commands.

## 10. Zero-Downtime Deploy

Use the prepared deploy script:
- [deploy/scripts/deploy_vps.sh](../deploy/scripts/deploy_vps.sh)

Manual deploy from the VPS:

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
APP_DIR=/var/www/order-management-system bash deploy/scripts/deploy_vps.sh
VALIDATE_NGINX=true RELOAD_NGINX=true bash deploy/scripts/deploy_vps.sh
```

Automated deploy from GitHub Actions:
- Push to `main`, or
- Run the `Deploy VPS` workflow manually from the Actions tab

## 11. Post-Migration Operations

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
   - Rotate the Groq key and OMS Assistant database password independently
   - Re-test that the OMS Assistant database user cannot write after any MongoDB role change
4. CI/CD maintenance:
   - Rotate the GitHub Actions deploy key periodically
   - Review Actions logs after each production deploy

## 12. Rollback Plan

1. Keep previous Git tag:
   - `git checkout <previous-tag>`
2. Rebuild frontend:
   - `cd client/OMS && npm run build`
3. Restart backend:
   - `pm2 restart oms-backend --update-env`
4. Reload nginx:
   - `sudo systemctl reload nginx`
