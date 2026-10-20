# Timber Trace review layer — implementation and rollout

Implemented in the local checkout on 14 October 2026. Existing local inventory,
QC, reporting and document-workspace changes were preserved. Nothing was deployed;
no production database, storage object or external provider was changed.

## Decisions

1. The user's network-level decision supersedes section 4.2 of the supplied
   specification. There is no `supportableAtStage` query and no container share of
   upstream quantities or losses. The original eight diagnostic tests, including
   all 162 exhaustive small networks, remain regression evidence. See
   [EUDR_REVIEW_SOLVER_GATE.md](EUDR_REVIEW_SOLVER_GATE.md).
2. A network connects real transfers, transformations, physical mixes and shared
   canonical invoices of the same species. Container commitments do not join
   otherwise independent production networks. All competing commitments, bounds,
   chronology, invoice caps and recorded losses remain in authoritative feasibility
   checks. Existing non-additive solver ranges and `allocation_is_provenance:false`
   remain unchanged; no solver witness is persisted.
3. Finished totals count each documented manufacturing output lot supporting any
   reserved/committed container once. Onward finished receipts and uncommitted
   finished stock are not additional production. Stage evidence and operations are
   checked across the connected network. Every table says **Network-level; not
   attributed to this container**. Independent network totals are not combined to
   cure a shortfall. ON_HOLD commitments retain their competing demand.
4. Checks use integer milli-CFT and BigInt ratios: highest allowed sawing yield,
   zero assumed wastage and a 50 milli-CFT shortfall tolerance. Recorded RAW →
   PROCESSING_INPUT yield is checked per operation; recorded PROCESSING_INPUT →
   FINISHED loss below usual wastage raises an accept-with-reason caution.
   Existing loss explanations and activation constraints still apply.
5. Ordinary PIS/Sample editing may omit composition. Flagged final clearance
   requires recorded composition and HS codes. Complete reporting additionally
   requires complete weights, exact existing coverage, verified declarations and
   origin evidence, and resolved document/provider checks. Final-clearance
   blockers are evaluated separately, so declaration verification is not circular.
6. One commitment remains per chain. Exact contributions derive species demands
   from evidenced lot quantities; UNKNOWN/PARTIAL contributions require explicit
   species suballocations. New species mismatches reject atomically in creation,
   draft editing, correction and activation. Legacy unspecified records remain
   readable and explicitly not reviewable; migration guesses nothing.
7. Item `pis_item_sizes[].net_weight` and Sample `item_sizes[].net_weight` remain
   the only weight inputs. Missing/non-positive size weights block reporting.
   Species volume and integer gram splits use largest remainder, with species-ID
   tie-breaking and exact sums. Shipped unit quantity is retained on every species
   line. `CFT_M3_FACTOR`, configured by `EUDR_CFT_M3_FACTOR`, defaults to the exact
   decimal `0.028316846592`; volume is rounded only when exporting.
8. Production proof ownership is permanent: one document ID belongs to one
   canonical production reference, shared only among its species roots. Old and
   replacement claims survive correction. An active unsplit legacy root prevents
   creation of parallel species entitlements.
9. Provider calls occur before transaction retries; checked results are saved
   only against matching inputs/revisions. Development/test adapters are visibly
   **Simulated**. Production adapters return **Not checked/Pending** and prevent
   Complete readiness. OCR is disabled. Satellite imagery is an explicitly marked
   placeholder, never fabricated evidence. No automated check verifies origin.
10. Source writes on Item, Sample, Order and Vendor take the existing global
    revision lock in transactions, including inserts and bulk/query writes.
    Clearance/submission then take allocation locks and source-document fences;
    their source reads use the same snapshot as the ledger. Plot/party/rule saves
    use the same ledger transaction path. Direct database maintenance writers must
    be paused or use this protocol. The global lock conservatively limits write
    throughput; partitioning it would require a separate concurrency design.
