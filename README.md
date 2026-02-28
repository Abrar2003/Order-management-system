# Order Management System

## Project Structure

- `backend/` Express API + MongoDB integration
- `client/OMS/` React + Vite frontend
- `deploy/` VPS deployment assets (PM2, nginx, deploy script)
- `docs/` operational documentation

## Local Development

### Backend

```bash
cd backend
npm install
npm run dev
```

Environment files:
- `backend/.env.development` for local development
- `backend/.env.testing` for testing

How backend env loading works:
- If `NODE_ENV` is set, it loads files in this order (later overrides earlier):
- `.env`
- `.env.local` (skipped for testing env)
- `.env.<NODE_ENV>`
- `.env.<NODE_ENV>.local`
- If `NODE_ENV` is not set, only `.env` and `.env.local` are loaded.

Examples:

PowerShell (Windows):
```powershell
cd backend
$env:NODE_ENV='development'; npm run dev
$env:NODE_ENV='testing'; npm run dev
```

Bash (Linux/macOS):
```bash
cd backend
NODE_ENV=development npm run dev
NODE_ENV=testing npm run dev
```

Optional local override (recommended):
- Create `backend/.env.development.local` for machine-specific secrets.
- Create `backend/.env.testing.local` for test-only overrides.
- These local override files are ignored by git.

### Frontend

```bash
cd client/OMS
npm install
npm run dev
```

## Production / VPS

Follow:
- [VPS_MIGRATION.md](docs/VPS_MIGRATION.md)

Deployment assets:
- [PM2 config](deploy/pm2/ecosystem.config.cjs)
- [nginx config](deploy/nginx/order-management-system.conf)
- [deploy script](deploy/scripts/deploy_vps.sh)
