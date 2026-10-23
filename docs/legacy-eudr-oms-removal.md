# Legacy EUDR removal

Historical Prompt 1 report. The new, separate V2 implementation is documented in [EUDR_V2_OMS_INTEGRATION.md](EUDR_V2_OMS_INTEGRATION.md). None of the retired bridge, ledger, review, chain or inventory implementations were restored.

The old embedded module and standalone bridge have been removed from active OMS code. No new integration is implemented. Production databases and object storage were not accessed or changed. The only remaining executable references to EUDR are the manual cleanup tool and removal regression tests.

## Safety and pre-removal inventory

Prepared before deletion on 2026-10-21. Initial branch `main`, clean worktree, commit `03201713396b6c3b8804c4bae3e65c1c9f0db323`. Cleanup branch `codex/legacy-eudr-cleanup-20261021-105307`. Verified full-history Git bundle and source ZIP: `D:/dev/backups/oms-legacy-eudr-20261021-105307/`. No application or production database has been connected to or changed.

Baseline: backend 735 tests, 734 passed, 1 skipped; client 54 passed.

Proposed and subsequently deleted EUDR-only files:

- `backend/controllers/eudrChain.controller.js`
- `backend/controllers/eudrInventory.controller.js`
- `backend/controllers/eudrReview.controller.js`
- `backend/integrations/eudrPlugin.cjs`
- `backend/models/eudrAllocation.model.js`
- `backend/models/eudrChain.model.js`
- `backend/models/eudrInventory.model.js`
- `backend/models/eudrParty.model.js`
- `backend/models/eudrReview.model.js`
- `backend/routers/eudrChain.routes.js`
- `backend/scripts/eudrInventoryMigration.js`
- `backend/services/eudrAllocation.service.js`
- `backend/services/eudrChain.service.js`
- `backend/services/eudrDirectory.service.js`
- `backend/services/eudrFiles.service.js`
- `backend/services/eudrInventory.service.js`
- `backend/services/eudrInventoryMigration.service.js`
- `backend/services/eudrLocalDemo.service.js`
- `backend/services/eudrMetadata.service.js`
- `backend/services/eudrPreview.service.js`
- `backend/services/eudrProviders.service.js`
- `backend/services/eudrQuantity.service.js`
- `backend/services/eudrReport.service.js`
- `backend/services/eudrReview.service.js`
- `backend/services/eudrReviewMigration.service.js`
- `backend/services/eudrReviewRecords.service.js`
- `backend/services/eudrSourceWrites.service.js`
- `backend/tests/eudrAllocation.integration.js`
- `backend/tests/eudrAllocation.test.js`
- `backend/tests/eudrChain.browser.js`
- `backend/tests/eudrChain.test.js`
- `backend/tests/eudrDocuments.test.js`
- `backend/tests/eudrInventory.browser.js`
- `backend/tests/eudrInventory.integration.js`
- `backend/tests/eudrInventory.test.js`
- `backend/tests/eudrLocalDemo.test.js`
- `backend/tests/eudrMigrationCli.test.js`
- `backend/tests/eudrOffice.integration.js`
- `backend/tests/eudrPreview.test.js`
- `backend/tests/eudrQuantity.test.js`
- `backend/tests/eudrReview.browser.js`
- `backend/tests/eudrReview.integration.js`
- `backend/tests/eudrReview.test.js`
- `backend/tests/eudrSales.test.js`
- `backend/tests/eudrStageSupport.gate.test.js`
- `backend/tests/helpers/eudrReplicaSet.js`
- `client/OMS/src/components/eudr/DocumentWorkspace.jsx`
- `client/OMS/src/components/eudr/EudrChainView.jsx`
- `client/OMS/src/components/eudr/EudrDialog.jsx`
- `client/OMS/src/components/eudr/InventoryCommon.jsx`
- `client/OMS/src/components/eudr/InventoryEditor.jsx`
- `client/OMS/src/components/eudr/InventoryRecordActions.jsx`
- `client/OMS/src/components/eudr/InventoryWorkspace.jsx`
- `client/OMS/src/components/eudr/ReviewPanel.jsx`
- `client/OMS/src/components/eudr/ReviewWorkspace.jsx`
- `client/OMS/src/components/eudr/SavedDetails.jsx`
- `client/OMS/src/components/eudr/StageEditor.jsx`
- `client/OMS/src/components/eudr/TimberMetadataFields.jsx`
- `client/OMS/src/components/eudr/documentStore.js`
- `client/OMS/src/components/eudr/eudr.css`
- `client/OMS/src/components/eudr/pdfRuntime.js`
- `client/OMS/src/pages/EudrTimber.jsx`
- `client/OMS/src/utils/eudrContinuation.js`
- `client/OMS/src/utils/eudrContinuation.test.js`
- `client/OMS/src/utils/eudrDocuments.js`
- `client/OMS/src/utils/eudrDocuments.test.js`
- `client/OMS/src/utils/eudrInventory.js`
- `client/OMS/src/utils/eudrInventory.test.js`
- `docs/EUDR_CURRENT_CONTEXT.md`
- `docs/EUDR_INVENTORY_IMPLEMENTATION.md`
- `docs/EUDR_Management_Summary.docx`
- `docs/EUDR_REVIEW_IMPLEMENTATION.md`
- `docs/EUDR_REVIEW_SOLVER_GATE.md`
- `docs/EUDR_Schema_and_System_Design.pdf`
- `docs/build_eudr_context_pdf.py`
- `docs/eudr-timber-trace-reference.html`

