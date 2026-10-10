# EUDR timber Phase 2

Phase 2 records manufacturer-level timber accounting. It does not allocate an invoice to a finished item or declare EUDR compliance.

## Collections

- `timber_inventory_balances`: one optimistic-locking balance account per existing OMS manufacturer.
- `timber_inventory_ledger`: immutable, idempotent accounting movements.
- `timber_container_consumptions`: draft, confirmed, and reversed consumption records with OMS shipment snapshots.

All quantities are integer thousandths of CFT. The balance is derived by appending ledger entries and is updated in the same MongoDB transaction as every ledger post.

## Receipt credits and migration

Approving a Phase 1 purchase credits only its approved delivery-entry quantities. Each entry has a stable subdocument ID, so `receipt-credit:<purchase>:<receipt>` can be posted once. Later verified deliveries create separate credits; corrections create compensating receipt-correction entries.

Existing approved Phase 1 receipts are not credited automatically during deployment. An EUDR manager must use **Backfill Approved Receipts** on the Timber Inventory page, which explicitly posts only the dry-run proposals still missing from the ledger. Re-running it is safe.

MongoDB must run as a replica set (or through `mongos`) because receipt credits, confirmation, reversal, balance updates, and ledger entries require transactions. On a standalone MongoDB instance the operation fails without changing the purchase, balance, ledger, or consumption record.

## Consumption workflow

1. Open an OMS container and choose **Record Timber Usage**, or search it in Timber Inventory.
2. Select the matching manufacturer/container/stuffing-date shipment group and save the reported CFT as a draft.
3. An authorized user confirms it. The API confirms once, posts one debit, and refuses insufficient balance.
4. Reversals require a reason and post a compensating credit; confirmed records are never edited or deleted.

The system blocks both duplicate shipment references and a second active manufacturer/container/stuffing-date group, preventing separate deductions for multiple order rows in one physical shipment. Changes to linked OMS shipment details are retained as snapshots and flagged for reconciliation.

## APIs

- `GET /api/eudr/inventory`
- `GET /api/eudr/inventory/:manufacturerId`
- `GET /api/eudr/inventory/:manufacturerId/{ledger,purchases,consumptions}`
- `GET /api/eudr/container-candidates`
- `GET|POST /api/eudr/consumptions`, `GET|PATCH /api/eudr/consumptions/:id`
- `POST /api/eudr/consumptions/:id/{confirm,reverse}`
- `GET /api/eudr/inventory/reconciliation`
- `POST /api/eudr/inventory/reconciliation/backfill` with `{ "confirm": true }`
- `GET /api/eudr/inventory/export`

The existing `eudr_timber` permissions apply: view for inventory/candidates, create/edit for drafts, approve for confirmation, manage for reversal and reconciliation, and export for CSV. The existing EUDR role gate still limits all routes to Admin, Super Admin, and Manager roles.

## Deliberate boundary

Phase 2 does not support opening balances or manual inventory adjustments yet. Historical receipts must be backfilled from Phase 1 evidence; do not use a manufactured opening quantity to make consumption confirm. A future Phase 3 workflow should add a separately approved, document-backed adjustment request.
