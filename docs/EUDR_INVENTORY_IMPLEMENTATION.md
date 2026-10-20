# EUDR documentary inventory implementation

This extension keeps the container EudrChain workflow and adds a shared documentary quantity ledger. Balances measure commitments inside OMS. They do not establish stock held by an external party or certify EUDR compliance. Both supplied reference documents describe the baseline; the repository remains authoritative.

## Baseline and integration

The original module embeds ordered sawmill, transport, receiver and declaration stages. A seller invoice is linked to its receiver by incoming_invoice_stage_id. A container/vendor EudrAllocation revision serializes local contributions. Previously a sparse unique multikey invoice_keys index prohibited cross-chain invoice reuse. Private files, previews, Office conversion, role checks and stage history remain in their existing services.

New code lives in:

- backend/models/eudrInventory.model.js
- backend/services/eudrQuantity.service.js
- backend/services/eudrInventory.service.js
- backend/services/eudrInventoryMigration.service.js
- backend/controllers/eudrInventory.controller.js
- backend/scripts/eudrInventoryMigration.js
- client/OMS/src/components/eudr/Inventory*.jsx
- client/OMS/src/utils/eudrInventory.js

The /eudr/inventory router is mounted before /:id. It inherits authentication, private/no-store responses and admin, super_admin or manager access. Corrections, cancellation, commitment release and reviewed historical imports additionally require admin or super_admin.

The existing stage editor additionally supports POST /eudr/:id/stages/:stageId/reuse-invoice with invoice_id and confirmed:true. It checks canonical issuer, buyer, invoice identity and single-line quantity before linking the private file. When canonical mode detects an already registered upload, it offers this explicit linking action. Multi-line purchases use the inventory workflow.

## Collections and authoritative relationships

| Model / collection | Responsibility and constraints |
| --- | --- |
| EudrInvoice / eudr_invoices | Permanent unique identity_key, issuer/buyer snapshots, invoice date/FY, total and identified material lines, private document IDs, evidence revision, chain references. Line quantities sum to the registered total. |
| EudrTimberSourceBatch / eudr_source_batches | One normalized owner/production-reference identity, evidenced documented production, optional cutting limit, forest plots, dates and output root lot. Reusing production evidence cannot create another source. |
| EudrTimberLot / eudr_timber_lots | One holder and material basis, documented/received quantity, availability date and incoming transfer or source. Unique incoming_operation and source_batch references prevent duplicate root or receipt lots. |
| EudrTimberTransfer / eudr_timber_transfers | One invoice/line/fulfillment identity, seller/buyer, sold/input and received/output quantities, input lot constraints, transport/receipt evidence and one output lot. Transformations use a separate holder/operation reference. |
| EudrTimberMix / eudr_timber_mixes | Logical aggregation or documented physical mixing. It creates no lot or quantity. Quantified constraints require an associated transfer with matching input constraints; the transfer is authoritative. |
| EudrTimberCommitment / eudr_timber_commitments | One unique commitment per chain; links multiple finished lots to a container/vendor contribution. Retries replace/reuse that same commitment, rather than create another entitlement. |
| EudrDocument / eudr_documents | Private object metadata, SHA-256, purpose and optional legacy location. A file is referenced by ID and is never deleted by inventory correction or reversal. |
| EudrInventoryAudit / eudr_inventory_audit | Append-only application events, actor, revision, reason, prior/after snapshots and reconciliation details. No update/delete audit API exists. |
| EudrMigrationReview / eudr_migration_reviews | Ambiguous history, unsupported production/conversion and outstanding historical allocation review. |
| EudrInventoryState / eudr_inventory_state | Singleton global revision plus registry, index transition and allocation rollout state. |

Indexes cover canonical identities, holder/status/date, invoice lines, input lots, output lots, container/vendor, chain, document hashes, audit entities and dates. EudrChain gains canonical_invoices, inventory_backed, inventory_status, inventory_commitment and inventory_revision. Embedded stage/evidence snapshots and history remain readable.

Invoice invoice_documents and source production_documents permanently retain quantitative proof ownership, including replaced evidence. Unique sparse multikey indexes prevent the same proof from establishing another invoice identity or production entitlement. Shared licences and other non-quantity supporting documents remain reusable. Empty proof arrays are omitted for sparse uniqueness; migration seeds ownership from actual invoice evidence, never guessed historical files.

