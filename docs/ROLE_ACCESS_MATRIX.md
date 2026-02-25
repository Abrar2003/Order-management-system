# Role Access Matrix

Generated on: 2026-02-25

## 1) Defined roles

| Role | Source |
|---|---|
| `admin`, `manager`, `QC`, `Dev`, `user` | `backend/models/user.model.js:6` |

## 2) Authorization behavior

| Layer | Rule | Source |
|---|---|---|
| Backend middleware | Access allowed only if `req.user.role` is in `authorize(...)` list | `backend/middlewares/authorize.middleware.js:1-7` |
| Frontend token decode | UI uses decoded token `role` for feature visibility | `client/OMS/src/auth/auth.service.js:53-71`, `client/OMS/src/auth/auth.utils.js:1-8` |

## 3) Backend API role matrix

### Orders routes (`backend/routers/orders.routes.js`)

| Endpoint | Method | Allowed roles |
|---|---|---|
| `/orders/upload-orders` | `POST` | `admin`, `manager`, `dev`, `Dev` |
| `/orders/manual-orders` | `POST` | `admin`, `manager`, `dev`, `Dev` |
| `/orders/upload-logs` | `GET` | `admin`, `manager`, `dev`, `Dev` |
| `/orders` | `GET` | `admin`, `manager`, `QC`, `dev` |
| `/orders/brands-and-vendors` | `GET` | Any authenticated user |
| `/orders/brand/:brand/vendor/:vendor/status/:status` | `GET` | Any authenticated user |
| `/orders/filters` | `GET` | Any authenticated user |
| `/orders/shipments/export` | `GET` | `admin`, `manager`, `QC`, `dev`, `Dev` |
| `/orders/shipments` | `GET` | `admin`, `manager`, `QC`, `dev`, `Dev` |
| `/orders/edit-order/:id` | `PATCH` | Route: `admin`, `manager` (controller adds admin-only restrictions for qty/shipment) |
| `/orders/archive-order/:id` | `PATCH` | `admin` |
| `/orders/archived` | `GET` | `admin` |
| `/orders/sync-zero-quantity-archive` | `POST` | `admin` |
| `/orders/finalize-order/:id` | `PATCH` | `admin`, `manager`, `dev` |
| `/orders/today-etd-orders` | `GET` | Any authenticated user |
| `/orders/:brand/vendor-summary` | `GET` | Any authenticated user |
| `/orders/:brand/today-etd-orders` | `GET` | Any authenticated user |
| `/orders/order-by-id/:id` | `GET` | Any authenticated user |
| `/orders/re-sync` | `POST` | No auth middleware currently applied |

### QC routes (`backend/routers/qc.routes.js`)

| Endpoint | Method | Allowed roles |
|---|---|---|
| `/qc/list` | `GET` | `admin`, `manager`, `QC`, `Dev` |
| `/qc/align-qc` | `POST` | `admin`, `manager` |
| `/qc/update-qc/:id` | `PATCH` | `QC`, `admin` |
| `/qc/sync-item-details` | `POST` | `admin`, `manager`, `dev`, `Dev` |
| `/qc/daily-report` | `GET` | `admin`, `manager`, `QC`, `Dev` |
| `/qc/export` | `GET` | `admin`, `manager`, `QC`, `Dev` |
| `/qc/:id/inspection-records` | `PATCH` | `admin`, `manager` |
| `/qc/:id/inspection-record/:recordId` | `DELETE` | `admin` |
| `/qc/:id` | `GET` | `admin`, `manager`, `QC`, `Dev` |

### Items routes (`backend/routers/items.routes.js`)

| Endpoint | Method | Allowed roles |
|---|---|---|
| `/items` | `GET` | `admin`, `manager`, `QC`, `dev`, `Dev` |
| `/items/sync` | `POST` | `admin`, `manager`, `dev`, `Dev` |

### Brand routes (`backend/routers/brand.route.js`)

| Endpoint | Method | Allowed roles |
|---|---|---|
| `/brands` | `GET` | `admin`, `manager`, `QC`, `dev`, `user` |
| `/brands/:name/calendar` | `GET` | `admin`, `manager`, `QC`, `dev`, `user` |
| `/brands/create-brand` | `POST` | No auth/authorize currently applied (commented) |

### Auth routes (`backend/routers/auth.routes.js`)

| Endpoint | Method | Allowed roles |
|---|---|---|
| `/auth/signup` | `POST` | Public |
| `/auth/signin` | `POST` | Public |
| `/auth` | `GET` | `admin`, `manager`, `Dev`, `QC` |

### Inspector routes (`backend/routers/inspector.routes.js`)

| Endpoint group | Method(s) | Allowed roles |
|---|---|---|
| `/inspectors/*` | All defined routes | `manager`, `admin` (enforced via router-level `router.use(authorize(...))`) |

