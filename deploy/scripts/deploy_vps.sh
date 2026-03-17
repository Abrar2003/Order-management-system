#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

APP_DIR="${APP_DIR:-$DEFAULT_APP_DIR}"
GIT_BRANCH="${GIT_BRANCH:-main}"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/client/OMS"
FRONTEND_BUILD_DIR="$FRONTEND_DIR/dist"
FRONTEND_DEPLOY_DIR="${FRONTEND_DEPLOY_DIR:-$FRONTEND_BUILD_DIR}"
PM2_CONFIG="$APP_DIR/deploy/pm2/ecosystem.config.cjs"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-$BACKEND_DIR/.env.production}"
FRONTEND_ENV_FILE="${FRONTEND_ENV_FILE:-$FRONTEND_DIR/.env.production}"
BACKEND_HEALTHCHECK_URL="${BACKEND_HEALTHCHECK_URL:-http://127.0.0.1:8008/healthz}"
FRONTEND_HEALTHCHECK_URL="${FRONTEND_HEALTHCHECK_URL:-}"
VALIDATE_NGINX="${VALIDATE_NGINX:-false}"
RELOAD_NGINX="${RELOAD_NGINX:-false}"

is_truthy() {
  local value="${1:-}"
  case "${value,,}" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

run_with_optional_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
    return
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    echo "sudo is required to run: $*"
    exit 1
  fi

  sudo "$@"
}

log() {
  echo
  echo "==> $1"
}

require_path() {
  local path="$1"
  local label="$2"

  if [[ ! -e "$path" ]]; then
    echo "Missing $label: $path"
    exit 1
  fi
}

sync_frontend_build() {
  if [[ "$FRONTEND_DEPLOY_DIR" == "$FRONTEND_BUILD_DIR" ]]; then
    echo "Frontend is served directly from $FRONTEND_BUILD_DIR"
    return
  fi

  mkdir -p "$FRONTEND_DEPLOY_DIR"

  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$FRONTEND_BUILD_DIR"/ "$FRONTEND_DEPLOY_DIR"/
    return
  fi

  cp -a "$FRONTEND_BUILD_DIR"/. "$FRONTEND_DEPLOY_DIR"/
}

echo "Deploying branch '$GIT_BRANCH' from $APP_DIR"

require_path "$APP_DIR" "app directory"
require_path "$BACKEND_DIR" "backend directory"
require_path "$FRONTEND_DIR" "frontend directory"
require_path "$PM2_CONFIG" "PM2 config"
require_path "$BACKEND_ENV_FILE" "backend env file"
require_path "$FRONTEND_ENV_FILE" "frontend env file"

log "Updating repository"
cd "$APP_DIR"

mkdir -p /tmp/oms-deploy-backup
cp -f "$BACKEND_ENV_FILE" /tmp/oms-deploy-backup/backend.env.production 2>/dev/null || true
cp -f "$FRONTEND_ENV_FILE" /tmp/oms-deploy-backup/frontend.env.production 2>/dev/null || true

git fetch --all --prune
git checkout "$GIT_BRANCH"
git reset --hard "origin/$GIT_BRANCH"

cp -f /tmp/oms-deploy-backup/backend.env.production "$BACKEND_ENV_FILE" 2>/dev/null || true
cp -f /tmp/oms-deploy-backup/frontend.env.production "$FRONTEND_ENV_FILE" 2>/dev/null || true

log "Installing backend dependencies"
cd "$BACKEND_DIR"
npm ci --omit=dev
NODE_ENV=production npm run check:env

log "Installing frontend dependencies"
cd "$FRONTEND_DIR"
npm ci

log "Building frontend"
npm run build

log "Publishing frontend build"
sync_frontend_build

log "Restarting backend via PM2"
cd "$APP_DIR"
pm2 startOrRestart "$PM2_CONFIG" --update-env
pm2 save

if is_truthy "$VALIDATE_NGINX" && command -v nginx >/dev/null 2>&1; then
  log "Validating nginx config"
  run_with_optional_sudo nginx -t
fi

if is_truthy "$RELOAD_NGINX" && command -v systemctl >/dev/null 2>&1 && command -v nginx >/dev/null 2>&1; then
  log "Reloading nginx"
  run_with_optional_sudo systemctl reload nginx
fi

if command -v curl >/dev/null 2>&1; then
  log "Checking backend health"
  for i in {1..10}; do
    if curl --fail --silent --show-error "$BACKEND_HEALTHCHECK_URL" >/dev/null; then
      echo "Backend health check passed"
      break
    fi

    if [[ "$i" -eq 10 ]]; then
      echo "Backend health check failed after multiple attempts"
      exit 1
    fi

    echo "Backend not ready yet, retrying in 3 seconds..."
    sleep 3
  done

  if [[ -n "$FRONTEND_HEALTHCHECK_URL" ]]; then
    log "Checking frontend health"
    curl --fail --silent --show-error "$FRONTEND_HEALTHCHECK_URL" >/dev/null
  fi
fi

log "Deploy completed successfully"
echo "Backend:  $BACKEND_DIR"
echo "Frontend: $FRONTEND_DEPLOY_DIR"
