# OMS support for EUDR V2

Implemented on `codex/eudr-v2-oms-20261021-133917` after the legacy cleanup. OMS owns ordinary product metadata, species, vendors and stuffed shipment facts. EUDR owns rules/wastage, chains, declarations, purchase invoices, batches, evidence and verification. No legacy integration module, model wrapper, watcher, metadata-write bridge or old endpoint was restored.

## Product data and administrative interface

The existing item create/edit dialogs now contain **Wood composition and finished volume**:

- Search the OMS wood species catalog and select one or more stable species IDs.
- Enter percentages with up to two decimal places. A complete composition must have unique species and total exactly 100%. Storage reuses `species_composition: [{species: ObjectId, share_bp: integer}]` with 10,000 basis points representing 100%.
- Enter finished wood contained in **one product**, using CFT or m³. No manufacturing wastage is included. Changing units converts the entered value, and a conversion preview is shown.
- Select **No wood content** to record zero volume with an empty composition. Blank volume means unknown; neither case invents wood volume. Empty composition can also record metadata that is not yet complete. EUDR skips explicitly zero-volume, empty-composition products and blocks incomplete positive-volume requirements.
- Edit the existing `hs_code` field. Four to eight digits are accepted, with single spaces/dots normalized away.

No parallel item master or EUDR metadata screen was created. Existing `POST /items` multipart/PIS-upload validation and rollback remain; metadata is included in that same operation. Authorized `PATCH /items/:id` now accepts ordinary wood metadata. PIS and sample endpoints remain compatible. Item permission and brand/vendor access checks still apply.

Canonical finished volume remains the existing numeric `timber_cft`, now validated at **six CFT decimal places**, with a maximum safely representable integer number of micro-CFT. A new optional `timber_volume_input: {value: string, unit: "cft" | "m3"}` retains the original entry. The input contract is `finished_wood_volume: {value: string, unit: "cft" | "m3"}`; do not also supply `timber_cft` in the same request. Existing callers can continue using `timber_cft`, including null/blank to clear it.

The exact factor is **1 CFT = 0.028316846592 m³**. Backend conversion uses decimal integer arithmetic and rounds once, half up, to six canonical CFT decimals. m³ input accepts up to 12 decimals. Positive input below canonical precision is rejected. Existing three-decimal values do not change. Normal shipment reports retain their three-decimal display totals but now multiply the precise per-unit volume by stuffed quantity before rounding, so small per-unit values are not prematurely lost.

`timber_cft_history` remains server-authored and records prior/new CFT, time and actor; ordinary item update history also records metadata edits and original-unit changes. Sample-to-item conversion preserves CFT, composition, HS code and original unit input. Existing species references can be retained when inactive or awaiting migration; newly added references must identify active OMS catalog rows. Client-provided volume history cannot be written.

### Wood species master

**Settings → Wood Species** is the normal OMS administrative page. Administrators with `settings.manage` can add/edit/deactivate species. Item-authorized users can search/read the catalog. There is no delete endpoint, so referenced species cannot be accidentally removed through the API.

`WoodSpecies` uses the new OMS-owned `wood_species` collection:

```js
{ _id: ObjectId, name: String, scientific_name: String,
  active: Boolean, createdAt: Date, updatedAt: Date }
```

Common and scientific names are required, whitespace-normalized and limited to 160 characters. Separate case-insensitive unique indexes prevent duplicate common or scientific identities. The ID is immutable. There are no manufacturing-yield or wastage fields, and the administrative write API rejects unrelated fields.

Normal endpoints:

- `GET /wood-species?query=...&limit=50`: active species, search common/scientific name.
- `GET /wood-species?includeInactive=true&ids=id1,id2`: retain exact referenced choices when editing; at most 100 IDs/results.
- `POST /wood-species`: `{name, scientific_name, active?}`.
- `PATCH /wood-species/:id`: changes to those same identity/status fields.

### Preserving pre-existing species IDs