Authoritative quantities are nonnegative safe integer milli-CFT. API CFT strings accept at most three decimal places and are converted with BigInt before checking Number safety. The existing shipment line rounding convention is preserved, with overflow checks added to its helpers and aggregate calculations. RAW, PROCESSING_INPUT and FINISHED quantities are distinct material bases.

Parties are selected through existing vendor or saved-party IDs. The server loads their identities. Inventory registration validates PAN format and GST format/PAN relationship. A PAN-only issuer uses an explicit PAN-prefixed key and requires an identity explanation; its evidence still requires manual review. This is format/relationship validation, not an external GST registration lookup.

## Quantity reconciliation

Each real transfer has a fixed documented outgoing demand and one bounded receipt lot. All active demands in the connected graph are checked together.

The engine builds a lower-bound circulation:

1. A source node connects to each lot with capacity equal to its documented/verified receipt quantity.
2. An eligible lot connects to each supported outgoing transaction.
3. EXACT inputs fix lower and upper flow to the evidenced amount.
4. PARTIAL inputs apply genuine lower/upper bounds; unspecified amounts remain unknown.
5. UNKNOWN inputs have zero lower bound. Listing a source, including CONFIRMED participation, does not invent a positive amount.
6. Every transaction connects to the sink with lower = upper = its total outgoing quantity.
7. A sink-to-source edge closes the circulation. Super-source/super-sink balancing reduces lower-bound feasibility to integer maximum flow using deterministic augmenting paths.

The complete active set is included. Existing lower bounds can be rearranged within their documented uncertainty; the algorithm is not a greedy per-invoice subtraction. Residual reverse edges let an earlier hypothetical split change when another transaction is added. The constraint matrix is a flow network with integral capacities, so a feasible flow has integral milli-CFT values.

A receipt does not recreate its upstream transfer. The transfer's outgoing demand consumes its seller's input lots once; later buyer sales consume the one receipt lot. Every ancestor transfer remains in the model, so shared roots, branching and nested merging cannot create independent supply.

Owner/material mismatches, duplicate inputs, missing incoming transfers, cycles, unsafe arithmetic and future receipts are rejected. Corrected canonical invoice line limits are also enforced across active fulfillments. The outgoing sale allocation date must match the canonical invoice date; a later dispatch or receipt cannot make future purchases eligible for an earlier sale. Dispatch and receipt dates are preserved separately, and buyer availability uses the verified receipt date. Output/receipt cannot exceed sold/processing input.

Ranges are found by binary-searching minimum and maximum aggregate lot use under the same complete circulation constraints. A selected group is routed through one shared capacity edge. Individual feasible maxima are explicitly non-additive. No maximum-flow witness is returned or persisted as actual source composition.

The required 1000 -> 500 + 300 -> unknown 600 example is automated. Either A-only 200 or B-only 200 can complete the last shared 200. Both original lots then have maximum remaining capacity zero. Another 300, another 1 after exhaustion, and another 100 through a new chain fail. Boranada's own 250 + 350 uses its 600 receipt once. Separate new production evidence adds separate capacity.

## Origin and chronology review

Documentary verification, quantity feasibility and origin review are separate fields and controls. Potential origins are derived from all declared upstream input paths, independent of a flow solution. Physical mix evidence additionally expands origins across every member of that mix. Logical grouping alone does not assert physical mixing.

Dates are date-only and inclusive. Same-day eligibility does not invent an intraday order: transfer verification requires same_day_reviewed when a selected lot became available on that date. Container final review also requires explicit confirmation for same-day supply.

Container availability is conservatively checked against the earliest recorded stuffing date for that vendor's rows because the current allocation contract does not map particular lots to individual shipment rows. A proposed allocation date cannot follow that stuffing date. Missing stuffing dates can remain in drafts but block final inventory-backed review. This conservative rule may require an earlier-supported lot when a container has rows stuffed on different dates.

