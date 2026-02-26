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