Prompt 1 intentionally retained the old species reference data because products referenced its IDs. `backend/scripts/migrateWoodSpecies.js` provides a separate, explicit, **non-destructive** migration to the OMS catalog. It preserves each `_id`, name, scientific name, active status and available timestamps; missing timestamps use the import time. It never copies legacy wastage/yield fields, updates existing OMS identities, removes references, drops collections or runs on startup.

Use an explicitly supplied private `OMS_SPECIES_MIGRATION_URI` selecting the intended OMS database. The script does not load application env files. First run a dry-run, review missing/duplicate identities, back up the target database, then apply during the deployment maintenance window:

```powershell
node backend/scripts/migrateWoodSpecies.js
node backend/scripts/migrateWoodSpecies.js --apply
```

The default is read-only. Duplicate identities or missing required scientific names require human resolution; no names or replacement species IDs are invented. Apply inserts missing IDs only and can be rerun. The retained legacy catalog stays archived for recovery; active OMS code reads only `wood_species`. All other business records and species references remain intact.

## V2 resource API

The dedicated module is `backend/integrations/eudrV2.*`. The prefix is `/integrations/eudr/v2`. Responses use the **actual standalone EUDR adapter's top-level contract**, rather than duplicating large payloads under a second `data` wrapper.

### Container search

`GET /integrations/eudr/v2/containers?query=...&page=1&limit=25`

```js
{ containers: [{ key, number, stuffingDate, exportInvoiceNumbers,
    vendors: [{id, name}], shipmentLineCount }],
  pagination: {page, limit, total} }
```

Search is a literal, escaped, case-insensitive partial container-number match. Query length is 1–80 characters, page 1–1000 and page size 1–100. It searches positive actual shipment quantities in both orders and samples; ordered quantities and zero-quantity placeholder shipments are excluded. Access restrictions are applied before grouping or returning container numbers. Identical source shipment IDs count once in search summaries. Search invoice/vendor summaries are bounded to 100 entries; a snapshot gives the complete authorized grouping.

### Container snapshot

`GET /integrations/eudr/v2/containers/:containerKey`

```js
{
  revision: "sha256:<digest>", hash: "<digest>",
  container: {key, number, stuffingDate, stuffingDates, exportInvoiceNumber?},
  groups: [{
    key, brand, exportInvoiceNumber,
    vendor: {id, name, gstin, pan},
    items: [{
      shipmentKey, source, sourceId, shipmentId, stuffingDate, brand,
      itemId, itemCode, description, quantity,
      finishedCftPerUnit: "0.500000", hsCode,
      speciesComposition: [{speciesId, shareBps}]
    }]
  }]
}
```

All values come from the selected OMS records. Missing product fields remain blank/null so EUDR can flag them for completion; carton CBM is never substituted for wood volume. For a sample shipment, its own sample document/ID supplies product metadata. Vendor IDs resolve against the authoritative vendor directory; name-only legacy references must resolve uniquely. A sample with multiple possible vendors fails with `SOURCE_VENDOR_AMBIGUOUS` instead of multiplying or guessing ownership. Unresolved/deleted vendor identities fail explicitly.

Container keys encode the trimmed, uppercase container number. Shipment keys are `order:<documentId>:<shipmentId>` or `sample:<documentId>:<shipmentId>`, independent of quantity, array position or item code. Identical duplicate contributions are counted once; conflicting duplicate identities fail. Positive stuffed quantities must be safe whole units. Different shipment rows remain distinct even when item codes are the same.

Groups are keyed deterministically by **vendor ID + export invoice + brand**, not item contents. Brand separation is necessary when one exporter/invoice serves multiple account scopes. A single-group container also exposes its invoice on `container`; multiple invoices/exporters/dates are never silently collapsed into one owner or date. Each line retains its original source/shipment IDs and stuffing date.

Snapshot reads use one read-only MongoDB snapshot transaction across shipments, product metadata and vendors. Orders and samples are read sequentially inside that transaction; MongoDB forbids `$unionWith` in a transaction. Search can use `$unionWith` outside a transaction. No source records are written by these APIs. A replica set or mongos is required for consistent snapshots.

### Species catalog

`GET /integrations/eudr/v2/species`

