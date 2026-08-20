# OMS Knowledge Base

## Scope

This is the Step 1 static OMS knowledge catalog. It records verified repository knowledge so a future integration can select safe, canonical read paths. It does not call models, controllers, databases, APIs, queues, or the Assistant; it changes no OMS or Assistant behavior.

Machine-readable catalog and lookup service:

- `backend/knowledge/omsKnowledgeBase.catalog.js`
- `backend/knowledge/omsKnowledgeBase.schema.js`
- `backend/services/omsKnowledgeBase.service.js`

The catalog is versioned (`1.0.0`), frozen at load time, and validates its identifiers, references, aliases, source-of-truth rules, relationships, certainty values, and repository-relative source paths without importing those source files.

## Discovery Coverage

The discovery pass used source files as authority. `docs/api-map.md` and `docs/api-map.xlsx` were checked as route/client-use indexes; the workbook has the same six analysis sections as the Markdown map and added no separate business taxonomy.

| Area | Static inventory reviewed |
| --- | ---: |
| Backend model files | 36 / 36 (34 persistence models plus workflow shared/index modules) |
| Backend controllers | 28 / 28 |
| Backend routers | 23 / 23 |
| Backend services | 43 / 43 |
| Backend helpers | 32 / 32 |
| Backend middleware | 8 / 8 |
| Backend queues / realtime / workers | 2 / 2 / 1 |
| Backend scripts | 42 / 42 |
| Backend tests | 53 / 53 |
| Client pages / components / services / API / utils | 67 / 65 / 10 / 2 / 29 |
| Deploy files / checked-in docs | 5 / 13 |

The catalog itself covers 14 domains, 34 persistence collections, 28 capabilities, 24 relationships, 14 business definitions, five legacy-data notes, and five audit findings. Source paths are validated during the knowledge-base test suite.

## Domain and Collection Coverage

| Domain | Collections represented | Primary read topics |
| --- | --- | --- |
| Order management | `orders`, `order_edit_logs` | order list, lifecycle, status, ETD, archive |
| Shipment and logistics | `orders`, `items`, `qcs`, `inspections` | shipment rows, containers, Packed Goods, CBM |
| Quality control | `qcs`, `inspections`, `inspectors`, `qc_edit_logs` | QC requests, inspection evidence, QA reports |
| Catalog and master data | `items`, `brands`, `vendors`, `finishes` | items, vendors, brands, finish assets |
| Product information | `items`, `product_type_templates`, `pis_update_logs` | PIS, master, Product Database, comparisons |
| Samples | `samples`, `sample_workflows` | samples, shipped samples, conversion |
| Workflow | seven `workflow_*` collections | batches, tasks, assignments, history, comments |
| Complaints | `complaints`, `complaint_categories` | complaint list and item context |
| Communication | `notifications`, `emaillogs` | user notifications and email logs |
| Access and security | `users`, `rolepermissions`, `auth_sessions`, security collections | documented only; sensitive |
| Audit and history | upload/order/QC/PIS logs | historical evidence, not live state |
| Assistant platform | Assistant conversation/rate buckets | documented only; not business data |

## Capability Coverage

All catalogued capabilities are marked `read_only`; `assistantStatus` records whether they are future Step 2 candidates or intentionally documented-only.

| Capability group | Catalog capability IDs | Canonical source type |
| --- | --- | --- |
| Orders | `order_list`, `order_progress`, `etd_reports`, `archived_orders` | live collection plus `orderStatus` helper/report handlers |
| Shipment | `packed_goods`, `shipping_pending`, `shipments`, `containers`, `shipment_cbm` | canonical report query/services |
| QC and inspection | `qc_list`, `qc_reports`, `inspection_reports` | live collections/report handlers |
| Item/PIS/Product Database | `item_catalog`, `pis_data`, `product_database`, `product_type_templates` | item collection/helpers/templates |
| Partners and finishes | `partner_master_data`, `finishes` | master collections/controllers |
| Samples | `samples`, `sample_workflow` | sample collections/controllers |
| Workflow and complaints | `workflow_tasks`, `complaints` | live collections/controllers |
| Report/export infrastructure | `monthly_shipments`, `pdf_exports` | dedicated service |
| Communication/history | `notifications`, `email_logs`, `audit_logs` | documented; access-sensitive/history caveats |
| Existing Assistant internals | `assistant_forecasts` | documented only; not rewired |

Use `searchCapabilities()` for deterministic metadata lookup across capability IDs, names, descriptions, keywords, domains, and aliases. It has no embedding, network, database, or model dependency.

## Packed Goods: Verified End-to-End Trace