Version 3 inventory declarations carry vendor and date-aware shipment signatures. Existing legacy signatures retain their original format. Changes to vendor GST/PAN, stuffing dates, quantities or Timber_CFT invalidate inventory declaration review. Missing Timber_CFT is distinct from numeric zero and blocks inventory-backed clearance; the old legacy display is preserved during rollout.

If a container mixes legacy-approved and inventory-backed contributions, its coverage remains incomplete under the inventory standard until the legacy quantities are reviewed and allocated. Existing wholly legacy coverage remains a historical approval; it is not re-certified by migration.

## Lifecycle and transactions

- DRAFT records can be collected backward and have no spendable output.
- RESERVED transfers/containers count against competing uses. Reserved transfer output cannot be spent until verification.
- COMMITTED transfers and verified source lots may support downstream activity.
- ON_HOLD historical demands keep consuming capacity. Their lots cannot support new commitments.
- CANCELLED, REJECTED and SUPERSEDED records cannot supply new capacity. Cancellation/reversal is controlled and audited.

All inventory mutations take the singleton global revision write inside a MongoDB snapshot transaction before authoritative reads. A container mutation then takes its existing EudrAllocation lock, in that order. Mongoose/MongoDB retry transient transaction conflicts, with backoff, at most five callback attempts and a 15-second transaction deadline. Unsupported transactions fail closed. Unique identities and one commitment per chain make retries safe.

This coarse global lock intentionally serializes unrelated inventory mutations too. Component reads follow indexed input/output relationships rather than scanning all inventory. A mix connecting formerly unrelated graphs remains safe because all writers share the lock.

Component discovery also follows canonical invoice references. Partial fulfillments with otherwise separate source graphs are reconciled together against the same invoice-line cap, including after corrections.

Limits fail closed: 2,000 lots, 4,000 operations, 16,000 input edges, depth 200, 50 requested range groups, 100 inputs per operation and a five-million residual-edge inspection budget per reconciliation. Pagination defaults to 25 and supports up to 100 rows per page. Quantity-filter evaluation requires a search narrowed to at most 2,000 candidate lots.

## Verification, correction and release

Source activation requires production, licence, permission and forest image evidence plus complete plot/coordinate/permission information. Invoice activation requires invoice evidence. Transfers require a verified sale invoice, verified input lots, their own receipt evidence and weight slip, billty, driver licence and e-way bill evidence. A receipt shortage must have an explanation; the buyer receives only its recorded received quantity.

Transformations consume evidenced input CFT, record loss and create at most that quantity of output on the specified basis. They require transformation evidence and an authorized manual conclusion. There is no automatic yield assumption.

An unsupported receipt/output claim may be retained in a DRAFT for collection and correction. Its lot remains unspendable, it is excluded from displayed holder capacity, and reservation/verification rejects output exceeding input. Draft quantities and receipt dates can be edited without creating an active commitment.

Verification records actor, time, method, evidence revision, note and same-day review. Unknown allocation remains unknown after quantity feasibility or manual review.

Corrections preserve the prior snapshot in audit, increment evidence revision and put the connected network's active lots/transactions/container approvals on hold. Quantities are not silently truncated or released. An infeasible correction is retained as disputed evidence and reported; it cannot become spendable. Re-review proceeds from sources through transfers after the underlying conflict is corrected. A cancellation exposes dependent transfers/containers and refuses release until those dependencies are reversed. Completed container commitments need reversal evidence.

Leaf reversals and reservation releases can unwind an already infeasible network in several audited steps. Before/after reconciliations are retained; any remaining infeasible network stays on hold and cannot support new allocations. Reversing a physical mix requires evidence and holds origin approvals; it withdraws the claimed relationship without creating or releasing documentary supply.

Chain-stage edits run canonical synchronization when enabled. Replaced source/sale/transport/receipt evidence holds affected global dependencies. A verified canonical invoice correction needs an administrator, including when attempted through a legacy stage editor. Viewing a document never invokes verification or invalidation.

## API contracts

All paths below are under /eudr/inventory. IDs are MongoDB IDs. Input quantities use *_cft; stored/output quantities use *_milli or *_milli_cft.