Shared files to detach: backend startup, multer, Office preview conversion, item/sample controllers, four source models, timber metadata helper, frontend routes/navigation/sign-in/brand selection, legacy metadata widgets in item/sample forms, shipping/vendor copy, package scripts/dependencies, env examples, deployment notes. Shared auth, queues, workers, notifications, reports, PDF/PIS conversion, permissions and ordinary source records remain.

## Removed endpoints

All `/integrations/eudr/*` and `/eudr/*` registrations are removed. The following original declarations record the full legacy surface, including dynamically registered inventory/document/provider routes:

### backend/integrations/eudrPlugin.cjs

```js
  router.get('/launch', (req,res,next)=>{
  router.post('/redeem', run(async (req, res) => {
  router.get('/users/:id', run(async (req, res) => {
  router.get('/discover', run(async (req, res) => {
  router.get('/snapshot', run(async (req, res) => {
  router.get('/changes', run(async (req, res) => {
  router.put('/metadata/:source/:id',run(async(req,res)=>{
  app.use('/integrations/eudr', router);
  app.use('/eudr', async (req, res, next) => {
```

### backend/routers/eudrChain.routes.js

```js
router.get("/container", controller.lookupContainer);
router.get("/directory", controller.directory);
router.get("/directory/:partyId", controller.directoryDetail);
router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:id", controller.get);
router.patch("/:id/declared", controller.updateDeclared);
router.patch("/:id/contribution", controller.updateContribution);
router.put("/:id/stages/:stageId", controller.saveStage);
router.post("/:id/stages/:stageId/documents", upload.eudrSingle("file"), controller.upload);
router.post("/:id/stages/:stageId/reuse-evidence", controller.reuseEvidence);
router.post("/:id/stages/:stageId/reuse-invoice", controller.reuseInvoice);
router.get("/:id/stages/:stageId/documents/:documentId/url", controller.documentUrl);
router.get("/:id/stages/:stageId/documents/:documentId/content", controller.documentContent);
router.get("/:id/stages/:stageId/documents/:documentId/preview", controller.documentPreview);
router.post("/:id/stages/:stageId/verify", controller.verify);
```

### backend/controllers/eudrReview.controller.js