```js
{ revision: "sha256:<digest>",
  species: [{id, name, commonName, scientificName, active: true}] }
```

Only active OMS species are returned, sorted by stable ID. `name` and `commonName` project the same existing common-name field to satisfy both contracts; they are not duplicate database fields. Wastage values are never returned or stored by OMS. Deactivation changes the catalog revision and blocks new selections; existing product references survive.

### Revisions, limits and indexes

The checksum is SHA-256 over recursively key-sorted normalized source facts. Groups, shipment lines and composition arrays are sorted by stable identity. It includes grouping, source IDs, quantities, dates, vendor name/GSTIN/PAN, item identity/description, CFT, HS code and composition. Fetch time and database update timestamps are not proofs of identity and are not added to the digest. `revision` is the same content identity with a `sha256:` prefix. Refresh detects additions, removals and changes; unchanged facts return unchanged identities.

Reads use narrow projections, batch item/vendor queries, linear identity maps and five-second MongoDB query limits. Snapshots are bounded to 10,000 positive shipment lines and the EUDR adapter's 2 MB response budget; oversized requests fail explicitly without truncating a snapshot. Species are bounded to 10,000. Partial substring search has a bounded execution time; no search service or change-stream infrastructure was added.

Orders and samples declare case-insensitive container indexes plus shipment-ID and embedded vendor-ID indexes; orders also index item code. Exact snapshot lookups use the matching case-insensitive collation. `items.code` already has its authoritative unique index. Species have unique name/scientific-name indexes. Authentication collections have unique `_id` identities and expiry indexes.

## Authentication and authorization

Generate a **new** shared secret of at least 32 characters for OMS and the new EUDR server. Never reuse the deleted bridge secret or share OMS JWT signing secrets. Business-source endpoints are read-only; there is no arbitrary collection API or metadata-write integration endpoint.

### Browser handoff

1. Open EUDR's `/eudr-tool/api/auth/launch`, also linked by **Open EUDR** in OMS for users with V2 access. EUDR creates a short-lived, single-use state and state cookie.
2. EUDR redirects to OMS `GET /integrations/eudr/v2/auth/launch?state=<64 lowercase hex>`.
3. OMS authenticates with its existing cookie/token. If login is required, it redirects to the configured OMS frontend. Sign-in and brand choice preserve only the validated V2 state and resume the fixed launch endpoint; arbitrary return/callback URLs are not accepted.
4. OMS checks the current account and permissions, generates a 32-byte random code with a 60-second expiry, and stores only its SHA-256, account, state, selected scope and configured audience in `oms_v2_handoffs`.
5. A CSP-nonce-protected HTML form POSTs code/state to the **fixed** configured EUDR `/eudr-tool/api/auth/callback`. Codes never enter URLs or browser history.
6. EUDR consumes its state, signs a server request to `POST /integrations/eudr/v2/auth/redeem` with `{code,state,audience}`, and OMS atomically consumes the matching unexpired code once. Current account/grants are checked again.
7. EUDR creates its own opaque session. A replay, expiry, state/audience mismatch or revoked account fails. No EUDR password is created in OMS.

### Signed requests

Every server endpoint requires `X-EUDR-Timestamp` (Unix milliseconds), `X-EUDR-Nonce` (16 random bytes as lowercase hex), `X-EUDR-Actor` (account ID for container endpoints, empty for catalog/redeem/user checks), and `X-EUDR-Signature`. HMAC-SHA256 signs these exact six newline-separated values, without a trailing newline:

```text
METHOD
EXACT_PATH_AND_QUERY
TIMESTAMP
NONCE
ACTOR_OR_EMPTY
SHA256_OF_EXACT_RAW_BODY_BYTES
```

Comparison is timing-safe. Timestamps outside ±30 seconds are rejected. Nonces are atomically inserted into `oms_v2_nonces` and retained for at least 65 seconds so a replay fails throughout the accepted window. GET bodies are empty; POST uses JSON. Integration JSON is bounded to 4 KB, and parse/size errors return safe machine-readable errors without logging body fragments. Launch and redemption are rate-limited. Responses are private/no-store and errors log only non-sensitive codes.

