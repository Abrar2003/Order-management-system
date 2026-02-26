#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/order-management-system}"
GIT_BRANCH="${GIT_BRANCH:-main}"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/client/OMS"
PM2_CONFIG="$APP_DIR/deploy/pm2/ecosystem.config.cjs"

echo "Deploying branch '$GIT_BRANCH' from $APP_DIR"

cd "$APP_DIR"
git fetch --all --prune
git checkout "$GIT_BRANCH"
git pull --ff-only origin "$GIT_BRANCH"

echo "Installing backend dependencies..."
cd "$BACKEND_DIR"
npm ci --omit=dev
npm run check:env

echo "Installing frontend dependencies and building..."
cd "$FRONTEND_DIR"
npm ci
npm run build

echo "Restarting backend via PM2..."
cd "$APP_DIR"
pm2 startOrRestart "$PM2_CONFIG" --update-env
pm2 save

if command -v systemctl >/dev/null 2>&1; then
  echo "Reloading nginx..."
  sudo systemctl reload nginx
fi

echo "Deploy completed successfully."