```js
router.get("/capabilities",run(async()=>({review_layer:enabled()})));
router.get("/species",run(async()=>({species:await R.Species.find({}).sort({name:1}).lean(),rules_revision:(await R.Rules.findById("global").lean())?.revision||0})));
router.post("/species",admin,run(req=>I.withInventory(req.user,async(session,state)=>{
router.patch("/species/:id",admin,run(req=>I.withInventory(req.user,async(session,state)=>{
router.get("/rules",run(async()=>await R.Rules.findById("global").lean()||{revision:0,exporter_wastage_bp:1500,unconfigured:true}));
router.post("/rules/preview",admin,run(async req=>{
router.put("/rules",admin,run(req=>I.withInventory(req.user,async(session,state)=>{
router.get("/parties",run(async()=>({parties:await Party.find({}).sort({name:1}).limit(2000).lean(),vendors:await require("../models/vendor.model").find({deleted_at:null}).select("name gst pan gst_snapshot").limit(2000).lean()})));
router.post("/parties/gst-lookup",run(async req=>{
for(const isVendor of [false,true])router.post(isVendor?"/parties/vendor/:id/gst-check":"/parties/:id/gst-check",run(async req=>{
router.post("/parties",run(async req=>{
router.patch("/parties/:id",run(async req=>{
router.get("/plots",run(async()=>await R.Plot.find({}).sort({createdAt:-1}).limit(2000).lean()));
router.get("/plots/:id",run(async req=>{const plot=await R.Plot.findById(I.objectId(req.params.id)).lean();if(!plot)throw fail("NOT_FOUND","Plot not found",404);return plot;}));
router.post("/plots",run(req=>I.withInventory(req.user,async(session,state)=>{
router.patch("/plots/:id",run(req=>I.withInventory(req.user,async(session,state)=>{
router.post("/plots/:id/satellite-check",run(async req=>{
for(const resource of ["invoices","transfers"])router.post(`/inventory/${resource}/:id/document-checks`,run(async req=>{
router.get("/report",run(()=>report.report()));
router.get("/report.csv",run(async(_req,res)=>{const data=await report.report();res.type("text/csv").attachment("eudr-europe-report.csv").send(data.csv);}));
router.get("/report.geojson",run(async(_req,res)=>{const data=await report.report();res.type("application/geo+json").attachment("eudr-europe-report.geojson").send(JSON.stringify(data.geojson));}));
router.post("/report/submit",run(req=>report.submit(req.body.groups,req.user)));
router.post("/:id/caution",run(req=>I.withInventory(req.user,async(session,state)=>{
router.post("/:id/requests",run(req=>I.withInventory(req.user,async(session,state)=>{const text=String(req.body.text||"").trim();if(!text||text.length>30000)throw fail("REQUEST_TEXT_INVALID","Request text is required and must be at most 30000 characters");const chain=await Chain.findById(I.objectId(req.params.id)).session(session);if(!chain)throw fail("NOT_FOUND","Chain not found",404);chain.history.push({event:"document_request_sent",actor:req.user._id,detail:{text}});await chain.save({session});await I.audit(session,req.user,"request_letter_logged","chain",chain._id,state.revision,{details:{text}});return {logged:true};})));
router.put("/:id/declaration-lines",run(req=>I.withInventory(req.user,async(session,state)=>{
```

### backend/controllers/eudrInventory.controller.js

```js
router.get("/state", run(async (_req,res) => send(res, await M.State.findById("global").lean() || { registry_ready: false })));
router.get("/batches", run(async (req,res) => {
router.post("/batches", run(async (req,res) => send(res, await I.createSource(req.body, req.user), 201)));
router.get("/batches/:id", run(async (req,res) => {
router.get("/batches/:id/lineage", run(async (req,res) => send(res, await lineage(req.params.id))));
router.get("/batches/:id/commitments", run(async (req,res) => {
  router.get(`/${resource}`, run(async (req,res) => {
  router.get(`/${resource}/:id`, run(async (req,res) => { const record = await Model.findById(I.objectId(req.params.id)).lean(); if (!record) throw Q.error("NOT_FOUND", "Inventory record not found", null, 404); send(res, record); }));
router.post("/invoices", run(async (req,res) => send(res, await I.registerInvoice(req.body, req.user), 201)));
router.post("/transfers", run(async (req,res) => send(res, await I.createTransfer(req.body, req.user), 201)));
router.patch("/transfers/:id", run(async (req,res) => send(res, await I.editDraft(req.params.id, req.body, req.user))));
router.post("/transfers/:id/reserve", run(async (req,res) => send(res, await I.reserveTransfer(req.params.id, req.user))));
router.post("/mixes", run(async (req,res) => send(res, await I.createMix(req.body, req.user), 201)));
router.post("/:resource/:id/verify", run(async (req,res) => send(res, await I.verify(req.params.resource, req.params.id, req.body, req.user))));
router.patch("/:resource/:id/correction", sensitive, run(async (req,res) => send(res, await I.correct(req.params.resource, req.params.id, req.body, req.user))));
router.post("/:resource/:id/cancel", sensitive, run(async (req,res) => send(res, await I.cancel(req.params.resource, req.params.id, req.body, req.user))));
router.post("/commitments", run(async (req,res) => send(res, await I.reserve(req.body, req.user), 201)));
router.post("/commitments/:id/release", sensitive, run(async (req,res) => send(res, await I.release(req.params.id, req.body, req.user))));
router.post("/reconcile", run(async (req,res) => {
router.post("/migration/review-network", sensitive, run(async(req,res)=>send(res,await I.reviewLegacyNetwork(req.body,req.user))));
router.get("/conflicts", run(async (req,res) => {
router.get("/audit", run(async (req,res) => {
router.get("/documents", run(async (req,res) => {
router.post("/documents", require("../config/multer.config").eudrSingle("file"), exports.uploadDocument);
for (const action of ["url", "content", "preview"]) router.get(`/documents/:id/${action}`, run(async (req,res) => {
```