### User routes (`backend/routers/user.routes.js`)

| Endpoint | Method | Allowed roles |
|---|---|---|
| `/users` | `POST` | No auth/authorize currently applied |

## 4) Additional controller-level role restrictions

| Feature | Extra check |
|---|---|
| Edit order quantity/shipment | Admin only (`backend/controllers/order.controller.js:2720-2729`) |
| Archive by setting quantity to 0 | Admin only (`backend/controllers/order.controller.js:2775-2778`) |
| Backdated QC align request | Admin only (`backend/controllers/qc.controller.js:1294-1297`) |
| Update QC after inspection done | Admin only (`backend/controllers/qc.controller.js:1558-1563`) |

## 5) Frontend UI role matrix

### Navbar and navigation visibility

| UI feature | Allowed roles | Source |
|---|---|---|
| Show `QC`, `Open Orders`, `Shipments`, `Bulk Shipping`, `Daily Reports` links | `QC`, `admin`, `manager`, `dev`, `Dev` | `client/OMS/src/components/Navbar.jsx:27-44` |
| Show `Upload Logs` link and `Update Orders` action | `admin`, `manager`, `dev`, `Dev` | `client/OMS/src/components/Navbar.jsx:28`, `57-59`, `199-213` |
| Show `Allocate Labels` action | `admin`, `manager` | `client/OMS/src/components/Navbar.jsx:29`, `174-184` |
| Show `Create User` and `Archived Orders` access | `admin` | `client/OMS/src/components/Navbar.jsx:30`, `61-63`, `188-196` |

### Page/component-level UI gating

| Screen/component | Feature | Allowed roles | Source |
|---|---|---|---|
| `Orders.jsx` | Manage action column | `admin`, `manager`, `dev`, `Dev` | `client/OMS/src/pages/Orders.jsx:55` |
| `Orders.jsx` | Add/Realign QC | `admin`, `manager` | `client/OMS/src/pages/Orders.jsx:56-61` |
| `Orders.jsx` | Archive order button | `admin` | `client/OMS/src/pages/Orders.jsx:62` |
| `Shipments.jsx` | Finalize shipping action | `admin`, `manager`, `dev`, `Dev` | `client/OMS/src/pages/Shipments.jsx:46-47`, `160-164` |
| `Shipments.jsx` | Edit shipping action | `admin` | `client/OMS/src/pages/Shipments.jsx:45`, `167-170` |
| `Container.jsx` | Bulk finalize shipping | `admin`, `manager`, `dev`, `Dev` | `client/OMS/src/pages/Container.jsx:31-32` |
| `Items.jsx` | `Sync Items` button | `admin`, `manager`, `dev`, `Dev` | `client/OMS/src/pages/Items.jsx:32` |
| `QcPage.jsx` | `Realign QC` action | `admin`, `manager` | `client/OMS/src/pages/QcPage.jsx:106-108` |
| `QcDetails.jsx` | Update QC button logic | `admin`/`manager` or eligible `QC` | `client/OMS/src/pages/QcDetails.jsx:111-116` |
| `QcDetails.jsx` | Finalize Shipping button | `admin`, `manager`, `dev`, `Dev` | `client/OMS/src/pages/QcDetails.jsx:78-80` |
| `QcDetails.jsx` | Edit Shipping button | `admin`, `manager` | `client/OMS/src/pages/QcDetails.jsx:76`, `83-85` |
| `QcDetails.jsx` | Delete inspection record button | `admin` | `client/OMS/src/pages/QcDetails.jsx:77`, `283-305` |
| `Signup.jsx` | Access to create user screen | `admin` only (others redirected) | `client/OMS/src/pages/Signup.jsx:10`, `27-29` |
| `ArchivedOrders.jsx` | Access to archived orders screen | `admin` only (others redirected) | `client/OMS/src/pages/ArchivedOrders.jsx:14` |
| `EditOrderModal.jsx` | Edit quantity/shipment fields | `admin` only | `client/OMS/src/components/EditOrderModal.jsx:65` |
| `UpdateQcModal.jsx` | Show Allocate Labels section | `admin`, `manager` | `client/OMS/src/components/UpdateQcModal.jsx:28`, `755` |

## 6) Observed inconsistencies / risk points

| Issue | Detail |
|---|---|
| Mixed `dev` vs `Dev` usage | Backend enum defines `Dev`, but route/UI checks use both `dev` and `Dev` variants. |
| Unprotected user creation route | `POST /users` currently has no auth/authorize middleware in `backend/routers/user.routes.js`. |
| Unprotected order re-sync route | `POST /orders/re-sync` currently has no auth middleware in `backend/routers/orders.routes.js`. |
| Unprotected brand creation route | `POST /brands/create-brand` has auth/authorize commented out in `backend/routers/brand.route.js`. |

