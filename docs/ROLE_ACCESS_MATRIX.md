# Role Access Matrix

Generated on: 2026-02-26

## 1) Defined roles

| Role | Source |
|---|---|
| `admin`, `manager`, `QC`, `dev`, `user` | `backend/models/user.model.js` |

## 2) Authorization behavior

| Layer | Rule | Source |
|---|---|---|
| Backend middleware | Access allowed when normalized (case-insensitive) `req.user.role` is in `authorize(...)` list | `backend/middlewares/authorize.middleware.js` |
| Frontend token decode | UI visibility is based on decoded JWT `role` | `client/OMS/src/auth/auth.service.js`, `client/OMS/src/auth/auth.utils.js` |

## 3) Backend API role matrix

### Orders routes (`backend/routers/orders.routes.js`)

| Endpoint | Method | Allowed roles |
|---|---|---|
| `/orders/upload-orders` | `POST` | `admin`, `manager`, `dev` |
| `/orders/manual-orders` | `POST` | `admin`, `manager`, `dev` |
| `/orders/upload-logs` | `GET` | `admin`, `manager`, `dev` |
| `/orders` | `GET` | `admin`, `manager`, `QC`, `dev` |
| `/orders/brands-and-vendors` | `GET` | Any authenticated user |
| `/orders/brand/:brand/vendor/:vendor/status/:status` | `GET` | Any authenticated user |
| `/orders/filters` | `GET` | Any authenticated user |
| `/orders/export` | `GET` | Any authenticated user |
| `/orders/shipments/export` | `GET` | `admin`, `manager`, `QC`, `dev` |
| `/orders/shipments` | `GET` | `admin`, `manager`, `QC`, `dev` |
| `/orders/edit-order/:id` | `PATCH` | Route: `admin`, `manager` (controller adds admin-only restrictions for qty/shipment edits) |
| `/orders/archive-order/:id` | `PATCH` | `admin` |
| `/orders/archived` | `GET` | `admin` |
| `/orders/sync-zero-quantity-archive` | `POST` | `admin` |
| `/orders/finalize-order/:id` | `PATCH` | `admin`, `manager`, `dev` |
| `/orders/today-etd-orders` | `GET` | Any authenticated user |
| `/orders/:brand/vendor-summary` | `GET` | Any authenticated user |
| `/orders/:brand/today-etd-orders` | `GET` | Any authenticated user |
| `/orders/order-by-id/:id` | `GET` | Any authenticated user |
| `/orders/re-sync` | `POST` | `admin`, `manager`, `dev` |

### QC routes (`backend/routers/qc.routes.js`)

| Endpoint | Method | Allowed roles |
|---|---|---|
| `/qc/list` | `GET` | `admin`, `manager`, `QC`, `dev` |
| `/qc/align-qc` | `POST` | `admin`, `manager` |
| `/qc/update-qc/:id` | `PATCH` | `QC`, `admin` |
| `/qc/sync-item-details` | `POST` | `admin`, `manager`, `dev` |
| `/qc/daily-report` | `GET` | `admin`, `manager`, `QC`, `dev` |
| `/qc/export` | `GET` | `admin`, `manager`, `QC`, `dev` |
| `/qc/:id/inspection-records` | `PATCH` | `admin`, `manager` |
| `/qc/:id/inspection-record/:recordId` | `DELETE` | `admin` |
| `/qc/:id` | `GET` | `admin`, `manager`, `QC`, `dev` |

### Items routes (`backend/routers/items.routes.js`)

| Endpoint | Method | Allowed roles |
|---|---|---|
| `/items` | `GET` | `admin`, `manager`, `QC`, `dev` |
| `/items/sync` | `POST` | `admin`, `manager`, `dev` |

### Brand routes (`backend/routers/brand.route.js`)

| Endpoint | Method | Allowed roles |
|---|---|---|
| `/brands` | `GET` | `admin`, `manager`, `QC`, `dev`, `user` |
| `/brands/:name/calendar` | `GET` | `admin`, `manager`, `QC`, `dev`, `user` |
| `/brands/create-brand` | `POST` | `admin`, `manager`, `dev` |

### Auth routes (`backend/routers/auth.routes.js`)

| Endpoint | Method | Allowed roles |
|---|---|---|
| `/auth/signup` | `POST` | Public |
| `/auth/signin` | `POST` | Public |
| `/auth` | `GET` | `admin`, `manager`, `dev`, `QC` |

### Inspector routes (`backend/routers/inspector.routes.js`)

| Endpoint group | Method(s) | Allowed roles |
|---|---|---|
| `/inspectors/*` | All defined routes | `manager`, `admin` |

### User routes (`backend/routers/user.routes.js`)

| Endpoint | Method | Allowed roles |
|---|---|---|
| `/users` | `POST` | `admin` |

### Google OAuth routes (`backend/routers/google.routes.js`)

| Endpoint | Method | Allowed roles |
|---|---|---|
| `/google/auth` | `GET` | Public |
| `/google/callback` | `GET` | Public |

## 4) Additional controller-level role restrictions

| Feature | Extra check |
|---|---|
| Edit order quantity/shipment | Admin only (`backend/controllers/order.controller.js`) |
| Archive by setting quantity to 0 | Admin only (`backend/controllers/order.controller.js`) |
| Backdated QC align request | Admin only (`backend/controllers/qc.controller.js`) |
| Update QC after inspection done | Admin only (`backend/controllers/qc.controller.js`) |

## 5) Frontend UI role highlights

| UI feature | Allowed roles | Source |
|---|---|---|
| `QC`, `Open Orders`, `Shipments`, `Bulk Shipping`, `Daily Reports` links | `QC`, `admin`, `manager`, `dev` | `client/OMS/src/components/Navbar.jsx` |
| `Upload Logs`, `Update Orders` | `admin`, `manager`, `dev` | `client/OMS/src/components/Navbar.jsx` |
| `Allocate Labels` | `admin`, `manager` | `client/OMS/src/components/Navbar.jsx` |
| `Create User`, `Archived Orders` | `admin` | `client/OMS/src/components/Navbar.jsx` |
| Orders action column | `admin`, `manager`, `dev` | `client/OMS/src/pages/Orders.jsx` |
| Archive order button | `admin` | `client/OMS/src/pages/Orders.jsx` |
| Shipping edit | `admin` | `client/OMS/src/pages/Shipments.jsx` |

## 6) Risk points status update

| Risk point | Previous status | Current status | Notes |
|---|---|---|---|
| Mixed `dev` vs `Dev` checks | Open | Fixed | Routes/UI now use canonical `dev`; auth payloads and model normalization emit/store canonical role values. |
| Unprotected `POST /users` | Open | Fixed | Route now requires `auth` + `authorize("admin")`. |
| Unprotected `POST /orders/re-sync` | Open | Fixed | Route now requires `auth` + role authorization. |
| Unprotected `POST /brands/create-brand` | Open | Fixed | Route now protected by `auth` + role authorization. |
| Sensitive customer upload files tracked in git (`backend/uploads/*`) | Open | Fixed (current branch) | Files removed from index and `backend/.gitignore` now excludes uploads except `.gitkeep`. |
| Live secrets in local `backend/.env` | Open | Open | File is gitignored (not tracked), but contains real credentials/tokens; rotate and move secrets into VPS secret management. |
| Public signup endpoint (`POST /auth/signup`) | Open | Open | Keep only if self-registration is intended; otherwise restrict or disable in production. |
| Public Google OAuth endpoints (`/google/auth`, `/google/callback`) | Open | Open | Consider admin-only guard or network/IP restriction in production. |