### Current account and scope context

`GET /integrations/eudr/v2/auth/users/:id` returns:

```js
{ user: { id, name, active: true,
  permissions: ["eudr:read", "eudr:write", "eudr:review", "eudr:rules"],
  allVendors, vendorIds, allBrands, brandNames, brandScope, omsScope } }
```

The exact grants depend on current OMS permissions. The **EUDR V2 access** module in ordinary Rights Management maps `view → read`, `edit → write`, `approve → review`, and `manage → rules`. Existing administrative profiles receive defaults through the normal permission system; ordinary user/QC/viewer profiles do not gain EUDR access automatically. Existing account deletion, false `active`/`is_active`, unresolved brand restrictions and revoked grants deny access.

`omsScope` is a short-lived opaque OMS-signed context binding account ID and the selected OMS brand view. It is not an OMS access token. EUDR persists it only with its session and sends `X-EUDR-Scope` for current-user and container requests. OMS verifies its signature, expiry and account binding, then intersects it with the **current** account restrictions. The context's signing key remains private to OMS. Missing/edited contexts fail closed.

The original standalone contract carried only a user ID after login; that lost the selected brand view. The matching EUDR adapter/session changes retain this context and explicit brand restrictions. EUDR also filters saved chains and invoice/evidence ownership through current brand/vendor scopes, so access cannot leak merely because one manufacturer supplies multiple brands. Both applications must be deployed together.

No email, password hash, phone, full user document or arbitrary sensitive OMS collection is exposed. EUDR rechecks the current projection for every authenticated request, including file downloads. Permission revocation takes effect without waiting for session expiry.

## Configuration and deployment

OMS backend (private environment):

```dotenv
OMS_V2_BRIDGE_SECRET=<new-private-secret-at-least-32-characters>
EUDR_V2_PUBLIC_URL=https://oms.example/eudr-tool/
OMS_PUBLIC_URL=https://oms.example/
```

Normal OMS `JWT_SECRET`, auth cookies, `MONGO_URI` and CORS settings remain in use. A blank V2 bridge secret disables integration requests without preventing ordinary OMS startup. Production URLs must be HTTPS. Keep both apps on the same site, as required by the EUDR SameSite=Lax POST-handoff cookie design. Public URLs must have no credentials, query or fragment, and the EUDR path must be `/eudr-tool/`.

OMS frontend: `VITE_EUDR_V2_URL=/eudr-tool/` for the normal shared-site deployment, or the absolute local EUDR app URL during development. Keep `VITE_API_BASE_URL` pointed at OMS. **Never put a bridge/JWT secret in a VITE variable.** EUDR backend uses the same fresh `OMS_V2_BRIDGE_SECRET`, its OMS API origin in `OMS_V2_BASE_URL`, and the identical EUDR audience in `APP_PUBLIC_URL`. Its MongoDB database remains separately named `eudr_v2`.

Before deployment:

1. Back up both applications and databases. Review the additive species migration if existing composition IDs need preserving; run its dry-run and resolve missing/duplicate names before apply. The old destructive cleanup tool is not part of this deployment.
2. Deploy the OMS and matching EUDR changes together. Verify vendor directory brand associations, since scoped vendor projections use authoritative directory associations.
3. Ensure the OMS MongoDB is a replica set/mongos, and the application account can create the new normal catalog/auth indexes. Plan initial index builds for the database size. No hidden destructive migration runs on startup.
4. Configure private backend variables, cookie domains/Secure settings and public URLs. Build both frontends. Use the existing OMS and EUDR startup/deployment procedures; do not restore old bridge installation scripts or old `/eudr` mounts.
5. Verify HMAC access, fresh login, the chosen brand view, a real authorized container and a denied out-of-scope container. Set approved species wastage in **EUDR Rules**, not OMS.

The matching EUDR implementation and contract changes are in the accessible sibling `D:/dev/repos/eudr`; see that project's `docs/OMS_V2_CONTRACT.md`. Existing unrelated work in that checkout was preserved. Production configuration, data migration and deployment were not executed by this implementation.

