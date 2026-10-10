# EUDR Timber Management — Phase 1

Phase 1 records and reviews timber purchase evidence. It deliberately does not create inventory credits, stock balances, timber pools, container deductions, FIFO allocation, DDS submissions, or EUDR compliance certification.

## Collections and indexes

- `timber_suppliers` stores timber suppliers separately from OMS furniture manufacturers. `normalized_gstin` is unique when present; active normalized name plus country is also unique.
- `timber_purchases` stores purchase evidence. Furniture manufacturers reference the existing `vendors` collection by ObjectId and retain a small historical display snapshot.
- An approved purchase has a database-enforced unique invoice identity: timber supplier, normalized invoice number, and financial year. This prevents concurrent cross-manufacturer approvals of the same invoice.
- Documents, validation flags, and audit history are embedded in the purchase. Replacements add a new immutable document version and retain the old storage key and audit record.

All CFT values are stored as integer thousandths of CFT. The API returns display values as CFT strings.

## API

All endpoints require the `eudr_timber` permission module.

- `GET /api/eudr/manufacturers`
- `GET|POST /api/eudr/timber-suppliers`
- `GET|PATCH /api/eudr/timber-suppliers/:id`
- `GET|POST /api/eudr/timber-purchases`
- `GET|PATCH /api/eudr/timber-purchases/:id`
- `POST /api/eudr/timber-purchases/:id/documents`
- `GET /api/eudr/timber-purchases/:id/documents`
- `POST /api/eudr/timber-purchases/:id/submit`
- `POST /api/eudr/timber-purchases/:id/approve`
- `POST /api/eudr/timber-purchases/:id/reject`
- `POST /api/eudr/timber-purchases/:id/request-info`
- `POST /api/eudr/timber-purchases/:id/reopen`
- `GET|POST /api/eudr/timber-purchases/:id/validation`
- `GET /api/eudr/documents/:id/download`

Permissions use the existing flat matrix: `view` covers pages/downloads, `manage` covers suppliers and reopening, `create`/`edit` cover purchases, `upload` covers documents, and `approve` covers validation and review decisions. The server also checks the user's permitted manufacturer scope and blocks self-approval.

## Deployment

No migration is needed because Phase 1 is additive. Deploy the code, ensure the application creates the two new Mongoose collections and indexes, then grant `EUDR Timber Management` permissions to the intended operations and compliance roles.

The existing private Wasabi storage configuration is reused. EUDR uploads accept PDF, JPEG, and PNG only, enforce a 20 MB-per-file / 20-files-per-request limit, verify the file signature, hash content with SHA-256, and use expiring signed URLs. A production malware-scanning provider is not bundled with this repository and must be connected before relying on uploads as malware-scanned evidence.

## Phase 2 boundary

Approved purchases are only eligible evidence records. Phase 2 can create receipt and stock-ledger records from them after separate inventory, mixed-pool, and source-traceability controls are designed and reviewed.