| Method/path | Contract |
| --- | --- |
| GET /state | Registry, index and allocation rollout state. |
| GET /batches | Paginated lots; search, owner, party, vendor, material, status, verification, mode, container and quantity filters. Returns documentary ranges and linked-record counts. |
| POST /batches | Production draft: owner reference, production_reference, quantity_cft, production_date, material, origins and document IDs. |
| GET /batches/:id | Lot, connected network, conservative potential origins, documents, global ranges and recent history. |
| GET /batches/:id/lineage | Connected documentary DAG and reconciliation. |
| GET /batches/:id/commitments | Paginated container commitments referencing that lot. |
| GET/POST /invoices | Paginated search or canonical registration/reuse; issuer/buyer references, number/date, total_cft, distinct lines and document IDs. |
| GET /invoices/:id | Canonical evidence revision and invoice identity. |
| GET/POST /transfers | Paginated search or sale/transformation draft. Inputs contain lot IDs, participation, optional exact_cft/min_cft/max_cft and evidence_note. |
| GET/PATCH /transfers/:id | Read or edit the current draft's sources and evidence, with revision. |
| POST /transfers/:id/reserve | Activate a provisional quantity demand; output remains unspendable. |
| GET/POST /mixes; GET /mixes/:id | Logical or physical mix evidence. No independent capacity. |
| POST /:resource/:id/verify | Current revision, review note, origins_reviewed and same_day_reviewed. Resources: invoices, batches (source IDs), transfers, mixes. |
| PATCH /:resource/:id/correction | Admin: revision, reason, supporting document IDs and corrected quantities/lines/dates/inputs. |
| POST /:resource/:id/cancel | Admin: batches, transfers, invoices or mixes; revision, reason, reversal evidence; blocks dependent activity. |
| POST /reconcile | lot_ids, optional range groups and a provisional proposal. Read-only preview; mutations always rebuild inside the transaction. |
| POST /commitments | chain, quantity_cft equal to chain contribution, date, mode, inputs, same_day_reviewed and optional use_inherited_lineage. |
| POST /commitments/:id/release | Admin: revision, reason and evidence for a completed allocation. |
| POST /migration/review-network | Admin: explicitly reviewed records in topological order and allocations for every historical chain sharing their invoices. Entire import is atomic. |
| GET /conflicts; GET /audit | Paginated conflict or append-only activity records; audit can filter entity. |
| GET/POST /documents | Paginated file search or existing upload policy with file and purpose. Duplicate bytes offer canonical linking. |
| GET /documents/:id/url, /content, /preview | Existing signed original/download, private ranged streaming and PDF/image/Office preview implementation. |

Batch list/detail IDs identify lots. POST /batches returns a source record with output_lot; source verification/correction uses the source ID in that record. The UI performs this mapping.

Party references are {kind: "vendor" or "party", id}. Transfer identity is canonical invoice ID + line ID + fulfillment (default full). Genuine partial fulfillments share the invoice line's total cap. Transformations require idempotency_key. Container retry identity is the chain itself.

Transfer payload fingerprints are refreshed after draft edits and corrections. Retrying an obsolete creation payload returns an identity conflict; it cannot overwrite the current evidence revision or create another receipt.

Errors include INVALID_QUANTITY/REFERENCE (400), FORBIDDEN (403), NOT_FOUND (404), identity/chronology/global quantity/verification/optimistic revision conflicts (409), graph/work limits (413) and missing transactions or rollout prerequisites (503). Quantity errors include capacities and related transaction/container references when available. They never describe an arbitrary flow as provenance.

## Frontend workflows

EUDR Management has Containers and Inventory sections using existing OMS styling.

Inventory supports registry search and pagination, verification/allocation/quantity filters, documented and committed ranges, exhausted lots, linked counts and batch detail tabs for overview, sources, usage, documents, verification and history. The SVG DAG represents source lots, receipt lots, transfers, transformations, mixes and containers with stable identities; batch nodes can be expanded.

Production source, canonical invoice (including multiple lines), mixed sale, processing conversion and mix evidence forms reuse existing parties and canonical private documents. UNKNOWN mode asks for no per-invoice amount. A read-only feasibility preview is available before activation. Draft transfers can later add upstream and receiving evidence.

Within a container chain, Select vendor lots supports several finished lots and partial/unknown contribution constraints. Reconcile and reserve uses the backend total; an untouched draft can inherit the canonical upstream network and retain only its own declaration. The All Documents workspace includes unique canonical network evidence through the existing document store/viewer. Existing stages remain editable through their original forms.