11. Caution acceptance belongs to the container/vendor allocation and binds to its
    relevant operation/rule fingerprint. Unrelated ledger revisions do not undo it.
    Immutable per-group submissions freeze lines, CSV, GeoJSON, revisions,
    actor/time and hash. Business fingerprints exclude submission stamps and global
    audit revisions; changed facts show **Changed after sending**. Historical
    submissions are retained. Request letters are edited/copied/logged only.
12. The recent-chain ceiling remains 50. KPIs explicitly describe recent
    container/vendor groups and deduplicate them. Report discovery fails explicitly
    above 2,000 groups; a send accepts 1–100 distinct groups in one transaction.
    Historical downloads expose the latest 100 submissions. Supply-chain export
    paths have explicit depth/path limits and never select solver provenance.

## APIs and interface

Existing authentication, EUDR role restrictions, private/no-store headers,
protected document delivery and error conventions remain in place. Static routes
are registered before dynamic chain IDs. `GET /eudr/capabilities` exposes the
additive `review_layer` capability; disabled review routes return 404 and existing
views retain their prior behavior.

New sections are **Parties & plots**, **Europe report**, and **Rules**. Chain
screens show the six statuses, numerical/caution/document issues, network tables,
editable declaration lines and request letters. Existing PIS/Sample forms gain
HS/composition fields without duplicating weight fields. Sources support multiple
plot references; invoices/transfers expose explicit document-check refresh.

Under `/eudr`:

- `GET/POST /species`, `PATCH /species/:id` (administrator writes).
- `GET/PUT /rules`, read-only `POST /rules/preview` (administrator writes/preview).
- `GET/POST /parties`, `PATCH /parties/:id`, `POST /parties/gst-lookup`,
  `POST /parties/:id/gst-check`, `POST /parties/vendor/:id/gst-check`.
- `GET/POST /plots`, `GET/PATCH /plots/:id`, `POST /plots/:id/satellite-check`.
- `POST /inventory/invoices/:id/document-checks` and
  `POST /inventory/transfers/:id/document-checks`.
- `GET /report`, `/report.csv`, `/report.geojson`, `POST /report/submit`.
- `POST /:id/caution`, `POST /:id/requests`, `PUT /:id/declaration-lines`.

Rules previews count changed container/vendor statuses without writing. PUT saves
the proposed yields/wastage together against the previewed rules revision;
species writes also advance that revision. Reports list legacy/not-ready groups
separately. CSV includes the requested 17 columns; GeoJSON uses longitude/latitude,
closed polygon rings and the specified producer/plot/satellite properties.

## Guarded rollout

Keep `EUDR_REVIEW_LAYER=false` initially. Preserve the existing
`EUDR_CANONICAL_INVOICES` and `EUDR_INVENTORY_REQUIRED` rollout settings and the
database's enforcement state. This extension does not replace the original
canonical-registry migration described in
[EUDR_INVENTORY_IMPLEMENTATION.md](EUDR_INVENTORY_IMPLEMENTATION.md).

1. Back up the database and indexes; retain the application version and operator
   seed file. Use a MongoDB replica set with transaction support.
2. Run `review-layer-dry-run` with an explicit URI. Review proof ownership
   conflicts, missing metadata and invalid metadata. Dry-run and validation disable
   automatic collection/index creation and perform no writes.
3. Prepare an operator-reviewed JSON file with `species[]` entries containing
   `name`, `scientific_name`, integer `max_yield_bp`, and an integer
   `exporter_wastage_bp` at the root. Optional `_id` values must be deliberate
   ObjectIds. Example shape only, not a production recommendation:

   ```json
   {
     "species": [{
       "name": "OPERATOR_SUPPLIED_COMMON_NAME",
       "scientific_name": "OPERATOR_SUPPLIED_SCIENTIFIC_NAME",
       "max_yield_bp": 6500
     }],
     "exporter_wastage_bp": 1500
   }
   ```

   The numerical defaults remain labelled examples to confirm. This file does not
   assign species to existing items, invoice lines, roots or historical transfers.