## Database classification and retained data

This inventory is derived from the actual removed schemas, bridge, and callers. It is not a claim that these collections exist in production. The read-only cleanup command inventories the selected database's actual collection UUIDs, counts and indexes before any deletion can be approved.

| Category | Structures | Decision |
| --- | --- | --- |
| A: exclusive legacy state | eudr_allocations, eudr_chains, eudr_parties, eudr_documents, eudr_invoices, eudr_source_batches, eudr_timber_lots, eudr_timber_transfers, eudr_timber_mixes, eudr_timber_commitments | Eligible for explicit manual deletion only |
| A: exclusive review state | eudr_inventory_audit, eudr_migration_reviews, eudr_inventory_state, eudr_rules, eudr_plots, eudr_production_proof_ownership, eudr_report_submissions | Eligible for explicit manual deletion only |
| A: exclusive bridge state | eudr_login_codes, eudr_source_changes, eudr_plugin_ownership, eudr_bridge_state | Eligible for explicit manual deletion only |
| A: exclusive fields on shared records | eudr_review_fence on items, samples, orders and vendors; gst_snapshot on vendors | Only these fields are eligible for manual unset. gst_snapshot was the old provider verification result; the actual gst and pan fields remain |
| B: product metadata | items/samples: hs_code, species_composition, timber_cft, timber_cft_history, material/wood fields, package net weights | Preserved in schemas, ordinary write paths and existing records; sample conversion copies HS code and composition without an integration flag |
| B: species identities | eudr_species and its indexes | Preserved because item/sample species_composition stores its IDs. The old species model and API are deleted; OMS no longer queries or populates this catalog. Keeping this reference data prevents loss of the meaning of existing composition records |
| C: ordinary source data | orders, items, vendors, samples, users, brands, shipments, containers, inspections, QC, packing, labels, reports and normal audit/history data | Preserved. None of these collections can be dropped by the cleanup tool |
| Unclassified | Any other collection, including unknown eudr_* names | Never deleted. Unknown names are listed separately in the manifest for later investigation |

All indexes belonging to dropped category A collections disappear with those collections, including the login-code expiry index, allocation/container/vendor/invoice indexes, directory identities, inventory identities and review/report indexes. No shared collection indexes are dropped. No shared schema introduced an index on the removed fence/snapshot fields.

The shared timberSpecies helper now only retains metadata schemas, structural validation, HS normalization, and CFT history. It has no feature flags, species-model lookup, ledger lock, EUDR transaction or review-state requirement. Species IDs remain opaque ObjectIds with unique positive basis-point shares totaling 10000; no new species directory is implemented. Existing PIS/item audit logs and save error handling remain.

Removed EUDR-only metadata controls no longer call capabilities/species endpoints from ordinary forms. Existing HS/composition values in those forms' payloads are retained. Vendor GST/PAN inputs and ordinary shipping timber-volume calculations remain, with integration-specific wording removed.

Object-storage evidence and previews are deliberately retained. No storage objects, upload directories or business files are deleted. Any future evidence purge needs its own storage inventory, verified backup, reference review and approval.

## Configuration, dependencies and deployment