Admin correction/reversal actions are available on batch verification/usage tabs. Historical network import is an administrative API workflow; it is deliberately not an automatic migration approval.

## Migration and deployment sequence

Do not run these against production without the operator's authorization. Commands require an explicit URI and do not read MONGO_URI. Use a replica set/transaction-capable cluster, private Wasabi configuration and the existing preview conversion runtime. No new solver or runtime dependency was added.

1. Back up MongoDB and retain private evidence objects. Stop EUDR writers for the registry/index transition. Deploy the new schemas and code with container allocation still disabled.
2. Run dry-run and investigate its detailed conflicts/review items:

   node backend/scripts/eudrInventoryMigration.js --uri "<replica-set-uri>" --mode dry-run

3. Apply canonical linkage. It is safe to rerun:

   node backend/scripts/eudrInventoryMigration.js --uri "<replica-set-uri>" --mode apply

4. Validate:

   node backend/scripts/eudrInventoryMigration.js --uri "<replica-set-uri>" --mode validate

5. Set EUDR_CANONICAL_INVOICES=true on every backend writer and in the migration command environment. This prevents application index creation from recreating the obsolete invoice_keys index. With writers still stopped:

   node backend/scripts/eudrInventoryMigration.js --uri "<replica-set-uri>" --mode transition-index

6. Run validate again. Only the exact obsolete unique sparse invoice_keys_1 index is removed. The canonical invoice identity index must exist first.
7. Resolve selected historical networks through POST /migration/review-network. Add actual production, transport, receipt and conversion evidence; map all historical contributions sharing the invoice. Do not invent production from a sale or cutting limit. Imported invoices/receipt lots remain DRAFT or ON_HOLD until this explicit review. Direct legacy transfer activation/reservation is blocked.
8. Enable container allocations after validation:

   node backend/scripts/eudrInventoryMigration.js --uri "<replica-set-uri>" --mode enable-allocations

9. Set EUDR_INVENTORY_REQUIRED=true on every writer to enforce ledger-backed final clearance for new work. Restart writers with both flags. Existing historical approvals remain visible; they are not automatically re-certified. Newly inventory-backed chains always require the ledger even if the rollout flag is later disabled.
10. Run post-migration validate and the isolated regression suites on the deployment build.

Preparation imports canonical invoice ownership, unambiguous sale/receipt links and original file references. It creates review records for missing quantities, identities, production, material conversion and historical uses. It never creates a production root from a cutting limit, and never converts a legacy approval into a fresh spendable entitlement. Superseded/archived invoice identities remain permanently registered.

A legacy invoice without a recorded checksum cannot activate. Establish its integrity by uploading the reviewed original through the canonical document upload (which calculates SHA-256 server-side), then make an audited invoice evidence correction before historical network review. The old private object and permanent proof ownership remain retained.

The reviewed historical import is all-or-nothing. records must include current revision/manual conclusions, in origin-to-vendor order, including legacy invoices/transfers and required transformations. allocations must cover every chain reference of the imported legacy invoices. They reserve historical contributions; final inventory declaration approval is still a separate manual action.

## Recovery

Pause allocation creation without deleting history:

node backend/scripts/eudrInventoryMigration.js --uri "<replica-set-uri>" --mode disable-allocations

Keep ledger-aware readers and existing commitments. Correct/re-review disputed records or reverse dependents in reverse topological order. Use database backup recovery for operational failures; do not delete ledger collections or shared evidence.

Before any genuine cross-chain reuse or active inventory commitment, rollback-index can restore the old exact invoice_keys index:

node backend/scripts/eudrInventoryMigration.js --uri "<replica-set-uri>" --mode rollback-index

This refuses when active commitments, active documentary entitlements or duplicate cross-chain invoice keys exist. After legitimate reuse, the old model cannot represent the data; use forward recovery and retain canonical ownership. Rollback never removes canonical invoices, audit, documents or lots.

## Testing

From backend:

- npm test
- npm run test:eudr-inventory
- EUDR_TEST_MONGOD=/path/to/mongod npm run test:eudr-inventory:integration
- node tests/eudrAllocation.integration.js /path/to/mongod
- node tests/eudrOffice.integration.js
- node tests/eudrChain.browser.js
- node tests/eudrInventory.browser.js

On PowerShell, assign the test executable with $env:EUDR_TEST_MONGOD='C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe' before the integration command. The tests launch their own loopback-only temporary replica set, never use MONGO_URI, and validate the spawned process before using it.

From client/OMS: npm test and npm run build. Build before browser tests. Browser tests serve only the built frontend with intercepted fixtures and do not contact production or Wasabi.

Coverage includes mandatory A-H scenarios, exact/partial/unknown constraints, nested/shared paths, exhaustive randomized feasibility comparison, ranges, invoice normalization/lines/FY/conflicts, verified source creation, competing global reservations, retry/idempotency/rollback, conversion loss, containers, permissions, canonical preview, evidence holds, safe migration/reruns/index transition, and all existing EUDR regression tests.

### Verification results on 13 October 2026

| Check | Result |
| --- | --- |
| Full backend unit/regression suite | 686 passed, 0 failed, 1 existing conditional skip; 687 total |
| Full frontend suite | 50 passed, 0 failed |
| Isolated inventory MongoDB/API integration | 20 passed, 0 failed, including its parent test |
| Existing MongoDB allocation integration | Passed, including 12 competing allocations and rollback |
| Existing EUDR browser regression | Passed |
| New inventory browser regression | Passed |
| Production frontend build | Passed; existing large PDF runtime chunk warning remains |
| Real Office fixture conversion | DOC, DOCX, XLS, XLSX, CSV and TXT passed on Windows |
| Diff whitespace check | Passed |

The conditional skip is the pre-existing real iPhone HEIC test, which requires QC_HEIC_FIXTURE_PATH. No test was disabled to obtain these results. Two legacy fixtures were extended with required quantity/state context; their existing assertions remain intact.

The solver suite includes 200 deterministic randomized networks checked against exhaustive assignments and exhaustive bounded range extrema across 80 small cases. Mandatory A-H tests are in eudrQuantity.test.js. Integration tests exercise actual temporary MongoDB transactions, concurrent mixed sales linking independent sources, competing containers, failed-write rollback, idempotent retries and stale payload conflicts, shared invoice fulfillment constraints, shortage accounting, correction holds/recovery, permanent replaced-proof ownership, stepwise reversals of infeasible networks, legacy checksum holds, historical import, physical mix withdrawal, canonical file reuse and role enforcement.

Browser screenshots were inspected at desktop and mobile sizes. All browser API data is intercepted fixture data. Production migration/index changes, live Wasabi access and the Linux production conversion sandbox were not exercised; the Office integration used locally generated trusted Windows fixtures. Production acceptance should follow the deployment sequence above.

## Operational limits

The initial global lock favors integrity over write throughput. The solver's work/graph bounds are explicit and may require operational review of unusually large connected networks. Quantity-filter searches require narrowing when more than 2,000 lots match.

Inventory mutations require EUDR_CANONICAL_INVOICES=true, in addition to the database rollout state. Once canonical ownership is enabled, a newly requested final declaration cannot use chain-only coverage. EUDR_INVENTORY_REQUIRED=true additionally marks new chains as inventory-backed from creation. Existing legacy approvals remain readable. This prevents the old and new workflows from independently granting clearance for the same purchase.

The first verified source/receipt also sets persistent inventory_enforced state. Turning off environment flags later does not restore chain-only writes: EUDR mutations fail closed until canonical ownership is enabled again. Only a guarded rollback with no active entitlements, commitments or duplicate invoice references can clear that state.

Legacy material/date/source uncertainty remains a manual review item. Different-FY invoice identity correction is blocked for investigation rather than silently renaming the permanent invoice identity. Raw-to-finished conversion, physical mixing, same-day ordering and forest origin are human evidence conclusions. There is no external physical inventory synchronization, OCR, automated origin proof, legal certification or automatic production/yield assumption.

Inventory retains orphaned storage uploads if metadata commit fails; it does not risk deleting a shared object after an ambiguous failure. Operators may reconcile genuinely orphaned objects against all document/history references separately. No storage cleanup is performed by this feature.