4. Pause every writer, including imports, jobs and maintenance scripts. Run
   `review-layer-apply --seed-file <operator.json>` with the explicit URI.
   Apply populates/validates permanent proof ownership before dropping only the
   exact unique sparse `production_documents_1` index. Unexpected index definitions
   or ambiguous proof ownership abort. Startup checks persisted transition state
   and cannot recreate that obsolete index afterward. Apply is idempotent and
   rejects seeds that silently change existing rules/species.
5. Run `review-layer-validate`; inspect both `valid` and the missing-metadata report.
   Structural readiness does not imply old records have become reviewable. Missing
   species/composition/HS/weights must be entered through reviewed workflows.
6. Enable `EUDR_REVIEW_LAYER=true` on all writers together and restart them. Resume
   writers only after validating index state and enabled capabilities. Production
   providers remain unresolved until real adapters and credentials are implemented
   and verified; do not treat simulated tests as production checks.

PowerShell CLI template (supply an explicit URI without committing credentials):

```powershell
$operatorUri = Read-Host 'Enter the MongoDB URI (mongodb:// or mongodb+srv://)'
node backend/scripts/eudrInventoryMigration.js --uri "$operatorUri" --mode review-layer-dry-run
node backend/scripts/eudrInventoryMigration.js --uri "$operatorUri" --mode review-layer-apply --seed-file "$operatorSeedFile"
node backend/scripts/eudrInventoryMigration.js --uri "$operatorUri" --mode review-layer-validate
```

These variables are local PowerShell variables, not automatically loaded from the
backend environment file. Set `$operatorSeedFile` to the reviewed JSON file's path
before apply. An unset URI now produces `MONGODB_URI_REQUIRED` before connecting;
the CLI never treats the following `--mode` option as its value.

For a rollback, pause writers and keep all ownership/history records. The guarded
`review-layer-apply --rollback-proof-index` restores old uniqueness only when no
proof is shared among roots; otherwise it rejects and requires forward recovery.
Disabling the UI flag never releases or removes ledger commitments.

## Validation

Final verification used synthetic fixtures and loopback-only temporary MongoDB
replica sets. Test logs and responsive screenshots are under `output/eudr-review`.

- Full backend, flag off and on: **719 passed, 1 skipped**, each run. The skip
  requires an external iPhone HEIC fixture (`QC_HEIC_FIXTURE_PATH`), unrelated to
  EUDR. Four old controller/unit fixtures explicitly run their legacy flag-off
  contract; enabled behavior is tested against the real isolated replica set.
- Frontend: **50 passed**.
- Review unit plus historical solver diagnostics: **25 passed**, including the
  retained **162 exhaustive-network comparisons**.
- Inventory integration: **20 passed**, including the parent test; review
  integration: **18 passed**, including its parent test. Coverage includes proof
  sharing/correction retention/guarded rollback, migration idempotency/no-write
  dry-run, species mismatch rollback, UNKNOWN multi-species commitments, source
  insert/edit races, concurrent submissions, immutable exports, stale metadata,
  legacy readability, roles/private headers, provider and origin invalidation.
- Allocation MongoDB script passed, including 12 competing allocation attempts.
- Office integration passed real DOCX/DOC/XLSX/XLS/CSV/TXT conversion/preview.
- Existing Inventory and chain-document browser suites passed. Review browser
  passed status/KPI/network tables, caution acceptance, editable logged letters,
  declarations, rule preview/save, GST lookup, party/plot create/edit, imagery
  placeholders, CSV/GeoJSON actions, submission and mobile layout. Screenshots
  were inspected at desktop and 390px mobile widths.
- Production frontend build passed with the server review flag off and on. The
  flag is a runtime capability, so both use the same frontend artifact. The
  existing large-chunk warning remains. ESLint could not run because this checkout
  has no ESLint configuration; no unrelated configuration was added.

