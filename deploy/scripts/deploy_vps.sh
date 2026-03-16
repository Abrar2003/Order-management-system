#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

APP_DIR="${APP_DIR:-$DEFAULT_APP_DIR}"
GIT_BRANCH="${GIT_BRANCH:-main}"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/client/OMS"
PM2_CONFIG="$APP_DIR/deploy/pm2/ecosystem.config.cjs"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-$BACKEND_DIR/.env.production}"
FRONTEND_ENV_FILE="${FRONTEND_ENV_FILE:-$FRONTEND_DIR/.env.production}"

echo "Deploying branch '$GIT_BRANCH' from $APP_DIR"

if [[ ! -f "$PM2_CONFIG" ]]; then
  echo "Missing PM2 config: $PM2_CONFIG"
  exit 1
fi

if [[ ! -f "$BACKEND_ENV_FILE" ]]; then
  echo "Missing backend env file: $BACKEND_ENV_FILE"
  exit 1
fi

if [[ ! -f "$FRONTEND_ENV_FILE" ]]; then
  echo "Missing frontend env file: $FRONTEND_ENV_FILE"
  exit 1
fi

cd "$APP_DIR"
git fetch --all --prune
git checkout "$GIT_BRANCH"
git pull --ff-only origin "$GIT_BRANCH"

echo "Installing backend dependencies..."
cd "$BACKEND_DIR"
npm ci --omit=dev
NODE_ENV=production npm run check:env

echo "Installing frontend dependencies and building..."
cd "$FRONTEND_DIR"
npm ci
npm run build

echo "Restarting backend via PM2..."
cd "$APP_DIR"
pm2 startOrRestart "$PM2_CONFIG" --update-env
pm2 save

if command -v nginx >/dev/null 2>&1; then
  echo "Validating nginx config..."
  sudo nginx -t
fi

if command -v systemctl >/dev/null 2>&1 && command -v nginx >/dev/null 2>&1; then
  echo "Reloading nginx..."
  sudo systemctl reload nginx
fi

echo "Deploy completed successfully."