- Removed both startup mounts, including the bridge watcher and login-code TTL-index creation. The source-model save/query/insert/bulk-write monkey patches and ledger fences are gone.
- Removed EUDR-only multer handling and Office-preview conversion/sandbox code. Ordinary PIS Excel-to-PDF conversion and its error handling remain.
- Removed backend test/migration package scripts for the old review and inventory implementation.
- Removed EUDR_REVIEW_LAYER, EUDR_PROVIDER_MODE, EUDR_CFT_M3_FACTOR, EUDR_BRIDGE_SECRET and EUDR_PLUGIN_PUBLIC_URL from the backend example.
- Removed obsolete local EUDR variables from ignored backend/.env and client/OMS/.env.local after copying those files to the private backup directory. Values were never printed. Other deployments' actual environment files still need the operator cleanup below.
- Removed frontend pdfjs-dist and its unused lockfile entries. adm-zip remains used by PIS synchronization and QC archive tests; pdf-parse remains used by normal PDF/report tests. No shared dependency was removed.
- Removed old EUDR deployment instructions and exclusive technical documents/builders. Their originals remain recoverable in Git and the backup.
- Inspected the API entrypoint, workers, queues, cron services, CI, deployment workflow, PM2 ecosystem, deployment shell scripts, backup scripts and checked-in Nginx config. No other EUDR mount, queue, cron registration, proxy location or dependency was found there. Shared auth/session/permissions, Redis jobs, notifications and security cron remain.

Before production deployment, retire EUDR_BRIDGE_SECRET in both services and their secret stores. Remove EUDR_PLUGIN_PUBLIC_URL, VITE_EUDR_PUBLIC_URL, OMS_SIGNIN_URL and all EUDR_* flags/URLs/demo/provider settings from the deployed OMS environment and rebuild the frontend. Old ignored environment copies contain credentials and must remain private. Do not rotate shared JWT, MongoDB, Redis, Wasabi or Google credentials solely for this removal; if any were separately issued exclusively to the abandoned application, revoke those dedicated credentials after checking for shared users.

Deploy using the existing OMS procedure; there is no automatic database migration. Inspect the live host's Nginx and PM2 configurations for manually installed /eudr-tool/ proxy locations or standalone services: those are outside this checkout and were not changed here. Retire them only after confirming they belong exclusively to the old application. The updated OMS does not contact them.

## Manual database cleanup (not executed)

The script is backend/scripts/removeLegacyEudr.js. It never reads application env files and never defaults to an application URI. Use a protected shell to set LEGACY_EUDR_CLEANUP_URI; never paste a production URI or secret into logs, this document or source control. Use the exact database name below instead of the illustrative oms.

1. Stop every old/new app instance, standalone tool, worker and other writer for the target database. Keep the maintenance window through backup, review and apply. The cleanup spans multiple drops and cannot be made atomic; on failure, inspect the partial result and generate a new manifest before resuming.
2. Make a full database archive using mongodump with --gzip --archive and the selected URI/database. Restore it into an isolated scratch MongoDB instance, verify business-record counts, indexes, representative records and stored file references, and record that verification separately. The code bundle is not a database backup. Preserve the archive and its SHA256 checksum in a secure location.
3. Generate a read-only deletion manifest using an account with read/list-index privileges. The output path must not exist; put it outside the repo. No collection/index creation or modification occurs in this mode.

~~~powershell
# From backend/, with the dedicated URI already securely set:
node scripts/removeLegacyEudr.js --database oms --manifest D:/secure/oms-legacy-removal.json
Get-FileHash -Algorithm SHA256 D:/secure/oms-legacy-removal.json
Get-FileHash -Algorithm SHA256 D:/secure/oms-before-cleanup.archive.gz
~~~

4. Separately review the manifest: database, target-host fingerprint, collection UUIDs, document counts, indexes, exact field unsets, unclassified collections and retained species. Confirm ownership and backup restoration, and record approval for that exact manifest checksum. Never add ordinary collections or wood/HS fields to the deletion list.
5. Only after that review and explicit execution-time approval, run the following in an interactive terminal, replacing checksum placeholders with the verified values:

~~~powershell
node scripts/removeLegacyEudr.js --database oms --manifest D:/secure/oms-legacy-removal.json --apply --approved-manifest-sha256 REVIEWED_MANIFEST_SHA256 --backup D:/secure/oms-before-cleanup.archive.gz --backup-sha256 VERIFIED_BACKUP_SHA256 --backup-restore-verified
~~~

The flag attests that a human restored and checked the database archive; checksum matching alone cannot prove a valid/restorable MongoDB backup. The script checks both checksums, requires an interactive terminal, re-inventories the allowlist/host/database/UUIDs/counts/indexes, and requires the operator to type REMOVE LEGACY EUDR FROM oms immediately before execution. A stale/edited manifest or absent confirmation fails closed. The fixed allowlist cannot drop the database, species, orders, items, vendors, users or unknown collections. No unattended production apply was attempted.