| Layer | Verified implementation |
| --- | --- |
| UI | `client/OMS/src/pages/PackedGoods.jsx` fetches `GET /orders/packed-goods`; it locally filters/sorts/paginates the returned report rows and recomputes display totals. |
| API route | `GET /orders/packed-goods` and `GET /orders/packed-goods/export`; both require authenticated order access (`orders.view` / `orders.export`). |
| Router | `backend/routers/orders.routes.js` |
| Controller | `backend/controllers/order.controller.js#getPackedGoods`, `#exportPackedGoods` |
| Canonical dataset | `buildPackedGoodsDataset` in the same controller. This is shared by the API and XLS/XLSX export but is not a reusable service export. |
| Data/joins | Active `orders` with populated `qcs`, item lookup in `items`, and `deriveOrderProgress`. |
| Row condition | Rows exist only where `inspected_unshipped_quantity > 0`. |
| Filters | brand(s), vendor, PO aliases (`order_id`, `order`, `po`), and inclusive order-date range. |
| Outputs | order/item/brand/vendor, order/packed/pending quantities, PO pending flag, total/per-item CBM, `cbm_source`, filter options, and summary. |
| CBM | `resolveOrderRowCbmSummaryWithStoredFallback`: calculated measurement data is preferred; stored `orders.total_po_cbm` is a final fallback. |

The catalog therefore treats Packed Goods as a `canonical_report_query`, not merely raw order data. Any later response must keep the distinction between raw measurements, derived progress, and the stored-CBM fallback visible.

## Key Source-of-Truth Rules

| Rule | Canonical source | Important caveat |
| --- | --- | --- |
| Live order facts | `orders` | edit/archive logs are historical evidence only |
| Current PO progress | `deriveOrderProgress` | do not rely only on stored `orders.status` |
| Packed Goods | `buildPackedGoodsDataset` | controller-local helper; route/API boundary is currently safest |
| Shipment/PO CBM | `shipmentCbmAllocation` + `orderCbm` | stored `total_po_cbm` is cached/fallback |
| Current QC state | `qcs` + `inspections` | QC edit logs are not live state |
| PIS/master comparison | Item array-backed fields and documented helpers | master is Final PIS Check reference when present; PIS is fallback |
| Vendor identity | `vendorRef` normalized embedded references | preserve document vendor snapshot context |
| Workflow state | `workflow_tasks` | assignment/status/comment collections add history/evidence |

## Relationships and Data Caveats

The catalog records 24 typed relationships. High-value examples are:

- `orders.qc_record -> qcs._id`, `qcs.order -> orders._id`, and `qcs.inspection_record[] -> inspections._id`.
- `orders.item.item_code`, `qcs.item.item_code`, and `complaints.item_code` logically join `items.code`.
- Operational documents embed normalized vendor snapshots (`vendor.vendor_id -> vendors._id`); the snapshot name/country remains useful historical context.
- `vendors.brands[].brand_id -> brands._id`; by contrast, `orders.brand -> brands.name` is a name snapshot and marked `strongly_inferred` rather than a physical reference.
- Workflow task-to-batch/type/department/assignment/history/comment links are explicit ObjectId relationships.

Legacy data notes cover vendor-object backfills, barcode aliases, legacy measurement fallbacks, stored order CBM, and historical inspection snapshots. Each entry includes a source/migration path and certainty level.

## Audit Findings

1. Packed Goods’ API and workbook export consistently use one builder, but that builder is controller-local. Step 2 should use a deliberately designed read-only adapter or route contract, not import controller internals.
2. `PackedGoods.jsx` presents the fetched dataset with browser-side filtering/sorting/summary. That is presentation duplication, not a competing source of truth.
3. A client shipping utility derives grouped PO display status. Any future Assistant path should use `backend/helpers/orderStatus.js` semantics.
4. Stored order CBM can diverge from current measurement-based CBM; generated answers must label fallback use.
5. `api-map` documentation is a static index; source code settles route and behavior questions.

## Programmatic Usage

```js
const kb = require("../services/omsKnowledgeBase.service");

kb.searchCapabilities("goods ready"); // Packed Goods
kb.getCapability("packed_goods");
kb.getCollectionKnowledge("orders");
kb.getRelationshipsForCollection("qcs");
kb.getBusinessDefinition("po");
kb.validateKnowledgeBase();
```

Available functions are `getKnowledgeBase`, `getDomain`, `getCollectionKnowledge`, `getCapability`, `listCapabilities`, `searchCapabilities`, `getRelationshipsForCollection`, `getBusinessDefinition`, and `validateKnowledgeBase`.

## Maintenance

When adding or changing OMS behavior:

1. Update catalog metadata in the same change as a new collection, important report, route, source-of-truth rule, or legacy alias.
2. Add the concrete file path and symbol to `sources`; the validator checks paths without importing application modules.
3. Use `verified` only where source directly demonstrates the claim, `strongly_inferred` for conventions/snapshots, and `unknown` when discovery cannot establish it.
4. Add an alias only when it is unambiguous; aliases are globally unique after normalization.
5. Run `npm test` from `backend`; `backend/tests/omsKnowledgeBase.test.js` checks catalog validity, source paths, references, deterministic search, aliases, and Packed Goods metadata.

## Step 2: Explicitly Deferred

Step 2 must first choose permission-aware, read-only adapters for each capability and define response provenance/uncertainty behavior. In particular, it must respect existing data access controls and avoid controller imports for Packed Goods. It must not expose sensitive access/security/notification/email data by default.

No Assistant tool, prompt, provider, route, UI, model query, deployment setting, or business logic is wired to this Knowledge Base in Step 1.