## Files changed by this implementation

This manifest identifies this task's files, including edits to the preexisting
untracked inventory implementation. It does not claim unrelated preexisting QC,
forecast, analytics, PDF, AQL or document-workspace changes.

**Backend config, controllers and routing**

- `backend/.env.example`
- `backend/package.json`
- `backend/controllers/eudrChain.controller.js`
- `backend/controllers/eudrInventory.controller.js`
- `backend/controllers/eudrReview.controller.js` (new)
- `backend/controllers/item.controller.js`
- `backend/controllers/sample.controller.js`
- `backend/routers/eudrChain.routes.js`

**Backend data and services**

- `backend/helpers/timberSpecies.js` (new)
- `backend/models/eudrAllocation.model.js`
- `backend/models/eudrChain.model.js`
- `backend/models/eudrInventory.model.js`
- `backend/models/eudrParty.model.js`
- `backend/models/eudrReview.model.js` (new)
- `backend/models/item.model.js`
- `backend/models/order.model.js`
- `backend/models/sample.model.js`
- `backend/models/vendor.model.js`
- `backend/services/eudrChain.service.js`
- `backend/services/eudrInventory.service.js`
- `backend/services/eudrQuantity.service.js`
- `backend/services/eudrMetadata.service.js` (new)
- `backend/services/eudrProviders.service.js` (new)
- `backend/services/eudrReport.service.js` (new)
- `backend/services/eudrReview.service.js` (new)
- `backend/services/eudrReviewMigration.service.js` (new)
- `backend/services/eudrReviewRecords.service.js` (new)
- `backend/services/eudrSourceWrites.service.js` (new)
- `backend/scripts/eudrInventoryMigration.js`

**Frontend**

- `client/OMS/src/pages/EudrTimber.jsx`
- `client/OMS/src/components/EditPisModal.jsx`
- `client/OMS/src/components/EditSampleModal.jsx`
- `client/OMS/src/components/SampleModal.jsx`
- `client/OMS/src/components/samples/SampleCreateModal.jsx`
- `client/OMS/src/components/eudr/EudrChainView.jsx`
- `client/OMS/src/components/eudr/InventoryCommon.jsx`
- `client/OMS/src/components/eudr/InventoryEditor.jsx`
- `client/OMS/src/components/eudr/InventoryRecordActions.jsx`
- `client/OMS/src/components/eudr/ReviewPanel.jsx` (new)
- `client/OMS/src/components/eudr/ReviewWorkspace.jsx` (new)
- `client/OMS/src/components/eudr/TimberMetadataFields.jsx` (new)
- `client/OMS/src/components/eudr/eudr.css`

**Tests and documentation**

- `backend/tests/eudrStageSupport.gate.test.js` (new; retained diagnostics)
- `backend/tests/eudrReview.test.js` (new)
- `backend/tests/eudrReview.integration.js` (new)
- `backend/tests/eudrReview.browser.js` (new)
- `backend/tests/eudrMigrationCli.test.js` (URI argument validation follow-up)
- `backend/tests/eudrChain.test.js` (legacy fixture flag)
- `backend/tests/eudrSales.test.js` (legacy fixture flag)
- `backend/tests/itemTimberCftPis.test.js` (legacy fixture flag)
- `backend/tests/sampleConversion.test.js` (legacy fixture flag)
- `backend/tests/eudrInventory.integration.js` (session-aware query fixture)
- `docs/EUDR_REVIEW_SOLVER_GATE.md` (new; historical finding and resolution)
- `docs/EUDR_REVIEW_IMPLEMENTATION.md` (new; this guide)
- `docs/EUDR_CURRENT_CONTEXT.md` (links the new optional layer)

Generated verification artifacts are in `output/eudr-review/`; normal production
build artifacts are in the ignored frontend `dist/` directory. No new dependency
was added.