6. Re-inventory after apply. Confirm the approved collections are absent, fence/snapshot fields are unset, ordinary source records and species are unchanged, then restart OMS and repeat the login/business smoke checks. Retain the backup and reviewed manifest. Collection drops and field unsets are not reversible without that backup.

## Code backup and rollback

The original main worktree was clean, so the source ZIP captures all tracked source files. The verified full-history bundle includes original refs and commit 03201713396b6c3b8804c4bae3e65c1c9f0db323. The local ignored env files changed during cleanup have private copies alongside it; unrelated ignored files were not modified. Test logs and the deletion inventory are saved in that directory as well.

To inspect/recover the original code without overwriting current work:

~~~powershell
git clone D:/dev/backups/oms-legacy-eudr-20261021-105307/oms-before-cleanup.bundle D:/dev/recovered-oms
# In the recovered clone:
git switch --detach 03201713396b6c3b8804c4bae3e65c1c9f0db323
~~~

For deployment rollback, use the original commit, matching locked dependencies and securely saved deployment configuration, then rebuild/restart using the existing deployment process. If database cleanup has been applied, first restore and validate the archived category A collections/fields during a maintenance window; reconcile writes made since the backup so ordinary OMS data is not overwritten. Do not run a whole-database drop/restore over current business records. Live proxy/service removals require their own saved configuration if rollback is needed.

## Verification

Baseline before deletion: npm --prefix backend test reported 735 tests, 734 passed, 1 skipped; npm --prefix client/OMS test reported 54 passed. The first integration attempt failed because mongod was not on PATH. MongoDB was then found at C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe and subsequent integration checks use that explicit path and disposable loopback databases.

Final results and limitations are recorded below after the final verification run.


| Check | Result |
| --- | --- |
| Backend unit suite: npm --prefix backend test | 630 tests; 629 passed, 1 existing skip, 0 failures |
| Frontend unit suite: npm --prefix client/OMS test | 39 passed, 0 failures |
| Database integration: AQL, label integrity, removal/startup | 12 passed using isolated local MongoDB instances |
| Frontend production build: npm --prefix client/OMS run build | Passed after removing pdfjs-dist |
| Browser smoke: node backend/tests/legacyEudrRemoval.browser.js | Both sign-in paths (with/without brand selection) reach the dashboard; no EUDR UI, requests or page errors. Uses API fixtures; backend behavior is verified separately by the integration test |
| Env validation: node backend/scripts/check-env.js | Passed without legacy variables |
| Source/syntax/import checks | No legacy references in active code, no unresolved relative imports, changed backend entry/helper/converter/cleanup script parse successfully, git diff --check passed |
| Build output | No EUDR chunks or old PDF worker assets |

The reduced unit-test totals reflect removal of tests for the deleted application; ordinary OMS tests remain. Added regression coverage rejects tampered/stale deletion manifests, unknown business-field deletion and noninteractive apply, validates shared metadata, checks absent model wrappers/routes/imports, and preserves product data during actual isolated cleanup. The real CLI dry-run was exercised against the disposable database before apply and did not mutate it.

The startup integration boots the actual backend with a disposable replica set and test credentials, signs in through HTTP/cookies, creates/edits a vendor, edits PIS data, creates/edits an order with a QC-approved shipment, creates/edits a sample, reads containers/shipments/packed goods/QC/dashboard/report endpoints, and confirms old endpoints return 404. It also drops a test legacy collection and its index while comparing the full retained item document and ordinary collection counts. Existing AQL and serial-label integration suites exercise inspection and QC persistence/validation. HS-only PIS edits and sample-to-item metadata preservation have targeted tests.

To repeat database checks from backend/ on Windows:

~~~powershell
$env:AQL_TEST_MONGOD='C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe'
$env:LABEL_TEST_MONGOD=$env:AQL_TEST_MONGOD
node --test tests/aqlPassed.integration.js tests/labelIntegrity.integration.js tests/legacyEudrRemoval.integration.js
node tests/legacyEudrRemoval.browser.js
~~~

On other hosts point those variables to a local mongod binary. Build the frontend before running the browser test and install/use an available Puppeteer browser.

Not performed: production deployment, live-host proxy/service edits, production database inventory/deletion/restore, object-storage deletion, or manual testing with real business accounts. Those operations remain intentionally separate. The production database archive and reviewed deletion manifest must be created and approved by the operator; the verified code backup does not authorize production deletion.