## Tests and end-to-end results

Unit and integration commands from the OMS root:

```powershell
npm --prefix backend test
npm --prefix client/OMS test
npm --prefix client/OMS run build
npm --prefix D:/dev/repos/eudr/backend test
npm --prefix D:/dev/repos/eudr/client run build

# The browser workflow uses an isolated frontend bundle and real local APIs.
$env:VITE_API_BASE_URL='/api'
npm --prefix client/OMS run build -- --outDir ../../.tmp/v2-oms-dist
Remove-Item Env:VITE_API_BASE_URL
$env:LABEL_TEST_MONGOD='C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe'
$env:AQL_TEST_MONGOD=$env:LABEL_TEST_MONGOD
node --test backend/tests/aqlPassed.integration.js backend/tests/labelIntegrity.integration.js backend/tests/legacyEudrRemoval.integration.js backend/tests/eudrV2.integration.js
```

Use the installed local mongod path on other hosts. The cross-application test expects the rebuilt EUDR repository beside OMS, both sets of dependencies installed, and an available Puppeteer browser. It starts its own loopback replica set, separate OMS/EUDR databases, both actual API applications, and an OMS static frontend with a local API proxy. It uses no application database URI or production account, and removes its temporary database files/evidence afterward. No live identity provider or success fixture is injected.

The real workflow tested includes OMS browser login/brand choice, adding a species through the administrative page, opening the existing item editor, saving a 60/40 multi-species composition, CFT and HS code, then navigating through the actual EUDR state/code/callback flow and searching/selecting the stuffed container in EUDR's browser interface. The displayed vendor, item, HS code and percentages match the OMS save. Browser screenshots are retained locally in `.tmp/v2-oms-wood.png` and `.tmp/v2-eudr-connected.png`.

The same running applications create a real EUDR chain, manufacturer declaration, uploaded invoice/bilty evidence and a canonical purchase batch. For the calculation check, 100 stuffed units at 0.5 CFT produce 50 CFT finished wood in OMS; a separately saved 20% EUDR wastage rule produces 62.5 CFT required input. OMS never applies wastage. Official GST/PAN/satellite verification remains unconfigured and no chain is falsely certified.

Coverage includes species create/update/deactivate/duplicate prevention; metadata validation and exact conversion; active species selection; partial literal searches; positive stuffed-only quantities; split shipments, sample shipments and stable identities; multiple vendor/invoice/brand groups; deduplication/conflict rejection; deterministic checksums and quantity/composition changes; signed request rejection, stale timestamps, nonce replay, concurrent single-use code redemption, expired codes, account/grant revocation, missing scope contexts, denied scopes including a shared exporter across brands, absent legacy routes, read-only source APIs and normal OMS inspection/QC regressions. Final run results are recorded below.


### Final verification results (2026-10-21)

| Check | Result |
| --- | --- |
| OMS backend unit suite | 634 total; 633 passed, one pre-existing skip, zero failures |
| OMS frontend unit suite | 41 passed |
| EUDR backend unit suite | 11 passed, including new scope and non-wood compatibility checks |
| Existing AQL/label/ordinary-OMS integration plus V2 cross-application integration | 13 passed against disposable local MongoDB instances |
| Final focused metadata/conversion/sample tests after precision checks | 16 passed |
| Final cross-application and browser rerun after migration timestamp validation | Passed; both real applications, real handoff, actual source data, declaration and purchase-batch creation |
| OMS production build and isolated browser-test build | Passed |
| EUDR production frontend build | Passed |
| Legacy-route/browser regression | Passed; retired endpoints absent, normal login/dashboard work |
| Environment, syntax and imports | OMS env check passed; new backend modules parse; 2,203 relative imports resolve (separate EUDR launcher imports also exercised against the real peer app) |
| Whitespace review | git diff --check passed in both repositories |

Both applications were stopped after their isolated test runs. Production application/database credentials, real business records and live storage were not modified. No production species migration or deployment was executed. Real government identity verification remains unconfigured; the test does not claim official verification or chain certification.
