# OMS Knowledge Base

## Scope

This is the Step 2 OMS knowledge catalog and Assistant integration contract. The catalog remains static and read-only, while the Assistant uses its metadata to preselect relevant business capabilities and route canonical questions through an explicit server-side adapter registry before considering raw MongoDB.

Machine-readable catalog and lookup service:

- `backend/knowledge/omsKnowledgeBase.catalog.js`
- `backend/knowledge/omsKnowledgeBase.schema.js`
- `backend/services/omsKnowledgeBase.service.js`

The catalog is versioned (`1.1.0`), frozen at load time, and validates its identifiers, references, aliases, source-of-truth rules, relationships, certainty values, Assistant status, and repository-relative source paths without importing those source files.

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

All catalogued capabilities are marked `read_only`; every capability now has one explicit `assistantStatus`: `tool_eligible`, `existing_assistant_feature`, or `documented_not_tool_eligible`.

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
| Existing Assistant internals | `assistant_forecasts` | deterministic existing Assistant feature; ready CBM now comes from Packed Goods |

Use `searchCapabilities()` for deterministic metadata lookup across capability IDs, names, descriptions, keywords, domains, and aliases. It has no embedding, network, database, or model dependency.

Explicit Assistant classification:

- `tool_eligible`: `packed_goods`, `monthly_shipments`.
- `existing_assistant_feature`: `order_list`, `order_progress`, `shipments`, `containers`, `shipment_cbm`, `item_catalog`, `pis_data`, `partner_master_data`, `samples`, `assistant_forecasts`.
- `documented_not_tool_eligible`: `shipping_pending`, `etd_reports`, `archived_orders`, `qc_list`, `qc_reports`, `inspection_reports`, `product_database`, `product_type_templates`, `sample_workflow`, `workflow_tasks`, `complaints`, `finishes`, `pdf_exports`, `notifications`, `email_logs`, `audit_logs`.

## Packed Goods: Verified End-to-End Trace

| Layer | Verified implementation |
| --- | --- |
| UI | `client/OMS/src/pages/PackedGoods.jsx` fetches `GET /orders/packed-goods`; it locally filters/sorts/paginates the returned report rows and recomputes display totals. |
| API route | `GET /orders/packed-goods` and `GET /orders/packed-goods/export`; both require authenticated order access (`orders.view` / `orders.export`). |
| Router | `backend/routers/orders.routes.js` |
| Controller | `backend/controllers/order.controller.js#getPackedGoods`, `#exportPackedGoods` |
| Canonical dataset | `backend/services/packedGoods.service.js#buildPackedGoodsDataset`, shared by the API, XLS/XLSX export, Assistant adapter, and forecast readiness input. |
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
| Packed Goods | `packedGoods.service.js#buildPackedGoodsDataset` | one shared dataset; calculated measurements first and stored CBM only as fallback |
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

1. Packed Goods' API, workbook export, Assistant adapter, and shipment-readiness forecasts now use one shared service builder.
2. `PackedGoods.jsx` presents the fetched dataset with browser-side filtering/sorting/summary. That is presentation duplication, not a competing source of truth.
3. A client shipping utility derives grouped PO display status; Assistant canonical paths use `backend/helpers/orderStatus.js` semantics instead.
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

const { executeOmsCapability } = require("../services/omsCapabilityExecution.service");
await executeOmsCapability({
  capability: "packed_goods",
  filters: { brands: ["By Boo"] },
  operation: { type: "summary" },
});
```

Available functions are `getKnowledgeBase`, `getDomain`, `getCollectionKnowledge`, `getCapability`, `listCapabilities`, `searchCapabilities`, `getRelationshipsForCollection`, `getBusinessDefinition`, and `validateKnowledgeBase`.

## Maintenance

When adding or changing OMS behavior:

1. Update catalog metadata in the same change as a new collection, important report, route, source-of-truth rule, or legacy alias.
2. Add the concrete file path and symbol to `sources`; the validator checks paths without importing application modules.
3. Use `verified` only where source directly demonstrates the claim, `strongly_inferred` for conventions/snapshots, and `unknown` when discovery cannot establish it.
4. Add an alias only when it is unambiguous; aliases are globally unique after normalization.
5. Run `npm test` from `backend`; `backend/tests/omsKnowledgeBase.test.js` checks catalog validity, source paths, references, deterministic search, aliases, and Packed Goods metadata.

## Step 2 Assistant Integration

```text
question
  -> deterministic Knowledge Base search (top relevant capabilities only)
  -> Gemini receives compact, server-controlled capability context
  -> use_oms_capability executes an explicit allowlisted adapter
  -> optional safe raw MongoDB and deterministic analytics
  -> concise evidence-based answer
```

`backend/services/omsCapabilityExecution.service.js` is the only capability execution registry. It contains no dynamic module loading from catalog paths. Tool arguments are validated against capability-specific filters, group fields, numeric metrics, sort fields, and a 100-row maximum. Results carry safe filters, summaries, bounded rows/groups, warnings, provenance, and actual internal database-call counts.

Packed Goods and Monthly Shipments are tool-eligible. Existing Assistant query/report/forecast paths remain available for the capabilities they already cover. Communication, audit, export, workflow mutation-adjacent, and other unsuitable capabilities remain metadata-only. `notifications` and `email_logs` cannot be executed through the capability tool, and the raw-query denied-collection policy is unchanged.

For an obvious Packed Goods or Monthly Shipments question, a model attempt to use raw MongoDB is intercepted: the server runs the canonical capability first and returns guidance that MongoDB may only supplement the result. Questions with no strong capability match can still use schema inspection and the existing bounded read-only MongoDB tool.

Schema inspection now includes bounded Knowledge Base relationships, business definitions, capability status, and canonical source-of-truth notes without exposing source file paths or record values. Forecasts use Packed Goods grouped results as current ready CBM and union those vendors/brands with open-order candidates.
