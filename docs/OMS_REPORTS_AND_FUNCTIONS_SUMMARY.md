# OMS Reports & Business Functions — Complete Source Discovery

**Audit basis:** repository source as of 2026-08-20. **Mode:** source-code-only; no live or production data was queried. **Scope guard:** this document records existing behavior and recommendations only. No OMS business behavior, OMS Assistant integration, or Knowledge Base catalog was changed.

## 1. Executive Summary

OMS currently exposes a much larger read/report surface than the Assistant catalog suggests: 74 distinct capability groups across orders, logistics, QC, item/PIS/Product Database, vendor/brand, samples, workflow, complaints, audit, communication, and control-plane domains. The strongest reusable sources are the shared Packed Goods service, Monthly Shipments service, order-progress helper, shipment/PO CBM allocation services, valid-inspection-history service, and workflow services. Most other reports are correct-looking but implemented inside controllers, so they should be extracted before being exposed as deterministic Assistant capabilities.

The most important source-of-truth rule is that current order status is derived from order quantity, QC passed quantity, shipment quantity, and open QC-request state by `deriveOrderProgress`; stored `orders.status` is not consistently authoritative for analytics. Likewise, current calculated CBM should come from inspected measurements first, PIS measurements second, and stored `orders.total_po_cbm` only as a labelled fallback.

The audit found several material risks:

- `emailLogs.routes.js` is complete and the UI calls it, but `backend/index.js` never imports or mounts it; all `/email-logs` UI reads currently 404.
- `order.controller.js` assigns `exports.exportDelayedPoReport` twice. The later reformed export silently replaces the earlier rich export, leaving a dead implementation with different semantics.
- Several reports still prefilter or aggregate with stored order status even though canonical status is derived. Monthly Shipments, Item Database “running PO”, and the QC vendor report are the clearest cases.
- “Delayed PO”, “Shipping Delay”, and frontend “overdue pending” are three different business definitions. They must not share an Assistant intent without explicit routing.
- Final PIS Check is actually an **Inspected-versus-Master** comparison, requires three distinct valid inspected POs, and does not implement the Knowledge Base’s stated PIS fallback. Several internal response names still say `pis` for Master values.
- Shipment list endpoints omit supported stuffing-date filters; Containers passes them to the same internal shipment builder.
- A static mismatch-flow document says item-size tolerance is 1 cm, while executable code uses 0.5 cm.

## 2. Discovery Coverage

### 2.1 Required documentation reviewed

- `docs/OMS_SOURCE_TREE.md`
- `docs/OMS_KNOWLEDGE_BASE.md`
- `docs/OMS_ASSISTANT_CONTEXT.md`
- `docs/OMS_ASSISTANT.md`
- `docs/api-map.md`
- `docs/api-map.xlsx`, inspected read-only as native OpenXML. It contains six sheets: API Summary (226 rows including header), API Details (226), Frontend Usage (236), Unused Backend APIs (30), Missing Backend Routes (7), and Duplicate Similar APIs (42). The generated map is navigation evidence, not current truth.

### 2.2 Source areas scanned

| Area | Files inventoried | Audit use |
|---|---:|---|
| Backend routers | 23 | All route declarations, middleware, permissions, mount aliases |
| Backend controllers | 28 | Handler behavior, local report builders, filters, outputs, exports |
| Backend services | 46 | Reusable datasets, CBM, workflow, notification, Assistant adapters |
| Backend helpers | 32 | Derived status, comparison, error, measurement, vendor and date rules |
| Backend models | 36 | Stored fields, collection names, references, indexes, legacy aliases |
| Backend tests | 55 | Executable expectations and regression coverage |
| Frontend pages | 67 | Routes, calls, local filtering/sorting/totals and presentation rules |
| Frontend components | 65 | Navigation, report/export composition and shared UI behavior |
| Frontend service/API modules | 12 | Concrete HTTP callers and parameter names |
| Frontend utilities | 29 | Client-side status, shipping, CBM and chart derivations |
| Frontend tests | 8 | Client business/presentation rules |

The audit scanned 133 backend `GET` declarations. Four belong to the unmounted Email Logs router, leaving 129 declarations reachable through a primary mount before counting `/api/*` aliases. Routers mounted twice (`reports`, `jobs`, `permissions`, `notifications`, `complaints`, `security`, `oms-chat`, and `qc-images`) intentionally expose additional alias URLs.

### 2.3 Report/report-like frontend pages counted

The exact page count is **57**. A page is counted when its primary surface reads, filters, aggregates, drills into, or presents business/history data; create-only, sign-in, scope-choice, settings-only, shipment-entry, template-management, and the Assistant consumer page are excluded. Counted pages are:

`ArchivedOrders`, `CommonErrorsReport`, `Complaints`, `Containers`, `DailyReport`, `DailySummary`, `DelayedPoReports`, `EmailLogs`, `FinalPISCheck`, `Finishes`, `Home`, `InspectedItemsReport`, `inspection_report`, `InspectorReports`, `ItemDatabase`, `ItemDetails`, `ItemFilesPage`, `ItemMasters`, `ItemOrdersHistory`, `Items`, `MonthlyShipmentsReport`, `OpenOrders`, `OrderEditLogs`, `Orders`, `OrdersByBrand`, `PackedGoods`, `PendingPoReport`, `PIS`, `PISDiffs`, `PisInspectionMasterComparison`, `PisUpdateLogs`, `PoStatusReport`, `ProductAnalytics`, `ProductDatabase`, `ProductDatabaseDetails`, `QcDetails`, `QcPage`, `QcReportMismatch`, `Samples`, `SampleWorkflow`, `SecurityDashboard`, `Shipments`, `ShippedSamples`, `ShippingDelayReports`, `ShippingPending`, `UpcomingEtdReports`, `UploadLogs`, `VendorDetails`, `VendorReports`, `VendorWiseQAReport`, `WeeklySummary`, `WorkflowBatchDetail`, `WorkflowBatches`, `WorkflowDashboard`, `WorkflowMyTasks`, `WorkflowTasks`, and `WorkflowUploadPending`.

### 2.4 Test evidence

There are **63** test files and **354** `test`/`it` cases across backend and frontend. Relevant direct coverage exists for order status, delayed PO logic, archived restore status, vendor summary, item export PO status, monthly shipments, inspector approved-goods CBM, inspected items, common inspection errors, QC mismatch selection, valid inspection history, PIS/barcode rules, samples, finishes, workflow source filters, and frontend shipping/monthly/status utilities. Many controller-local reports lack focused calculation tests; see Section 21.

## 3. Master Capability Index

Source classes used below: `CANONICAL`, `CANONICAL_WITH_FALLBACK`, `DERIVED_HELPER`, `RAW_COLLECTION`, `PRESENTATION_ONLY`, `DUPLICATED_LOGIC`, `UNCLEAR`. Assistant recommendations are the requested eight fixed classes.

| ID | Business capability | Type | Frontend surface | Backend route(s) | Canonical function/service | Main collections | R/W | Source class | Assistant recommendation |
|---|---|---|---|---|---|---|---|---|---|
| ORD-01 | Active order lines and filtered order list | Operational read | Orders, OpenOrders | `GET /orders`, `/orders/filters` | `getOrdersByFiltersDb`; `deriveOrderProgress` | orders, qcs, items | Read | CANONICAL_WITH_FALLBACK | CAPABILITY_PLUS_MONGO |
| ORD-02 | Open/inspected/shipped PO buckets | Dashboard/read model | OpenOrders, Home | `GET /orders/filters` | `buildPoBucketDataset` | orders, qcs, items | Read | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| ORD-03 | Order/PO detail | Detail | Orders | `GET /orders/order-by-id/:id` | `getOrderById` | orders, qcs, items | Read | CANONICAL_WITH_FALLBACK | CAPABILITY_PLUS_MONGO |
| ORD-04 | PO status report | Report | PoStatusReport | `GET /orders/po-status-report` | `getPoStatusReport`; order-status helper | orders, qcs | Read | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| ORD-05 | Pending PO report | Report/export | PendingPoReport | `GET /orders/pending-po-report`, `/export` | `buildPendingPoReportDataset` | orders, qcs | Read/export | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| ORD-06 | Delayed PO report | Report/export | DelayedPoReports | `GET /orders/delayed-po-report`, `/export` | `buildReformedDelayedPoReportDataset` | orders, qcs | Read/export | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| ORD-07 | Upcoming ETD report | Report/export | UpcomingEtdReports | `GET /orders/upcoming-etd-report`, `/export` | `buildUpcomingEtdReportDataset` | orders, qcs | Read/export | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| ORD-08 | Shipping Delay report | Report/export | ShippingDelayReports | `GET /orders/shipping-delay-report`, `/export` | `buildUpcomingEtdReportDataset({shippingDelay:true})` | orders, qcs | Read/export | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| ORD-09 | Revised ETD history | History | Orders | `GET /orders/revised-etd-history` | `getRevisedEtdHistory` | orders | Read | RAW_COLLECTION | RAW_MONGO |
| ORD-10 | Today-ETD dashboard | Dashboard | Home | `GET /orders/today-etd-orders`, `/:brand/today-etd-orders` | `getTodayEtdOrdersByBrand` | orders, qcs, items | Read | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| ORD-11 | Brand/vendor status dashboard and drilldown | Dashboard/drilldown | Home, OrdersByBrand | `GET /orders/:brand/vendor-summary`, `/brand/:brand/vendor/:vendor/status/:status` | `getVendorSummaryByBrand`; `getOrdersByBrandAndStatus` | orders, qcs, items | Read | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| ORD-12 | Archived orders | History/current archive state | ArchivedOrders | `GET /orders/archived` | `getArchivedOrders`; `attachArchivedRestoreStatus` | orders, qcs | Read | CANONICAL_WITH_FALLBACK | RAW_MONGO |
| ORD-13 | Order upload/import logs | Audit report | UploadLogs | `GET /orders/upload-logs` | `getUploadLogs` | upload_logs | Read | RAW_COLLECTION | NOT_ASSISTANT_SAFE |
| ORD-14 | Order edit/archive logs | Audit report | OrderEditLogs | `GET /orders/edit-logs` | `getOrderEditLogs` | order_edit_logs | Read | RAW_COLLECTION | NOT_ASSISTANT_SAFE |
| ORD-15 | Previous-order lookup and order-entry options | Support read | Upload/order entry | `GET /orders/previous-order-check`, `/manual-options`, `/brands-and-vendors` | `lookupPreviousOrder`; `getManualOrderOptions`; option handler | orders, qcs, vendors, brands | Read supporting writes | CANONICAL_WITH_FALLBACK | NOT_ASSISTANT_SAFE |
| SHP-01 | Packed Goods | Inspection-period report/export | PackedGoods | `GET /orders/packed-goods`, `/export` | `packedGoodsPeriod.service#buildPackedGoodsPeriodDataset` | inspections, qcs, orders, items | Read/export | CANONICAL_WITH_FALLBACK | NOT_ASSISTANT_SAFE |
| SHP-02 | Shipping Pending | Report/export | ShippingPending | `GET /orders/shipping-pending`, `/export` | `buildShippingPendingDataset` | orders, qcs | Read/export | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| SHP-03 | Shipment rows | Operational report/export | Shipments | `GET /orders/shipments`, `/export` | `getShipmentDataset` | orders, samples, qcs, items | Read/export | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| SHP-04 | Container aggregation | Operational report | Containers | `GET /orders/containers` | `getContainerDataset` | orders, samples, qcs, items | Read | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| SHP-05 | Monthly Shipments and drilldown | Canonical report | MonthlyShipmentsReport | `GET /reports/monthly-shipments`, `/drilldown` | `monthlyShipmentsReport.service` | orders, items | Read | CANONICAL_WITH_FALLBACK | DIRECT_CAPABILITY |
| SHP-06 | PO/shipment/sample CBM allocation | Calculation service | Used across logistics/QC reports | No standalone read route | `orderCbm.service`; `shipmentCbmAllocation.service`; `boxMeasurement` | orders, items, samples | Derived | CANONICAL_WITH_FALLBACK | DIRECT_CAPABILITY |
| QC-01 | QC request list | Operational read | QcPage | `GET /qc/list` | `getQCList`; derived inspection status | qcs, orders, inspections, users | Read | CANONICAL_WITH_FALLBACK | CAPABILITY_PLUS_MONGO |
| QC-02 | QC detail and inspection report | Detail/report | QcDetails, inspection_report | `GET /qc/:id` | `getQCById` | qcs, orders, inspections, items, users, complaints | Read + related mutations | CANONICAL_WITH_FALLBACK | CAPABILITY_PLUS_MONGO |
| QC-03 | QC list workbook | Export | QcPage | `GET /qc/export` | `exportQCList` | qcs, orders, inspections, items, users | Export | DUPLICATED_LOGIC | EXPORT_ONLY |
| QC-04 | Daily QC report | Report | DailyReport | `GET /qc/daily-report` | `getDailyReport` | qcs, inspections, orders, items, users | Read | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| QC-05 | Inspector performance report | Report | InspectorReports | `GET /qc/reports/inspectors` | `getInspectorReports` | inspections, qcs, orders, items, users | Read | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| QC-06 | Vendor shipping performance | Report | VendorReports | `GET /qc/reports/vendors` | `getVendorReports` | orders | Read | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| QC-07 | Weekly order/QC summary | Report | WeeklySummary | `GET /qc/reports/weekly-summary` | `getWeeklyOrderSummary` | inspections, qcs, orders, items, users | Read | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| QC-08 | Daily order/QC summary | Report | DailySummary | `GET /qc/reports/daily-summary` | `getDailyOrderSummary` | inspections, qcs, orders, users | Read | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| QC-09 | Vendor-wise QA summary | Report | VendorWiseQAReport | `GET /reports/vendor-wise-qa/summary` | `getVendorWiseQaSummary` | inspections, qcs, orders, items, users | Read | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| QC-10 | Vendor-wise QA detail | Report | VendorWiseQAReport | `GET /reports/vendor-wise-qa/detailed` | `getVendorWiseQaDetailed` | inspections, qcs, orders, items, users | Read | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| QC-11 | Inspected-items readiness | Report/export | InspectedItemsReport | `GET /reports/inspected-items`, `/export` | `getInspectedItemsReportDataset` | items, orders, qcs, vendors | Read/export | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| QC-12 | Common inspection errors | Report/export | CommonErrorsReport | `GET /reports/common-errors`, `/export` | `buildCommonErrorsReportDataset`; `evaluateCommonInspectionErrors` | inspections, qcs, orders | Read/export | DERIVED_HELPER | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| QC-13 | QC report mismatch | Report | QcReportMismatch | `GET /reports/qc-report-mismatch` | mismatch aggregation; `compareInspectionSizeSnapshot` | inspections, qcs, orders, items | Read + comment writes | DERIVED_HELPER | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| ITM-01 | Item catalog | Master-data read | Items | `GET /items` | `getItems` | items, qcs | Read | CANONICAL | CAPABILITY_PLUS_MONGO |
| ITM-02 | Item catalog + current-running-PO workbook | Export/report | Items | `GET /items/export` | `getItemsExportDataset`; `buildItemPoStatusSummary` | items, orders, qcs | Export | DUPLICATED_LOGIC | EXPORT_ONLY |
| ITM-03 | Accepted item masters | Master-data read | ItemMasters | `GET /items/masters` | `getItemMasters` | items | Read | CANONICAL | RAW_MONGO |
| ITM-04 | Item detail and file availability | Detail | ItemDetails, ItemFilesPage | `GET /items/:itemCode/details`, file URL routes | `getItemDetails`; file-response helpers | items, orders, qcs, finishes | Read/file download | CANONICAL_WITH_FALLBACK | CAPABILITY_PLUS_MONGO |
| ITM-05 | Item order presence and order/inspection history | History/read | ItemOrdersHistory | `GET /items/:itemCode/order-presence`, `/orders-history` | `getItemOrderPresence`; `getItemOrdersHistory` | items, orders, qcs, inspections | Read | CANONICAL_WITH_FALLBACK | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| ITM-06 | PIS catalog and PIS-file view | Master-data/presentation | PIS | `GET /items`, `/:itemId/pis-file-url` | `getItems`; Item PIS fields | items | Read/file download | CANONICAL | CAPABILITY_PLUS_MONGO |
| ITM-07 | Unchecked PIS differences | Derived report | PISDiffs | `GET /items/pis-diffs` | `getPisDiffItems`; PIS-diff helpers | items, inspections, qcs | Read | DERIVED_HELPER | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| ITM-08 | Checked PIS difference report | Report/export | PISDiffs | `GET /items/pis-diffs/export-preview`, `/export` | `getCheckedPisDiffRowsForReport` | items, inspections, qcs | Read/export | DERIVED_HELPER | EXPORT_ONLY |
| ITM-09 | Final PIS Check (Inspected vs Master) | Derived report | FinalPISCheck | `GET /items/final-pis-check`, `/options` | `finalPisCheck`; `validInspectionHistory.service` | items, qcs, inspections, orders | Read + comments/master writes | DERIVED_HELPER | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| ITM-10 | Final PIS Check report | Report/export | FinalPISCheck | `GET /items/final-pis-check/export-preview`, `/export` | `buildFinalPisCheckReportPayload` | items, qcs, inspections, orders | Read/export | DERIVED_HELPER | EXPORT_ONLY |
| ITM-11 | PIS / latest inspections / Master comparison | Comparison report | PisInspectionMasterComparison | `GET /items/pis-inspection-master-comparison`, `/:code/...` | `buildComparisonRows`; comparison handlers | items, orders, inspections | Read | DERIVED_HELPER | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| ITM-12 | Product Database | Master-data workflow report/export | ProductDatabase | `GET /items/product-database`, `/export` | `buildProductDatabaseRow`; completion helpers | items, product_type_templates | Read/export + approval writes | DERIVED_HELPER | CAPABILITY_PLUS_MONGO |
| ITM-13 | Item Database composite | Composite report/export/detail | ItemDatabase, ProductDatabaseDetails | `GET /items/item-database`, `/export`, `/:id` | `getItemDatabaseDataset` | items, orders, qcs, inspections | Read/export | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| ITM-14 | Product Analytics | Analytics report | ProductAnalytics | `GET /items/product-analytics` | `groupProductAnalyticsRows`; `processOrderAnalyticsRow` | orders, qcs, inspections | Read | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| ITM-15 | PIS/Product/Master update history | Audit report | PisUpdateLogs | `GET /items/pis-update-logs` | `getPisUpdateLogs` | pis_update_logs | Read | RAW_COLLECTION | NOT_ASSISTANT_SAFE |
| ITM-16 | Product Type Templates | Configuration read | ProductTypeTemplates | `GET /product-type-templates`, `/:key` | template controller/helpers | product_type_templates | Read + admin writes | CANONICAL | RAW_MONGO |
| VEN-01 | Vendor master list and workbook | Master-data read/export | VendorDetails | `GET /vendors`, `/export` | `getVendors`; `exportVendors` | vendors, brands | Read/export | CANONICAL | CAPABILITY_PLUS_MONGO |
| VEN-02 | Brand/vendor option sets | Support read | Many forms/reports | `GET /vendors/brand-options`, `/orders/brands-and-vendors` | vendor/option handlers | vendors, brands, orders | Read | CANONICAL | RAW_MONGO |
| VEN-03 | Brand identity, logo, calendar | Master-data/config read | Home and report branding | `GET /brands`, `/logo`, `/:name/logo`, `/:name/calendar` | brand controller | brands | Read/binary | CANONICAL | RAW_MONGO |
| VEN-04 | Finish catalog | Master-data read | Finishes, ItemDetails | `GET /finishes` | `getFinishes` | finishes, items, vendors | Read | CANONICAL_WITH_FALLBACK | RAW_MONGO |
| VEN-05 | Finish vendor/item options and images | Support/presentation | Finishes | `GET /finishes/vendor-options`, `/vendor-items`, image routes | finish controller | finishes, items, vendors | Read/binary | PRESENTATION_ONLY | PRESENTATION_ONLY |
| SAM-01 | Sample catalog | Operational read | Samples | `GET /samples` | `getSamples` | samples, vendors, brands | Read + related writes | CANONICAL | RAW_MONGO |
| SAM-02 | Shipped samples | Shipment report | ShippedSamples | `GET /samples/shipped` | `flattenSampleShipmentRows` | samples | Read | DERIVED_HELPER | EXTRACT_TO_SERVICE_THEN_CAPABILITY |
| SAM-03 | Separate sample workflow list | Operational read | SampleWorkflow | `GET /sample-workflows` | `getSampleWorkflows` | sample_workflows | Read + create | CANONICAL | RAW_MONGO |
| WF-01 | Workflow dashboard | Admin dashboard | WorkflowDashboard | `GET /workflow/dashboard` | `workflowStatusService#getWorkflowDashboardSummary` | workflow_tasks, users | Read | CANONICAL | NOT_ASSISTANT_SAFE |
| WF-02 | Workflow batches and batch detail | Operational read | WorkflowBatches, WorkflowBatchDetail | `GET /workflow/batches`, `/:id` | `workflowBatchService` | workflow_batches, workflow_tasks, users | Read + mutations | CANONICAL | NOT_ASSISTANT_SAFE |
| WF-03 | Workflow task board/list | Operational read | WorkflowTasks, MyTasks, UploadPending | `GET /workflow/tasks` | `workflowStatusService#listWorkflowTasks` | workflow_tasks, workflow_batches, users | Read + mutations | CANONICAL | NOT_ASSISTANT_SAFE |
| WF-04 | Workflow task detail/history/comments | Detail/history | Workflow task dialogs/detail | `GET /workflow/tasks/:id` | `buildTaskDetail` | workflow_tasks, assignments, status_history, comments | Read + mutations | CANONICAL | NOT_ASSISTANT_SAFE |
| WF-05 | Workflow assignable users | Sensitive option read | Workflow pages | `GET /workflow/users` | `getWorkflowAssignableUsers` | users | Read | RAW_COLLECTION | NOT_ASSISTANT_SAFE |
| WF-06 | Workflow task types and departments | Configuration read | WorkflowTaskTypes, WorkflowDepartments | `GET /workflow/task-types`, `/departments` | workflow services/controllers | workflow_task_types, workflow_departments, users | Read + management | CANONICAL | NOT_ASSISTANT_SAFE |
| CMP-01 | Complaint list and detail | Operational/sensitive read | Complaints | `GET /complaints`, `/:id` | `getComplaints`; `getComplaintById` | complaints | Read + mutations | CANONICAL | NOT_ASSISTANT_SAFE |
| CMP-02 | Item-related complaints | QC support read | QC/item complaint panels | `GET /complaints/item-related` | `getItemRelatedComplaints` | complaints, items | Read + comments/read receipts | CANONICAL | NOT_ASSISTANT_SAFE |
| CMP-03 | Complaint categories | Configuration read | Complaints | `GET /complaints/categories` | `getComplaintCategories` | complaint_categories | Read + create | CANONICAL | NOT_ASSISTANT_SAFE |
| OTH-01 | Notifications, workflow dock, summaries | User-scoped communication | Navbar/dock | `GET /notifications`, `/summary`, `/login-summary` | `notificationService` | notifications, workflow_tasks, users | Read + state writes | CANONICAL | NOT_ASSISTANT_SAFE |
| OTH-02 | Email logs and create/filter options | Sensitive communication | EmailLogs | Intended `GET /email-logs*` (router unmounted) | email log controller | emaillogs, orders, brands, vendors | Read + writes | UNCLEAR | NOT_ASSISTANT_SAFE |
| OTH-03 | Shared PDF rendering/status | Export infrastructure | Report pages | PDF render POST under reports, items and QC; `GET /reports/pdf/status` | `pdfRenderer` | None; submitted markup | Export | PRESENTATION_ONLY | EXPORT_ONLY |
| OTH-04 | Queue/job status | Operational control | Async upload/export UI | `GET /jobs/:queueName`, `/:queueName/:jobId` | jobs controller/queue service | Redis/BullMQ queues | Read + retry write | CANONICAL | NOT_ASSISTANT_SAFE |
| SEC-01 | Identity, user list, current session | Access control | Signin, users | `GET /auth`, `/auth/me` | auth controller | users, auth_sessions | Read + auth writes | RAW_COLLECTION | NOT_ASSISTANT_SAFE |
| SEC-02 | Role permissions and per-user data access | Access-control configuration | PermissionManagement | `GET /permissions`, `/me`, `/users/access` | permission service/controller | rolepermissions, users | Read + writes | CANONICAL | NOT_ASSISTANT_SAFE |
| SEC-03 | Security monitoring, Google OAuth, Assistant platform | Control plane | SecurityDashboard; no business report surface | `GET /security/*`, `/google/*`; `/oms-chat` is POST | security services; OAuth route; Assistant services | security logs/alerts/baselines, users, Assistant stores | Read + writes | RAW_COLLECTION | NOT_ASSISTANT_SAFE |

## 4. Order Management Reports

### ORD-01 — Active order lines and filtered order list

- **Representative questions:** “List open orders for brand X”; “Show PO 123 and its items”; “Which orders are Under Inspection?”
- **Trace:** `Orders.jsx`/`OpenOrders.jsx` → `/orders` or `/orders/filters` → `getOrders`/`getOrdersByFiltersDb` → orders with populated QC and item measurement context. `getOrdersByFiltersDb` caps pages at 200 and supports brand, vendor, derived status, PO, item, PO bucket, and server sort.
- **Rules/output:** Active means `archived != true` and normally `status != Cancelled`. Returned row status is derived. The richer filter handler outputs progress quantities and filter options; the simple `/orders` path is a thinner legacy list. Order date, ETD, revised ETD, quantity, shipment, QC link and cached CBM are stored; progress and effective ETD are derived.
- **Trust:** orders is the live record, but use `deriveOrderProgress` for analytical status and the CBM hierarchy for volume. Direct bounded capability plus raw Mongo is appropriate; do not reimplement status in query text.

### ORD-02 — PO buckets

- **Representative questions:** “How many POs are open, inspected, or shipped?”; “Show open POs for vendor X”; “Total pending CBM by PO.”
- **Trace:** `OpenOrders.jsx` and Home drilldowns → `/orders/filters` → controller-local `buildPoBucketDataset` → orders + qcs + items.
- **Rules/output:** Groups by normalized PO/brand/vendor, derives every line, aggregates ordered/passed/shipped/pending-inspection/inspected-unshipped quantities, total and pending CBM, earliest order/ETD/effective ETD, latest inspection/shipment, item codes and status counts. Bucket is `shipped` when total shipped reaches total quantity, `open` when any pending inspection remains, otherwise `inspected`.
- **Trust:** useful and broadly reused inside the controller, but not an exported service. Extract once before Assistant exposure. The order export only invokes this builder when `po_bucket` is present.

### ORD-03 — Order detail

- **Representative questions:** “Give me PO 123 details”; “What remains to inspect and ship on this PO?”; “What CBM source was used?”
- **Trace:** `Orders.jsx` → `/orders/order-by-id/:id` → `getOrderById` → one active order/PO context joined to QC and Item.
- **Rules/output:** Returns line-level quantities, derived status/progress, effective dates and calculated/stored-fallback CBM. It is suitable for fact lookup, not multi-PO aggregation.
- **Trust:** canonical live records with derived helpers. Keep access scope and route permission (`orders.view`) when adapting.

### ORD-04 — PO Status report

- **Representative questions:** “Which POs are fully inspected but not shipped?”; “Which POs have mixed inspection progress?”; “Count eligible POs by vendor.”
- **Trace:** `PoStatusReport.jsx` → `/orders/po-status-report` → `getPoStatusReport`.
- **Rules/output:** Default/allowed selections are Inspection Done and Under Inspection. Groups lines by PO/brand/vendor. Inspection Done requires no open items, at least one progressed item, and not all items shipped. Under Inspection represents mixed open and progressed items. Output includes PO item tooltips, status counts and vendor groups.
- **Trust:** the report relies on the canonical status helper but report grouping is controller-local. Extract and test the two report definitions before exposing them.

### ORD-05 — Pending PO report

- **Representative questions:** “Which PO lines still have unshipped quantity?”; “How much is pending inspection versus ready to ship?”; “Total pending quantity for vendor X.”
- **Trace:** `PendingPoReport.jsx` → `/orders/pending-po-report` and `/export` → shared controller-local `buildPendingPoReportDataset`.
- **Rules/output:** Includes a line when `max(order quantity - shipped quantity, 0) > 0`. Splits that open quantity into `inspection_pending = pending_inspection_quantity` and `shipping_pending = inspected_unshipped_quantity`. Filters are exact brand/vendor, PO contains, and server sort; summary totals line count, distinct PO+brand+vendor keys and all quantity measures. CSV/XLSX export shares the same builder.
- **Trust:** deterministic and consistent with `deriveOrderProgress`; move the builder into a service for a direct capability.

### ORD-06 — Delayed PO report

- **Representative questions:** “Which POs are delayed as of today?”; “Show delayed POs for these brands”; “Was the PO completely inspected before ETD?”
- **Trace:** `DelayedPoReports.jsx` → `/orders/delayed-po-report` → `buildReformedDelayedPoReportDataset`. The runtime export is the **second** `exports.exportDelayedPoReport` declaration.
- **Rules/output:** Groups active lines by PO/brand/vendor and uses earliest effective ETD (`revised_ETD || ETD`). A group is delayed when effective ETD is before report date, unshipped quantity remains, it is not completely shipped, and it was not completely inspected before ETD. Filters accept multiple brands, exact normalized vendor and exact PO. Summary covers line/PO counts and quantities.
- **Trust:** `passed_quantity` on flattened rows is populated with inspected-unshipped quantity, so the field name is misleading. The overwritten older builder/export used original ETD and richer QC detail. Consolidation is mandatory before Assistant use.

### ORD-07 — Upcoming ETD report

- **Representative questions:** “What active POs have ETD in the next ten days?”; “Upcoming ETDs for brand X”; “How many days remain for each PO?”
- **Trace:** `UpcomingEtdReports.jsx` → `/orders/upcoming-etd-report` and export → `buildUpcomingEtdReportDataset`.
- **Rules/output:** Default window starts today and ends ten days later; supplied boundaries are inclusive. Groups by PO/brand/vendor, uses earliest effective ETD, excludes fully shipped groups, and requires open pending/inspection-done items. Outputs item and status counts, last progress date, days until ETD and vendor totals/averages.
- **Trust:** controller-local but API/export share it. Extract without merging it with Shipping Delay because the inclusion rule differs.

### ORD-08 — Shipping Delay report

- **Representative questions:** “Which packed POs missed ETD without shipping?”; “How many days late are ready POs?”; “Show shipping-delay POs for vendor X.”
- **Trace:** `ShippingDelayReports.jsx` → `/orders/shipping-delay-report` and export → the same upcoming-ETD builder with `shippingDelay: true`.
- **Rules/output:** Requires the PO to have been completely packed before ETD, none shipped, last inspection before ETD, and ETD before the report start date. This is not the general Delayed PO rule and not the frontend Shipping Pending overdue highlight.
- **Trust:** extraction should preserve a separate capability ID and definition.

### ORD-09 — Revised ETD history

- **Representative questions:** “How often was PO 123 revised?”; “Show old and new ETDs for this item”; “What is the current revised ETD?”
- **Trace:** Orders UI → `/orders/revised-etd-history?order_id=...&item_code=...` → `getRevisedEtdHistory` → stored order `revised_etd_history` plus current ETD fields.
- **Rules/output:** PO is required; item is optional. This is historical evidence, while current effective ETD remains `revised_ETD || ETD`.
- **Trust:** bounded raw collection lookup is sufficient. Do not infer delay causality from revision history.

### ORD-10 — Today ETD dashboard

- **Representative questions:** “Which POs have ETD today?”; “Today’s ETD count by status”; “Today’s ETDs for brand X.”
- **Trace:** `Home.jsx` → `/orders/today-etd-orders` or `/:brand/today-etd-orders` → `getTodayEtdOrdersByBrand` via PO-bucket rows.
- **Rules/output:** Uses the client-day boundary and groups PO results/status counts, but filters against original `ETD`, not `effective_ETD`; a revised ETD does not move a PO into/out of this dashboard.
- **Trust:** extract only after the business confirms whether “today ETD” intentionally means original promise date.

### ORD-11 — Brand/vendor dashboard and drilldown

- **Representative questions:** “Which vendor has the most open POs for brand X?”; “Show delayed POs for vendor Y”; “How many POs are packed or partially shipped?”
- **Trace:** `Home.jsx`/`OrdersByBrand.jsx` → `/:brand/vendor-summary` and `/brand/:brand/vendor/:vendor/status/:status` → PO-bucket builder.
- **Rules/output:** Vendor summary counts PO sets as packed, pending, partial, shipped, delayed and on-time. Delayed applies to active Pending/Under Inspection PO groups with effective ETD before today. Pseudo-drilldown statuses include pending, packed, on-time and delayed in addition to exact derived lifecycle statuses.
- **Trust:** canonical input derivation but controller-local classification. The frontend only checks `totalOrders > totalShipped` to decide whether a vendor has open work; that is presentation logic.

### ORD-12 — Archived orders

- **Representative questions:** “List archived orders for brand X”; “Why was this order archived?”; “What status would be restored?”
- **Trace:** `ArchivedOrders.jsx` → `/orders/archived` → `getArchivedOrders` + `attachArchivedRestoreStatus`.
- **Rules/output:** Filters vendor, brand, PO contains, and item code/description contains; sorts archive time newest first. Returns archive remark/actor/time, previous status, and computed restore status. Archived state is stored; derived restore status consults linked QC/order facts.
- **Trust:** raw lookup is safe for business archive questions, but unarchive is a write and is outside Assistant scope.

### ORD-13 — Upload logs

- **Representative questions:** “Did yesterday’s upload fail?”; “Which upload had conflicts for PO 123?”; “Count successful uploads by status.”
- **Trace:** `UploadLogs.jsx` → `/orders/upload-logs` → `getUploadLogs` → upload_logs.
- **Rules/output:** Excludes order-edit pseudo uploads, filters brand/vendor/status/PO evidence, paginates to 100, summarizes success/success-with-conflicts/failed, and redacts duplicate/detail arrays when data access is restricted.
- **Trust:** audit evidence only, not current order state. It may contain filenames, actors and conflict details, so keep out of generic Assistant analytics.

### ORD-14 — Order edit logs

- **Representative questions:** “Who changed this PO?”; “How many fields changed?”; “Show archive edits for vendor X.”
- **Trace:** `OrderEditLogs.jsx` → `/orders/edit-logs` → `getOrderEditLogs` → order_edit_logs.
- **Rules/output:** Filters brand, vendor, PO contains and operation (`order_edit`/`order_edit_archive`), paginates to 100, and summarizes log/changed-field counts.
- **Trust:** historical audit source only; live orders supersede it. Actor/change snapshots make it non-eligible by default.

### ORD-15 — Previous-order lookup and entry options

- **Representative questions:** “Does PO 123/item A already exist?”; “Can the previous Partial Shipped order be replaced?”; “What brands/vendors are valid for manual entry?”
- **Trace:** upload/manual-order UI → `/orders/previous-order-check`, `/manual-options`, `/brands-and-vendors` → lookup/option handlers.
- **Rules/output:** Previous lookup requires exact PO and item on an active order, joins QC, derives quantities/status and returns replacement capabilities. Manual options come from accessible Vendor brand associations; generic order options are distinct operational values.
- **Trust:** reads exist to guard write workflows and should not become a conversational mutation path.

## 5. Shipment & Logistics Reports

### SHP-01 — Packed Goods

- **Representative questions:** “How much inspected stock is ready to ship?”; “Packed CBM for vendor X”; “Which POs have no inspection-pending quantity?”
- **Trace:** `PackedGoods.jsx` → `/orders/packed-goods`/export → `buildPackedGoodsPeriodDataset`. The Assistant adapter and forecast readiness logic continue to use `buildPackedGoodsDataset` unchanged.
- **Rules/output:** Qualifying `Inspection.passed` records are the source and are summed by inspection date, including AQL visits, so prior and current-period quantities reconcile to QC Details. The default period is Tuesday–Monday in the application business timezone; explicit From and To dates must be supplied together and are inclusive. Shipments are allocated FIFO through the period end using `stuffing_date`. Rows are keyed by PO/order line and item, and expose previously packed, this-period packed, total packed, and total packed CBM.
- **Frontend:** sends date, brand, vendor, and PO filters to the API. The API returns the rows, filter options, summary, resolved period, and warnings; browser work is limited to sort and page presentation.
- **Performance:** the selected-period scan uses the existing `inspections.inspection_date` index; the batched QC-history lookup would benefit from a future `{ qc: 1, inspection_date: 1 }` index if production `explain()` shows it is not selective enough. No live database query plan was available during this change.

### SHP-02 — Shipping Pending

- **Representative questions:** “What order quantity remains unshipped?”; “Split open quantity into packed and inspection-pending”; “Which pending POs are overdue?”
- **Trace:** `ShippingPending.jsx` → API/export → `buildShippingPendingDataset`; the frontend then groups PO rows with `buildShippingPendingPoRows`.
- **Rules/output:** Includes every active line with `order - shipped > 0`; it does **not** require packed quantity. API rows contain packed, pending-inspection, shipped and derived status; filters cover brand(s), vendor, PO and order date. Frontend `is_completely_packed` means grouped pending-inspection total is zero; `is_overdue_pending` means no packed or shipped quantity and original ETD is past.
- **Trust:** extract server builder; keep frontend coloring/grouping presentation-only.

### SHP-03 — Shipment rows

- **Representative questions:** “Show shipments in container ABC”; “How much CBM was allocated to each shipment?”; “Which shipment checks remain?”
- **Trace:** `Shipments.jsx` → `/orders/shipments`/export → `getShipmentDataset` → active orders plus shipped samples.
- **Rules/output:** Flattens shipment entries; derives order status and shipment CBM; sample rows use `order_id = Sample`. Orders with no shipment entry can still produce a placeholder when status is Inspection Done/Partial Shipped/Shipped; that row uses full order quantity and pending quantity and has no shipment CBM, so it is not evidence of a physical shipment. Filters cover brand/vendor/PO/item/container/status and sort.
- **Filter defect:** the internal builder accepts stuffing date range, but `getShipmentsDb` and export do not pass `fromDate`/`toDate`; Containers does.

### SHP-04 — Containers

- **Representative questions:** “Summarize container ABC”; “Which containers are partially checked?”; “Total stuffed CBM by container.”
- **Trace:** `Containers.jsx` → `/orders/containers` → `getContainerDataset` layered on `getShipmentDataset`.
- **Rules/output:** Ignores blank containers, groups case-insensitively, totals shipment quantity/CBM/rows/checks and distinct items/brands/vendors. Checked status is Checked when all rows checked, Partially Checked when some, otherwise Checking Pending. Common dates/invoice are emitted only when all grouped rows agree; shipping date is the latest. Supports brand/vendor/container/stuffing-date/checked-status filters.
- **Trust:** good report model but tied to controller-local shipment builder; extract the pair together.

### SHP-05 — Monthly Shipments

- **Representative questions:** “How many unique containers shipped last month?”; “Allocated CBM by vendor and brand”; “Drill into June’s containers.”
- **Trace:** `MonthlyShipmentsReport.jsx` → `/reports/monthly-shipments` and `/drilldown` → `monthlyShipmentsReport.service`.
- **Rules/output:** Period modes are month, custom, or six complete previous months; boundaries use Asia/Kolkata. Requires nonblank container and stuffing date in range. Computes unique physical containers and allocated CBM, overall/monthly vendor and brand totals, brand sections, trends and drilldown records. Filters country/brand/vendor and selected/detail dimensions.
- **Risk:** base order match trusts stored `status in [Partial Shipped, Shipped]`, so an order whose shipment facts imply those states but stored status is stale can be omitted.

### SHP-06 — CBM calculation and allocation

- **Representative questions:** “What is calculated CBM for this PO?”; “What source produced this shipment CBM?”; “How is sample CBM derived?”
- **Trace:** report builders → `shipmentCbmAllocation.service` → `orderCbm.service`/`boxMeasurement`.
- **Rules:** measurement priority is inspected item/box arrays, then PIS arrays, then stored Item CBM variants; order total calculation respects packaging mode. Stored `orders.total_po_cbm` is the final fallback and is prorated by order quantity for partial shipments. Sample CBM uses sample box measurements, then sample `cbm * quantity`. Precision is six decimals; cm dimensions divide by 1,000,000.
- **Trust:** always return `cbm_source`/fallback provenance. This service is suitable for direct capability reuse, not raw aggregation arithmetic.

## 6. QC & Inspection Reports

### QC-01 — QC list

- **Representative questions:** “Show pending QC requests for inspector X”; “QC requests for vendor Y this week”; “Which QC rows are unchecked?”
- **Trace:** `QcPage.jsx` → `/qc/list` → `getQCList` aggregation.
- **Rules/output:** Filters inspector, vendor, brand, PO prefix, item search, request-date range and checked boolean; QC users are restricted to their own inspector. Latest Inspection is selected and normalized to Rejected, Transferred, Goods Not Ready, Inspection Done or Pending. Orders are active/scoped; order status is separately derived. Pagination max is 100; options include vendors/orders/items.
- **Trust:** bounded capability plus raw facts is appropriate, retaining role/data-scope enforcement.

### QC-02 — QC detail and inspection report

- **Representative questions:** “Show all inspections for this QC”; “What passed, failed, or remains?”; “Which complaints/files/barcodes relate to the item?”
- **Trace:** `QcDetails.jsx` and `inspection_report.jsx` → `/qc/:id` → `getQCById`; UI also fetches brand logos/files and item-related complaints.
- **Rules/output:** Rich current QC/order/item/inspection context, request history, quantity state, measurement snapshots, images, barcodes, checked state and inspectors. The print view is a presentation of this payload, not a separate calculation source.
- **Trust:** safe only as a permission-bound detail capability. Adjacent endpoints mutate inspections, images, draft, assignment and checked state.

### QC-03 — QC workbook export

- **Representative questions:** “Export the filtered QC list”; “Download inspection metadata”; “Get QC rows with item-master fields.”
- **Trace:** `QcPage.jsx` → `/qc/export` → separate `exportQCList` aggregation.
- **Rules/output:** Produces CSV/XLSX with a much wider field set than list API, joining active orders, users and items and applying similar inspection-status logic.
- **Trust:** export-only. List/export pipelines are duplicated and can drift; do not use the workbook builder as an Assistant data source.

### QC-04 — Daily QC report

- **Representative questions:** “What inspections happened on 20 August?”; “Which aligned requests still need action?”; “Inspected quantity and CBM by inspector.”
- **Trace:** `DailyReport.jsx` → `/qc/daily-report` → `getDailyReport`.
- **Rules/output:** For one report date plus optional brand/vendor, aligns QC requests made on/before the date with visible inspection history and exact-day inspection activity, including transfer/rejection update timestamps. Produces `aligned_requests`, inspector-grouped `inspection_rows`, action/GNR/transfer/rejection flags and total inspected quantity/CBM. Request and inspection sorting are independently configurable.
- **Trust:** complex controller-local report; extract with regression fixtures before capability exposure.

### QC-05 — Inspector performance

- **Representative questions:** “How many inspections did each inspector perform?”; “Passed quantity and inspected CBM by week”; “Approved-goods CBM for inspector X.”
- **Trace:** `InspectorReports.jsx` → `/qc/reports/inspectors` → `getInspectorReports`.
- **Rules/output:** Filters inspector and timeline/custom dates; Inspection is the event source and joins QC, scoped active order, user and item. Computes counts, requested/checked/passed, inspected CBM, approved-goods CBM allocated against shipment evidence, and orders touched with daily/weekly groupings.
- **Trust:** formula is tested (`inspectorApprovedGoodsCbm.test.js`) but handler remains controller-local.

### QC-06 — Vendor shipping performance

- **Representative questions:** “Average shipping time by vendor”; “How many vendor POs shipped after ETD?”; “Rank vendors by delay.”
- **Trace:** `VendorReports.jsx` → `/qc/reports/vendors` → `getVendorReports`.
- **Rules/output:** Groups active orders by PO/vendor/brand, considers a group only when stored statuses say fully shipped and latest stuffing date is in range, then calculates order-to-shipping days and effective-ETD delay. Vendor totals include orders, delayed count, average delay, shipped count and average shipping time.
- **Risk:** stored-status prefilter can disagree with shipment-derived status; code branches for unshipped groups are unreachable after the fully-shipped prefilter.

### QC-07 — Weekly order/QC summary

- **Representative questions:** “Weekly inspection summary by vendor”; “What goods-not-ready events occurred?”; “Total inspected CBM and pending quantity this week.”
- **Trace:** `WeeklySummary.jsx` → `/qc/reports/weekly-summary` → `getWeeklyOrderSummary`.
- **Rules/output:** Selects the latest in-range Inspection snapshot per QC, finds complete PO groups, then loads all related QCs/orders/items and latest overall inspection/user. Rows include ordered, passed, pending, derived order status, per-unit/total CBM, GNR reason, latest dates/inspectors; groups by vendor with vendor/PO/item/in-range counts.
- **Trust:** report mixes in-range evidence with latest-overall context intentionally; label those dates in Assistant responses.

### QC-08 — Daily order/QC summary

- **Representative questions:** “Daily summary for brand X”; “Which items were Goods Not Ready today?”; “Passed and open quantity by vendor.”
- **Trace:** `DailySummary.jsx` → `/qc/reports/daily-summary` → `getDailyOrderSummary`.
- **Rules/output:** Latest Inspection per QC for the selected date joins QC, active scoped Order and inspector. Normalizes status/GNR and groups vendor rows containing PO/item/requested/passed/open/reason/inspector/date. Summary counts vendors and items.
- **Trust:** deterministic controller aggregation; extract for reuse.

### QC-09 — Vendor-wise QA summary

- **Representative questions:** “QA performance for vendor X by inspector”; “Passed quantity and CBM this month”; “How many inspections per inspector?”
- **Trace:** `VendorWiseQAReport.jsx` → `/reports/vendor-wise-qa/summary` → `getVendorWiseQaSummary`.
- **Rules/output:** Vendor is required. Timeline or explicit range filters Inspection events, then joins QC/order/user/item and groups inspectors by count, passed quantity and inspected CBM.
- **Trust:** controller-local multi-collection aggregation; suitable after service extraction.

### QC-10 — Vendor-wise QA detail

- **Representative questions:** “List QA inspections for vendor X”; “Show requested versus passed per PO”; “Group QA detail by brand.”
- **Trace:** same page → `/reports/vendor-wise-qa/detailed` → `getVendorWiseQaDetailed`.
- **Rules/output:** Optional vendor/inspector plus timeline/date. Returns vendor → brand tables with inspector, request/inspection dates, PO/item, requested/passed, item CBM and packed CBM plus totals.
- **Trust:** do not substitute the summary endpoint when line evidence is requested.

### QC-11 — Inspected-items readiness

- **Representative questions:** “Which inspected items lack product images?”; “PIS readiness for brand X”; “Count items missing assembly or mounting files.”
- **Trace:** `InspectedItemsReport.jsx` → `/reports/inspected-items`/export → shared `getInspectedItemsReportDataset`.
- **Rules/output:** Merges Item master rows with item codes found only in non-cancelled orders. “Inspected” is based on QC last-inspected date or checked/passed evidence. Joins Vendor codes/contacts and derives CAD, PIS, assembly, mounting, satin, packaging PPT, image, finish, shipping marks, EAN, cartons and PD status flags with KD/mounting/satin applicability. Filters search/brand/vendor/country/criterion yes-no/date; summary counts every readiness flag.
- **Trust:** API/export share a builder, but it lives in controller. PIS summary excludes Giga—business confirmation required.

### QC-12 — Common inspection errors

- **Representative questions:** “Show weight formula errors”; “Which inspections have height inconsistencies?”; “Count common errors by type.”
- **Trace:** `CommonErrorsReport.jsx` → `/reports/common-errors`/export → `buildCommonErrorsReportDataset` + `evaluateCommonInspectionErrors`.
- **Rules/output:** Weight error when `(item net + optional stretcher net) × items/inner × inners/master + 0.01 >= master gross weight`; height error when top + base + optional pedestal height + 0.01 is less than item height. Only positive comparable inputs are evaluated. Filters search/brand/vendor/error type/date; output includes formula, actual, expected and difference; export has one row/error.
- **Trust:** derived helper is reusable and unit tested; move dataset construction to a service.

### QC-13 — QC report mismatch

- **Representative questions:** “Which current item measurements differ from inspection reports?”; “What fields mismatch for item X?”; “Show only mismatches from the last 30 days.”
- **Trace:** `QcReportMismatch.jsx` → `/reports/qc-report-mismatch` → latest-three-inspection aggregation + `compareInspectionSizeSnapshot`; comment endpoints write to Item.
- **Rules/output:** Filters brand/vendor/inspector/status/PO/item/mismatch-only/timeline/dates and pages to 200. Compares historical Inspection snapshots with current Item inspected fields only when comparable. Item-dimension tolerance is >0.5 cm, box dimension >1 cm, weight >10%; exactly-at-threshold is accepted. Summary counts inspection/mismatch/clean/field mismatches.
- **Trust:** the static flow doc’s 1 cm item threshold is stale. Comments are not analytical evidence and should remain outside the capability.

## 7. Item / PIS / Product Database Functions

### ITM-01 — Item catalog

- **Representative questions:** “Find item 96568”; “Items for vendor X and brand Y”; “Which items have a product image?”
- **Trace:** `Items.jsx`/file pages → `/items` → `getItems` → items, with latest QC inspection-report lookup.
- **Rules/output:** Filters search, brand, vendor, country and file type; max page size 200. Returns complete Item documents, optional thumbnails, latest inspection QC/date and distinct brand/vendor/item-code options.
- **Trust:** items is canonical master data, but broad documents include sensitive URLs/audit fields; an Assistant adapter should project only requested business fields.

### ITM-02 — Item workbook and PO-status sheet

- **Representative questions:** “Export items with all measurement sources”; “Which items have current running POs?”; “Count item POs by derived status.”
- **Trace:** `Items.jsx` → `/items/export` → `getItemsExportDataset` + `buildItemPoStatusSummary`.
- **Rules/output:** Workbook sheets contain Items and Current Running POs. The status sheet derives statuses from populated QC/shipment facts; running means not Shipped. It exports PIS/inspected/master/PD sizes and barcodes plus serialized raw item/order payloads.
- **Trust:** export-only because wide raw JSON cells and files exceed a safe conversational projection.

### ITM-03 — Accepted item masters

- **Representative questions:** “Which items have master measurements?”; “Show master barcodes for brand X”; “Find master records for vendor Y.”
- **Trace:** `ItemMasters.jsx` → `/items/masters` → `getItemMasters`.
- **Rules/output:** Eligible when any master item/box size, master barcode, master inner/master barcode, or master country is present. Supports search/brand/vendor and returns master-selected fields plus options.
- **Trust:** bounded raw Item projection is sufficient.

### ITM-04 — Item detail and file availability

- **Representative questions:** “Show all known data for item X”; “Which POs and inspections relate to it?”; “Does it have CAD/PIS/images/shipping marks?”
- **Trace:** `ItemDetails.jsx` → `/items/:itemCode/details`; file pages use signed-URL endpoints.
- **Rules/output:** Joins Item to orders/QC, derives each current order status and latest inspection, enriches finish images, serializes product-database state, files and shipping marks, and summarizes order/inspection counts. Binary URLs are short-lived storage responses.
- **Trust:** detail facts are useful; never return signed URLs or file blobs through generic Assistant analytics.

### ITM-05 — Item order presence and history

- **Representative questions:** “Is item X on any active PO?”; “Show its prior POs and statuses”; “List valid inspection history by PO.”
- **Trace:** Item pages → `/order-presence` and `/orders-history` → respective handlers.
- **Rules/output:** Presence only reads active orders and returns derived status, total/open/shipped quantity and effective ETD. History includes active and archived orders; archived is labelled Archived, otherwise status is derived. Embedded inspection history is accepted only when item, PO, inspection date and inspector are present.
- **Trust:** extract both handlers into one item-history service before capability exposure.

### ITM-06 — PIS catalog and PIS file

- **Representative questions:** “Show PIS values for item X”; “Which PIS files exist?”; “PIS items for brand/vendor.”
- **Trace:** `PIS.jsx` reuses `/items`; file view uses `/:itemId/pis-file-url`.
- **Rules/output:** PIS fields are stored on Item (`pis_*`, packaging mode, measurements, barcodes, calculated CBM, checked flag). The page’s selection/presentation is not a separate backend dataset.
- **Trust:** project current array-backed PIS fields; legacy aliases remain compatibility data and need provenance labels.

### ITM-07 — Unchecked PIS differences

- **Representative questions:** “Which unchecked items differ between inspection and PIS?”; “Show size/barcode/CBM differences”; “Which rows also mismatch historical inspection reports?”
- **Trace:** `PISDiffs.jsx` → `/items/pis-diffs` → `getPisDiffItems` and PIS comparison helpers.
- **Rules/output:** Restricts `pis_checked_flag != true` and `is_rectify_imported != true`; filters search/brand/vendor/country. Compares inspected versus PIS measurements/barcodes/CBM, normalizing entries to master order when available, and separately scans historical Inspection snapshots against current inspected Item state.
- **Trust:** derived report should be service-extracted. “Unchecked” list and “checked” export intentionally address different populations.

### ITM-08 — Checked PIS differences report

- **Representative questions:** “Preview checked PIS differences”; “Export detailed difference rows”; “How many checked diff items by brand?”
- **Trace:** PISDiffs report actions → `/pis-diffs/export-preview` and `/export` → `getCheckedPisDiffRowsForReport`.
- **Rules/output:** Restricts `pis_checked_flag = true`, excludes rectify imports, rebuilds current diffs, attaches inspection-report mismatch, and produces summary, checked-item sheet and detailed-differences sheet.
- **Trust:** export/presentation only; use ITM-07’s extracted dataset for analytical queries with an explicit checked filter.

### ITM-09 — Final PIS Check

- **Representative questions:** “Which inspected values differ from Master?”; “Show CBM or size differences for item X”; “Which eligible items have inspection-report mismatches?”
- **Trace:** `FinalPISCheck.jsx` → `/items/final-pis-check` and `/options` → `getFinalPisCheckRowsForQuery` → valid-inspection history + `finalPisCheck`.
- **Rules/output:** Requires checked, non-rectify Item with Master measurements/barcodes and at least **three distinct valid inspected POs**. Compares inspected arrays against Master arrays; differences are Item Size, Box Size, Weight and CBM. Item tolerance is 0.5 cm, box 1 cm, weight 10%; CBM uses rounded two-decimal comparison with 0.03 tolerance. Returns latest five comments and mismatch metadata.
- **Naming risk:** response fields `pis_item`, `pis_box`, `has_pis_*` actually hold Master/reference values. No PIS fallback is used when Master is absent because the query requires Master evidence.

### ITM-10 — Final PIS report/export

- **Representative questions:** “Preview the Final PIS report”; “Export item and detailed differences”; “Count differences by field.”
- **Trace:** FinalPISCheck export actions → preview/export handlers → same query and report-payload helpers.
- **Rules/output:** Same eligible/filtered/sorted rows as ITM-09; workbook contains Summary, Final PIS Check and Detailed Differences. Display headings correctly call the reference Master despite internal `pis_*` keys.
- **Trust:** export-only; ITM-09 should be the future analytical source.

### ITM-11 — PIS / inspection / Master comparison

- **Representative questions:** “Compare PIS, last three inspections, and Master for item X”; “Which items have three comparable POs?”; “Which cells agree with the reference?”
- **Trace:** `PisInspectionMasterComparison.jsx` → candidate list and item-detail routes → comparison handlers + `pisInspectionMasterComparison#buildComparisonRows`.
- **Rules/output:** Candidate list requires at least three distinct PO inspections with completed status/checked/passed and measurement data. Detail picks latest valid inspection per PO, then newest three distinct POs. It returns Item/Box sections across PIS, three inspections and Master with per-cell statuses; comparison tolerances come from helper rules.
- **Trust:** this is a different report from Final PIS Check and QC Report Mismatch. Extract as its own capability.

### ITM-12 — Product Database

- **Representative questions:** “Which PD items are Created, Checked, or Approved?”; “How complete are required product fields?”; “List materials used by the catalog.”
- **Trace:** `ProductDatabase.jsx` → `/items/product-database`/export → controller + `productDatabase` helper + active Product Type Templates.
- **Rules/output:** Filters search/brand/vendor/status/completion range; computes dynamic completion from template fields, status summaries, material/brand/vendor options and permissions. Rows expose `pd_*`, product specs, measurements, barcodes, actors and completion. Status is a stored approval workflow; completion is derived from current template fields.
- **Trust:** capability plus bounded Item queries is appropriate. Check/approve/edit routes are writes and must remain separate.

### ITM-13 — Item Database composite

- **Representative questions:** “Which items have running POs?”; “Show PD completion plus last inspection”; “Open item database details for item X.”
- **Trace:** `ItemDatabase.jsx`/`ProductDatabaseDetails.jsx` → `/items/item-database`, export, detail → `getItemDatabaseDataset`.
- **Rules/output:** Combines Product Database row/completion with running PO count/IDs and latest QC inspection-report date. Filters search/brand/vendor/PD status/completion/running-po yes-no; exports the same dataset.
- **Risk:** running PO lookup filters stored order status against Pending/Under Inspection/Inspection Done/Partial Shipped instead of deriving status; stale status can miscount.

### ITM-14 — Product Analytics

- **Representative questions:** “Average inspection time per item”; “Product rejection percentage”; “Average shipping time for fully shipped POs.”
- **Trace:** `ProductAnalytics.jsx` → `/items/product-analytics` → order aggregation + `processOrderAnalyticsRow`/`groupProductAnalyticsRows`.
- **Rules/output:** Active orders join all Inspections through QC, group by item ID/code, and calculate PO count, order/passed/shipped totals, inspection-time average, rejection-percent average and shipping-time average. Single inspection uses order-to-inspection days; multiple inspections use first-to-last days. Shipping time is only for fully shipped orders.
- **Risk:** `passedQuantity` sums all inspection `passed` fields, which may double count if records are cumulative. The multi-inspection rejection algorithm iteratively treats remaining quantity as rejected. Business validation is required before forecasting or capability exposure.

### ITM-15 — PIS update logs

- **Representative questions:** “Who changed PIS fields?”; “Which logs have missing fields?”; “Count changes by data scope.”
- **Trace:** `PisUpdateLogs.jsx` → `/items/pis-update-logs` → `getPisUpdateLogs` → pis_update_logs.
- **Rules/output:** Filters search/brand/vendor/data scope/operation/missing-only; max 100 rows. Returns available filter values and totals for logs, changed fields and missing fields.
- **Trust:** append-only audit evidence, not current Item truth; contains actor/change detail and is non-eligible by default.

### ITM-16 — Product Type Templates

- **Representative questions:** “What fields define product type X?”; “Which templates are active?”; “What source headers map into a field?”
- **Trace:** `ProductTypeTemplates.jsx`/Product Database → `/product-type-templates` or `/:key` → controller/helpers → product_type_templates.
- **Rules/output:** Versioned templates define groups, dynamic fields, required state, source headers, defaults and status. Non-admin Product Database reads consume active template fields for completion calculations.
- **Trust:** bounded raw configuration read can explain schema/completion, but template management is admin-only.

## 8. Vendor & Brand Reports

### VEN-01 — Vendor master list and export

- **Representative questions:** “List active vendors by country”; “What brands/codes belong to vendor X?”; “Show shipment contacts for Vietnam vendors.”
- **Trace:** `VendorDetails.jsx` → `/vendors` and `/vendors/export` → vendor controller → vendors + brands.
- **Rules/output:** Excludes soft-deleted vendors and applies accessible vendor/brand options. Vendor records include identity, owner/contact data, country (India/China/Vietnam), per-brand vendor codes, contacts, default shipping time and active state. Export optionally filters comma/array country and emits one vendor row.
- **Trust:** master collection is canonical, with `vendorRef` normalization for embedded snapshots elsewhere. Project contacts only when the user and use case permit it.

### VEN-02 — Brand/vendor option sets

- **Representative questions:** “Which vendors are valid for brand X?”; “What brand options can this user access?”; “Resolve a vendor display name.”
- **Trace:** form/report pages → `/vendors/brand-options` and `/orders/brands-and-vendors` → Brand/Vendor/Order distinct handlers.
- **Rules/output:** Vendor brand options require any vendor view/create/edit permission; brands are access-scoped and sorted. Order-derived options reflect values present in operational data and can differ from master associations.
- **Trust:** distinguish master options from historical operational distinct values in responses.

### VEN-03 — Brands, logos and calendars

- **Representative questions:** “List configured brands”; “Does brand X have a calendar?”; “Get its report logo.”
- **Trace:** Home/reports → `/brands`, logo routes and `/:name/calendar` → brand controller → brands.
- **Rules/output:** Brand list returns identity, normalized logo metadata and calendar. Logo is binary. Calendar response returns Google embed URL using supplied timezone; it does not query events.
- **Trust:** identity/config is raw canonical data. Logos/calendar embeds are presentation/configuration, not analytical facts.

### VEN-04 — Finish catalog

- **Representative questions:** “List finishes for vendor X”; “Which items use finish code ABC?”; “Filter finishes by brand.”
- **Trace:** `Finishes.jsx` and Item detail → `/finishes` → `getFinishes` → finishes joined to scoped items/vendors.
- **Rules/output:** Finish stores color/code, unique code, vendor snapshot, item codes and front/back images. A finish with item codes is visible only through accessible joined items; an unassigned finish is checked against accessible vendor identity. Filters exact vendor and brand and returns count/options.
- **Trust:** canonical finish records with access-dependent Item enrichment.

### VEN-05 — Finish support options/images

- **Representative questions:** “Which vendor items can receive a finish?”; “What vendor codes are available?”; “Show the front/back image.”
- **Trace:** Finishes UI → vendor-options/vendor-items and image routes → finish controller.
- **Rules/output:** Vendor options contain allowed brand/code pairs; vendor-item search returns item identity/current finishes; image routes resolve ID or unique code and front/back side. `/finishes/public/image` is intentionally unauthenticated.
- **Trust:** presentation/support only. Do not expose binary URLs through an Assistant capability.

## 9. Sample Reports

### SAM-01 — Sample catalog

- **Representative questions:** “List samples for brand X”; “Find samples updated this month”; “Which sample was converted to an Item?”
- **Trace:** `Samples.jsx` → `/samples` → `getSamples` → samples.
- **Rules/output:** Filters search across code/name/description/brand/vendor, exact brand/vendor and inclusive `updatedAt` range; max 200. Returns measurements, box mode, files, sample CBM, shipments, conversion relation and brand/vendor options; optional product thumbnail.
- **Trust:** samples is canonical. Create/update/file/convert routes are related writes, not reporting actions.

### SAM-02 — Shipped samples

- **Representative questions:** “Which samples shipped in container ABC?”; “Total sample shipment quantity”; “Which sample shipments are checked?”
- **Trace:** `ShippedSamples.jsx` → `/samples/shipped` → `flattenSampleShipmentRows`.
- **Rules/output:** Reads samples with at least one shipment and flattens one row per entry. Filters search/brand/vendor and client-requested container substring; reports quantity, pending, container, invoice, stuffing date, check state and calculated sample CBM. Summary totals rows, quantity and checked count; options include brands/vendors/containers/sample codes.
- **Trust:** move the pure flattener and query into a reusable read service. These rows also feed the general Shipment/Container reports.

### SAM-03 — Sample Workflow

- **Representative questions:** “List sample workflows for vendor X”; “Find workflows updated in a date range”; “What is the due date for a sample workflow?”
- **Trace:** `SampleWorkflow.jsx` → `/sample-workflows` → `getSampleWorkflows` → sample_workflows.
- **Rules/output:** Uses the same search/brand/vendor/updated-date filters as samples and returns the separate workflow document schema. Creation calculates a default due date two days later, adding a day if Sunday occurs in the interval.
- **Trust:** this collection is independent from generic `workflow_tasks`; never join them merely because both are called workflow.

## 10. Workflow Reporting

### WF-01 — Workflow dashboard

- **Representative questions:** “How many tasks are open or overdue?”; “Workload by assignee”; “Count approval/upload delays.”
- **Trace:** `WorkflowDashboard.jsx` → `/workflow/dashboard` → `workflowStatusService#getWorkflowDashboardSummary`.
- **Rules/output:** Admin-only. Aggregates total/open/assigned/started/complete/hold/approved/uploaded/reworked/due-today, completion/approval/upload overdue and delay categories, batch versus individual counts, unassigned tasks and user workload. Due-day boundaries use Asia/Kolkata. Completion, approval and upload each have distinct deadlines; two-day additions skip Sunday.
- **Trust:** canonical workflow service, but personnel/workload data is sensitive and not generic-Assistant eligible.

### WF-02 — Workflow batches and detail

- **Representative questions:** “List active workflow batches”; “Show batch X and its task counts”; “Find batches created this week for brand Y.”
- **Trace:** WorkflowBatches/BatchDetail → `/workflow/batches`, `/:id` → `workflowBatchService`.
- **Rules/output:** Privileged readers see all non-deleted batches; others only batches with assigned tasks. Filters status/brand/task type/creator/created range/search; max page limit comes from service constants. Detail serializes task type, assignees, audit actors and batch counts.
- **Trust:** canonical service; adjacent batch operations create, edit, bulk-change, cancel and delete.

### WF-03 — Workflow task list/boards

- **Representative questions:** “Show my open tasks”; “Which uploads remain?”; “Tasks overdue for approval.”
- **Trace:** WorkflowTasks/MyTasks/UploadPending → `/workflow/tasks` → `workflowStatusService#listWorkflowTasks`.
- **Rules/output:** Non-admin visibility is assigned-to, created-by, assigned-by, or upload-assignee. Filters include status pseudo-values (`open`, `complete_done`, overdue/delay variants, due_today, hold approval, upload pending), task type, batch/individual source, assignee/creator/department/brand, due range and search. Rows may be grouped for board display by batch.
- **Trust:** source of truth is workflow_tasks with service-defined lifecycle semantics. Sensitive because it reveals work assignments and source folder metadata.

### WF-04 — Workflow task detail/history/comments

- **Representative questions:** “Show task status history”; “Who is assigned and when?”; “What comments/evidence exist?”
- **Trace:** workflow task detail UI → `/workflow/tasks/:id` → `buildTaskDetail`.
- **Rules/output:** Returns live Task plus TaskAssignment history, TaskStatusHistory transitions, nondeleted Comments and latest completion comment, with populated users/departments. Live task state supersedes history collections.
- **Trust:** permission-bound operational detail; comments and identities make it non-eligible.

### WF-05 — Assignable users

- **Representative questions:** “Who can be assigned?”; “List workflow users and roles”; “Find an upload assignee.”
- **Trace:** workflow forms → `/workflow/users` → `getWorkflowAssignableUsers` → users.
- **Rules/output:** Returns all users’ IDs, names, email, username and normalized role, sorted by name. The route only requires workflow view permission.
- **Trust:** identity directory is sensitive. It should not be exposed to generic analytics, and its broad visibility deserves a separate access review.

### WF-06 — Task types and departments

- **Representative questions:** “What task types are active?”; “Which default assignees/department belong to type X?”; “List department members.”
- **Trace:** WorkflowTaskTypes/Departments → corresponding GET routes → workflow services/controllers.
- **Rules/output:** Nonprivileged readers receive active task types/departments; privileged readers can see inactive configurations. Task types include category, auto-create mode, priority, review requirement, default department/assignees; departments include members and audit actors.
- **Trust:** canonical configuration but contains user identities and drives mutation policy; keep non-eligible.

## 11. Complaints

### CMP-01 — Complaint list and detail

- **Representative questions:** “List active complaints for vendor X”; “Show complaint CMP-… and files”; “Which complaints are unread for me?”
- **Trace:** `Complaints.jsx` → `/complaints`, `/:id` → complaint controller → complaints.
- **Rules/output:** List defaults `archived=false`; filters search across number/item/brand/vendor/category/PO/comment, exact brand/vendor/category/item/creator and created range; max 100. Serialization returns comments, signed file URLs, update history, archive data and user-specific read/unread counts.
- **Trust:** current complaint source but contains free text, files, people and read receipts. Keep outside generic Assistant access.

### CMP-02 — Item-related complaints

- **Representative questions:** “Are there complaints for item X?”; “Show QC comments on item complaints”; “Which related complaint is unread?”
- **Trace:** QC/item panels → `/complaints/item-related?item_code=...` → `getItemRelatedComplaints`.
- **Rules/output:** Requires exact item code, active complaints, data access and QC/manager-like role. Returns full serialized complaints; related routes add QC comments and mark read.
- **Trust:** useful contextual support in QC, but sensitive and mutation-adjacent.

### CMP-03 — Complaint categories

- **Representative questions:** “What complaint categories exist?”; “Find category X”; “Which label should a form use?”
- **Trace:** Complaints form → `/complaints/categories` → `getComplaintCategories` → complaint_categories.
- **Rules/output:** Sorted category labels with creation/update actors and dates. Category creation is permitted through a separate POST.
- **Trust:** low-risk configuration by itself, but grouped under the non-Assistant complaint surface to avoid accidental free-text expansion.

## 12. Other Business Read Capabilities

### OTH-01 — Notifications and workflow dock

- **Representative questions:** “What notifications are unread?”; “Tasks due today in the dock”; “How many critical alerts does this user have?”
- **Trace:** navigation/dock → `/notifications`, `/summary`, `/login-summary` → `notificationService`.
- **Rules/output:** User-scoped list filters unread/category/priority/date/search or selects workflow-dock views (due today, approval/hold/upload pending, critical overdue). Hidden/deleted/uploaded workflow tasks are removed. Summaries and cards join related workflow task metadata; read/archive/popup state is mutable.
- **Trust:** canonical per-user service but private and stateful; not a business analytics source.

### OTH-02 — Email logs

- **Representative questions:** “Show emails linked to PO 123”; “Filter communication by brand/vendor”; “What values are valid for a new log?”
- **Trace:** `EmailLogs.jsx` calls `/email-logs/filters/options`, `/email-logs`, and create/update/delete. `emailLogs.routes.js` and controller implement list, PO detail and options.
- **Rules/output:** List filters PO/brand/vendor and orders chronologically; options join Brands, Vendors and scoped Orders. Email log text/content and creator are stored in emaillogs.
- **Blocking defect:** `backend/index.js` neither imports nor mounts the router. All intended URLs are unreachable. Even after mounting, routes have authentication but no explicit business permission middleware, so access must be reviewed before enabling the UI.

### OTH-03 — PDF rendering/status

- **Representative questions:** “Export the current report to PDF”; “Is the renderer healthy?”; “Render this filtered report markup.”
- **Trace:** report pages → `/reports/pdf/render`, `/items/pdf/render`, `/qc/pdf/render`; support checks `/reports/pdf/status` → shared Chromium renderer.
- **Rules/output:** Accepts already-rendered/sanitized report markup and returns a PDF. It does not query business collections or define totals.
- **Trust:** export/presentation only; never treat a rendered PDF as the canonical report implementation.

### OTH-04 — Queue/job status

- **Representative questions:** “Is job 123 complete?”; “How many jobs are waiting?”; “Did an export job fail?”
- **Trace:** async job UI → `/jobs/:queueName` or `/:queueName/:jobId` → jobs controller/queue service.
- **Rules/output:** Permission `jobs.view`; returns queue counts or a job’s operational status/result/error. Retry is a separate `jobs.manage` write.
- **Trust:** operational control-plane state, not business report data.

## 13. Sensitive / Non-Assistant Capabilities

### SEC-01 — Identity, user list and sessions

- **Representative questions the UI can answer:** “Who is the current user?”; “List users for administration”; “What brand scope is active?”
- **Trace:** `/auth/me`, `/auth` and auth/session mutations → auth controller → users/auth_sessions.
- **Reason excluded:** personal identity, roles, password/session mechanics and access scope. These inputs must enforce every capability but must not be queryable as ordinary business facts.

### SEC-02 — Permissions and data-access settings

- **Representative questions the admin UI can answer:** “What can role X do?”; “Which brands/vendors can user Y access?”; “What are my effective permissions?”
- **Trace:** PermissionManagement/auth bootstrap → `/permissions`, `/permissions/me`, `/permissions/users/access` → permission service/controller → rolepermissions/users.
- **Reason excluded:** control-plane configuration. The Assistant should consume enforced permission results, never reveal or mutate permission policy through analytics.

### SEC-03 — Security, OAuth and Assistant platform state

- **Representative questions the control surfaces can answer:** “What security alerts are open?”; “Show a user baseline”; “Start Google OAuth setup.”
- **Trace:** `/security/*`, `/google/auth|callback`, and `/oms-chat` services → security collections, OAuth provider and Assistant conversation/rate stores.
- **Reason excluded:** security telemetry, baselines, OAuth refresh tokens, Assistant conversations/rate counters and administrative actions are explicitly denied or unsuitable. Notably, Google callback returns a refresh token for manual secure storage; it must never enter reporting or Assistant output.

## 14. Business Concept → Capability Map

| Business concept / phrase | Route to capability | Important distinction |
|---|---|---|
| PO / purchase order | ORD-01, ORD-03 | Operational PO is an order line keyed by `order_id` plus item context |
| Open order | ORD-02 | PO bucket has pending inspection; not identical to any stored status |
| Order status | ORD-01/ORD-04 via SHP-06 status helper | Derive from quantity, QC and shipments |
| Pending PO | ORD-05 | Any unshipped order quantity remains |
| Inspection pending | ORD-05/SHP-02 | `order - passed` |
| Packed / goods ready | SHP-01 | Passed but unshipped, strictly > 0 |
| Shipping pending | SHP-02 | All unshipped open quantity; can include zero packed quantity |
| Shipment | SHP-03 | Physical shipment entry; beware placeholder rows |
| Container | SHP-04/SHP-05 | Operational grouping versus monthly unique physical container |
| CBM / volume | SHP-06 | Calculated measurements first; stored PO total last fallback |
| Delayed PO | ORD-06 | Effective ETD passed + open quantity + not fully inspected before ETD |
| Shipping Delay | ORD-08 | Fully packed before ETD, still entirely unshipped after ETD |
| Upcoming ETD | ORD-07 | Effective ETD within inclusive forward window |
| Today ETD | ORD-10 | Current code uses original ETD, not revised effective ETD |
| Revised ETD | ORD-09 | Stored current/revision history; current effective date is revised-or-original |
| QC request | QC-01/QC-02 | qcs request state; not the same as an Inspection event |
| Inspection | QC-02/QC-04 | inspections event tied through QC |
| Goods Not Ready | QC-04/QC-07/QC-08 | Inspection snapshot status/reason |
| Inspector performance | QC-05 | Inspection activity and allocated approved-goods CBM |
| Vendor delivery performance | QC-06 | Fully shipped PO timing; stored-status risk |
| Vendor QA | QC-09/QC-10 | Inspection/quantity/CBM performance, summary or detail |
| Readiness / missing files | QC-11 | Item/QC/order-derived file/applicability flags |
| Common error | QC-12 | Deterministic weight/height formula violation |
| QC mismatch | QC-13 | Historical Inspection snapshot versus current inspected Item state |
| PIS diff | ITM-07/ITM-08 | Current inspected Item data versus PIS data |
| Final PIS Check | ITM-09/ITM-10 | Current inspected Item data versus Master, with 3-PO eligibility |
| Three-inspection comparison | ITM-11 | PIS + latest three distinct PO Inspections + Master |
| Product Database / PD | ITM-12 | Separate `pd_*` approval workflow and dynamic product specs |
| Item Database | ITM-13 | PD state + running POs + latest inspection report |
| Product analytics | ITM-14 | Per-item inspection/rejection/shipping-time calculation; needs validation |
| Vendor master | VEN-01 | Current Vendor identity/brand codes; snapshots remain on operational records |
| Sample | SAM-01 | Separate sample entity, optionally converted to Item |
| Shipped sample | SAM-02 | Flattened Sample shipment entry; also appears in shipment/container reports |
| Sample Workflow | SAM-03 | Separate collection, unrelated to generic workflow tasks |
| Workflow task | WF-03/WF-04 | Live task state plus assignment/status/comment history |
| Complaint | CMP-01/CMP-02 | Sensitive free text/files/read receipts |
| Audit/history | ORD-13/ORD-14/ITM-15 | Historical evidence, never current live state |

## 15. User Question Routing Matrix

| # | Representative user question | Primary capability | Fallback / composition | Why |
|---:|---|---|---|---|
| 1 | List active PO lines for brand X | ORD-01 | Raw scoped orders + QC | Line-level current facts |
| 2 | How many POs are open, inspected and shipped? | ORD-02 | ORD-01 + derived grouping | PO-bucket definition |
| 3 | What is the status of PO 123? | ORD-03 | ORD-01 | Detail plus derived progress |
| 4 | Which POs are completely inspected but not shipped? | ORD-04 | SHP-01 grouped by PO | Report-specific all-lines rule |
| 5 | Total pending quantity by vendor | ORD-05 | ORD-01 derived aggregation | Includes all unshipped quantity |
| 6 | What remains to inspect versus ship? | ORD-05 | SHP-02 | Canonical progress split |
| 7 | Which POs are delayed today? | ORD-06 | None without definition | Reformed delayed rule |
| 8 | What ETDs are due in the next ten days? | ORD-07 | Raw order effective ETD | Inclusive upcoming window |
| 9 | Which packed POs missed ETD without shipping? | ORD-08 | None | Shipping Delay’s narrow definition |
| 10 | Show PO 123’s revised ETD history | ORD-09 | Raw scoped order | Stored history |
| 11 | Which POs have ETD today? | ORD-10 | ORD-07 one-day window | Clarify original vs effective ETD |
| 12 | Vendor dashboard for brand X | ORD-11 | ORD-02 grouped by vendor | Dashboard pseudo-statuses |
| 13 | Why was this order archived? | ORD-12 | ORD-14 for change evidence | Archive state plus audit context |
| 14 | Did an order upload fail? | ORD-13 | None | Upload audit source |
| 15 | Who edited PO 123? | ORD-14 | None | Edit audit source |
| 16 | How much ready-to-ship CBM does vendor X have? | SHP-01 | SHP-06 | Canonical Packed Goods |
| 17 | Which unshipped lines have zero packed quantity? | SHP-02 | ORD-05 | Shipping-pending population |
| 18 | Show physical shipments in container ABC | SHP-03 | SHP-04 | Shipment-entry rows |
| 19 | Which containers are partially checked? | SHP-04 | None | Container check aggregation |
| 20 | Unique containers and CBM last month | SHP-05 | SHP-03 custom aggregation | Canonical monthly service |
| 21 | How was this PO CBM calculated? | SHP-06 | ITM-04 for measurements | Source-aware calculation |
| 22 | List pending QC requests for inspector X | QC-01 | Scoped qcs/inspections | QC request list semantics |
| 23 | Show inspection history for QC X | QC-02 | ITM-05 by item | Detail history |
| 24 | What happened in QC today? | QC-04 | QC-08 for concise summary | Event-aligned daily report |
| 25 | Inspector throughput and passed CBM this week | QC-05 | QC-04 group | Inspector performance report |
| 26 | Vendor average shipping time | QC-06 | SHP-03 + orders | Existing vendor report, with stored-status caveat |
| 27 | Weekly vendor QC summary | QC-07 | QC-04 custom dates | Whole-PO weekly view |
| 28 | Which items were Goods Not Ready today? | QC-08 | QC-04 | Latest daily snapshots |
| 29 | QA summary for vendor X | QC-09 | QC-10 | Inspector-group summary |
| 30 | Detailed QA rows for vendor X | QC-10 | None | Line evidence |
| 31 | Which inspected items lack PIS or images? | QC-11 | ITM-01 + file projection | Readiness flags |
| 32 | Show inspection weight formula errors | QC-12 | None | Deterministic error helper |
| 33 | Which inspection reports mismatch current item data? | QC-13 | ITM-11 for three-way comparison | Snapshot-vs-current definition |
| 34 | Find item X and its vendors | ITM-01 | VEN-01 | Item master |
| 35 | Does item X have active POs? | ITM-05 | ORD-01 item filter | Derived presence |
| 36 | Show item X’s order and inspection history | ITM-05 | QC-02 | Item-centric history |
| 37 | What PIS data is stored for item X? | ITM-06 | ITM-01 projection | Item PIS fields |
| 38 | Which unchecked items differ from PIS? | ITM-07 | None | Unchecked PIS-diff population |
| 39 | Export checked PIS differences | ITM-08 | None | Export-only population |
| 40 | Which inspected values differ from Master? | ITM-09 | ITM-11 | Final PIS comparison |
| 41 | Compare PIS, three inspections and Master | ITM-11 | None | Dedicated five-column comparison |
| 42 | Which PD records are Approved? | ITM-12 | Raw Item `pd_*` | Stored PD workflow state |
| 43 | How complete are Product Database details? | ITM-12 | Template + Item fields | Dynamic completion helper |
| 44 | Items with running POs and last inspection | ITM-13 | ITM-05 + ITM-12 | Composite Item Database |
| 45 | Average inspection/rejection time for item X | ITM-14 | None until validated | Product analytics formula |
| 46 | List vendors and their brand codes | VEN-01 | VEN-02 | Vendor master |
| 47 | Which finishes belong to vendor X? | VEN-04 | VEN-05 for images/items | Finish catalog |
| 48 | Which samples shipped in container ABC? | SAM-02 | SHP-03 | Sample shipment rows |
| 49 | Show my open workflow tasks | WF-03 | OTH-01 dock | Sensitive workflow service |
| 50 | Are there complaints for item X? | CMP-02 | CMP-01 | Sensitive item-related view |

## 16. Report Comparison Matrix

| Report | Grain | Inclusion definition | Date semantics | Quantity/CBM | Closest but different report |
|---|---|---|---|---|---|
| PO Status | PO/vendor | All inspected or mixed open/progressed | Current state | Derived quantities; limited totals | Open PO buckets |
| Pending PO | Order line, PO summary | Any `order - shipped > 0` | No default event window | Pending split; no CBM | Shipping Pending |
| Delayed PO | PO then lines | Effective ETD passed, open, not fully inspected before ETD | Report-date snapshot | Order/shipped/pending | Shipping Delay |
| Upcoming ETD | PO | Open and effective ETD in window | Today + 10 days default, inclusive | Counts, no primary CBM | Today ETD |
| Shipping Delay | PO | Fully packed before ETD, no shipment, ETD passed | Past relative to start date | Counts/days late | Delayed PO |
| Today ETD | PO | Original ETD matches client day | Client offset day | Status counts | Upcoming one-day window |
| Packed Goods | PO/order line + item | Qualifying passed inspection in selected period | Tuesday–Monday default or inclusive From/To inspection dates | Previously/period/total packed + CBM | Inspection history |
| Shipping Pending | Order line + frontend PO | Any unshipped quantity | Optional order-date range | Packed/pending/shipped; no CBM | Pending PO |
| Shipments | Shipment entry plus placeholders | Shipment exists or order status progressed | Stuffing-date support not wired | Shipment qty/CBM | Containers |
| Containers | Container | Nonblank container shipment rows | Stuffing date wired | Container qty/CBM/checks | Monthly Shipments |
| Monthly Shipments | Month/vendor/brand/container | Stored partial/shipped + dated nonblank container | IST month/custom | Unique containers + allocated CBM | Containers |
| Daily QC | Request + event rows | Aligned requests and exact-day activity | One report day | Requested/inspected/passed/CBM | Daily Summary |
| Daily Summary | Vendor/item | Latest Inspection per QC on day | One day | Requested/passed/open | Daily QC |
| Weekly Summary | Vendor/PO/item | Latest in-range evidence, whole PO context | Explicit/default week | Order/passed/pending/CBM | Daily Summary |
| Inspector report | Inspector/time bucket | Inspection events in range | Timeline/custom | Counts/qty/CBM | Vendor-wise QA |
| Vendor shipping report | Vendor/PO | Fully shipped groups in range | Latest stuffing date | Delay/shipping days | Monthly Shipments |
| Vendor-wise QA | Inspector or detail row | Inspection events for vendor | Timeline/custom | Requested/passed/CBM | Inspector report |
| Inspected Items | Item | Item or order-side inspection evidence | Last-inspected range | Readiness counts | Item catalog |
| Common Errors | Inspection/error | Comparable inputs violating formulas | Inspection date range | Formula deltas | QC mismatch |
| QC mismatch | Item/inspection | Historical snapshot differs from current inspected Item | Inspection timeline | Field mismatch counts | PIS diff / Final PIS |
| PIS diff | Item | Inspected differs from PIS | Current state | Size/weight/CBM/barcode diffs | Final PIS |
| Final PIS | Item | Inspected differs from Master and 3 valid POs | Current + eligibility history | Size/weight/CBM diffs | Three-inspection comparison |
| Product Analytics | Item/PO | Active order history | Order/inspection/shipping dates | Times, rejection %, totals | Vendor shipping report |

## 17. Data Dependency Matrix

Legend: **P** primary, **J** joined, **H** historical/audit, **C** configuration, **S** sensitive.

| Capability group | orders | qcs | inspections | items | vendors/brands | samples | workflow | complaints | logs/config/users |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Active orders / PO buckets | P | J |  | J |  |  |  |  |  |
| ETD/delay reports | P | J |  |  |  |  |  |  |  |
| Archive/history | P | J |  |  |  |  |  |  | H |
| Packed/Shipping Pending | P | J |  | J |  |  |  |  |  |
| Shipments/Containers | P | J |  | J |  | J |  |  |  |
| Monthly Shipments | P |  |  | J |  |  |  |  |  |
| CBM calculations | J |  |  | P |  | J |  |  |  |
| QC list/detail | J | P | J | J |  |  |  | J | S users |
| QC daily/weekly | J | P/J | P | J |  |  |  |  | S users |
| Inspector/vendor QA | J | J | P | J |  |  |  |  | S users |
| Inspected-items readiness | J | J |  | P | J |  |  |  |  |
| Common Errors | J | J | P |  |  |  |  |  |  |
| QC mismatch | J | J | P | P/J |  |  |  |  |  |
| Item catalog/detail/history | J | J | J | P | J |  |  |  |  |
| PIS/Final/comparisons | J | J | J | P |  |  |  |  |  |
| Product/Item Database | J | J | J | P |  |  |  |  | C templates/H logs |
| Vendors/brands/finishes |  |  |  | J | P |  |  |  | C |
| Samples |  |  |  | J | J | P |  |  |  |
| Generic workflow |  |  |  |  |  |  | P |  | S users/config |
| Complaints | J |  |  | J | J |  |  | P | S users/files |
| Notifications/email | J |  |  |  | J |  | J |  | P/S users |

## 18. Canonical Implementation Matrix

| Concern | Canonical implementation | Consumers | Classification | Duplication / caveat |
|---|---|---|---|---|
| Order progress/status | `backend/helpers/orderStatus.js#deriveOrderProgress` | Orders, reports, exports, frontend mirror | DERIVED_HELPER | Frontend mirror is matching duplication; some reports still prefilter stored status |
| Grouped PO status | `deriveGroupedOrderStatus` | PO bucket/client shipping grouping | DERIVED_HELPER | Client `getGroupedOrderStatus` duplicates it |
| Packed Goods inspection-period report | `backend/services/packedGoodsPeriod.service.js#buildPackedGoodsPeriodDataset` | API, page, PDF, XLS | CANONICAL_WITH_FALLBACK | Inspection history source; backend returns filtered totals/options |
| Assistant/forecast ready Packed Goods | `backend/services/packedGoods.service.js#buildPackedGoodsDataset` | Assistant, forecast | CANONICAL_WITH_FALLBACK | Current ready-to-ship semantics remain intentionally unchanged |
| Order/PO CBM | `orderCbm.service` | backfill, order reports | CANONICAL_WITH_FALLBACK | Stored total is cache/fallback |
| Shipment CBM allocation | `shipmentCbmAllocation.service` | packed, shipments, monthly, QC | CANONICAL_WITH_FALLBACK | Provenance must be retained |
| Monthly Shipments | `monthlyShipmentsReport.service` | API/drilldown/Assistant | CANONICAL_WITH_FALLBACK | Stored status prefilter |
| Valid inspection history | `validInspectionHistory.service` | Final PIS eligibility/history | CANONICAL | Requires item+PO+date+inspector; three distinct POs |
| PIS diff | Item-controller helper chain | list/report/export | DERIVED_HELPER | Should move out of 8k-line controller |
| Final PIS | `helpers/finalPisCheck.js` | API/options/report/export | DERIVED_HELPER | Misnamed PIS response keys actually mean Master |
| PIS/inspection/Master compare | `helpers/pisInspectionMasterComparison.js` | comparison detail | DERIVED_HELPER | Controller selects three distinct POs |
| Measurement mismatch | `measurementMismatchRules` + `inspectionSizeSnapshot` | PIS/QC/Final comparisons | DERIVED_HELPER | Static doc threshold stale |
| Common errors | `helpers/commonInspectionErrors.js` | report/export | DERIVED_HELPER | Dataset remains controller-local |
| Product Database state/completion | `helpers/productDatabase.js` + templates | Product DB/Item DB/export | DERIVED_HELPER | Completion changes with active template |
| PO buckets | `order.controller#buildPoBucketDataset` | filters/dashboard/export | DUPLICATED_LOGIC | High-value extraction target |
| Pending PO | `buildPendingPoReportDataset` | API/export | DUPLICATED_LOGIC | Shared only inside controller |
| Upcoming/Shipping Delay | `buildUpcomingEtdReportDataset` | two APIs/two exports | DUPLICATED_LOGIC | Two definitions behind one builder flag |
| Delayed PO | `buildReformedDelayedPoReportDataset` | API/runtime export | DUPLICATED_LOGIC | Older builder/export dead and semantically different |
| Shipments/Containers | `getShipmentDataset`/`getContainerDataset` | API/export | DUPLICATED_LOGIC | Date filter wiring inconsistent |
| Workflow tasks/dashboard | `workflowStatusService` | all workflow task reads | CANONICAL | Sensitive personnel/work metadata |
| Workflow batches | `workflowBatchService` | batch list/detail | CANONICAL | Sensitive operational metadata |
| Notifications | `notificationService` | bell/dock/summary | CANONICAL | User-private and mutable read state |

The controller-local dataset-builder count is exactly **12**: `buildPoBucketDataset`, `getShipmentDataset`, `getContainerDataset`, `buildDelayedPoReportDataset` (dead), `buildReformedDelayedPoReportDataset`, `buildUpcomingEtdReportDataset`, `buildPendingPoReportDataset`, `buildShippingPendingDataset`, `getItemDatabaseDataset`, `getItemsExportDataset`, `getInspectedItemsReportDataset`, and `buildCommonErrorsReportDataset`.

## 19. Filter Matrix

| Capability | Search / identity | Brand/vendor | Status / criterion | Date filters | Paging/sort | Known issue |
|---|---|---|---|---|---|---|
| ORD-01 | PO/item | Both | Derived status, PO bucket | Order date, ETD in richer path | max 200/server sort | `/orders` is thinner legacy path |
| ORD-04 | PO group | Both | Inspection Done/Under Inspection | Current snapshot | grouped | No export route |
| ORD-05 | PO contains | Exact both | Open quantity only | None | optional paging/sort | No CBM |
| ORD-06 | Exact PO | Multi-brand/exact vendor | Delayed definition | report date (`from_date`) | sort in builder | `passed_quantity` mislabel |
| ORD-07 | PO | Brand/vendor | Open/nonshipped | effective ETD inclusive window | server | default +10 days |
| ORD-08 | PO | Brand/vendor | Completely packed/no shipment | ETD before start | server | distinct from general delayed |
| ORD-09 | PO required/item optional | Scope enforced | None | History stored dates | none | Historical only |
| ORD-10 | None | Brand | Grouped status | one client day | group | Original ETD only |
| ORD-12 | PO/item contains | Both | Archived | None | max 200/newest | No archive-date filter |
| ORD-13 | PO evidence | Both | upload status | None | max 100/newest | Scoped redaction |
| ORD-14 | PO contains | Both | edit/archive operation | None | max 100/newest | No edit-date filter |
| SHP-01 | Exact PO | Multi-brand/exact vendor | packed qty > 0 | inclusive order date | service sort; frontend paging | Frontend fetches all |
| SHP-02 | Exact PO | Multi-brand/exact vendor | open qty > 0 | inclusive order date | service sort; frontend paging | Frontend PO grouping |
| SHP-03 | PO/item/container contains | Both | derived status | Builder supports stuffing dates | max 200/server sort | Endpoint omits date params |
| SHP-04 | Container contains | Both | checked status | Stuffing date | grouped | No export |
| SHP-05 | Drilldown dimensions | Country/brand/vendor | physical shipment | month/custom/6 months IST | grouped | Stored status prefilter |
| QC-01 | PO prefix/item | Both + inspector | inspection status/checked | request date | max 100 | QC users own-only |
| QC-04 | Separate request/inspection sort | Both | activity/action state | exact report day | grouped | Complex dual population |
| QC-05 | Inspector | Scope via joins | N/A | timeline/custom | time groups | Inspection event date |
| QC-06 | None | Both | fully shipped prefilter | latest stuffing range | vendor groups | Stored status |
| QC-07 | None | Brand | GNR/latest snapshots | weekly range | vendor groups | Mixes in-range/latest-overall |
| QC-08 | None | Brand | normalized inspection/GNR | exact day | vendor groups | Latest per QC |
| QC-09/10 | Vendor/inspector | Vendor required in summary | N/A | timeline/custom | groups/detail | No export |
| QC-11 | text | brand/vendor/country | readiness criterion yes/no | last-inspected range | max 200 | PIS summary excludes Giga |
| QC-12 | text | brand/vendor | error type | inspection range | report paging | Positive inputs only |
| QC-13 | PO/item | brand/vendor/inspector | inspection status/mismatch-only | timeline/range | max 200 | Comments separate |
| ITM-01 | code/name/description | brand/vendor/country | file type | None | max 200/newest | Full documents |
| ITM-07 | text | brand/vendor/country | unchecked/non-rectify | current state | max 200 | Diff built in memory |
| ITM-09 | text | brand/vendor/country | diff field | current + 3-PO history | max 200/sort | Master required |
| ITM-12 | text | brand/vendor | PD status/completion | current state | max 200 | Dynamic template completion |
| ITM-13 | text | brand/vendor | PD status/completion/running PO | current state | max 200 | Stored running status |
| ITM-14 | text | brand/vendor | None | all active history | client page/limit uncapped | Formula validation needed |
| SAM-01/03 | text | brand/vendor | None | updatedAt range | max 200 | Updated date, not created date |
| SAM-02 | text/container | brand/vendor | checked in output | None | max 200 | Container filter after DB read |
| WF-02 | text/creator | brand | batch/task type | created range | service max | Visibility varies by role |
| WF-03 | text/assignee/etc. | brand | many pseudo-statuses/source | active due range | service max | Personnel-sensitive |
| CMP-01 | broad text/item/creator | brand/vendor | category/archived | created range | max 100 | Defaults active only |

## 20. Assistant Integration Recommendations

This section is a future integration plan only. No Assistant code, schema catalog, prompt, tool, or Knowledge Base entry was changed during this audit.

### 20.1 Recommendation allocation

| Recommendation | Count | Capability IDs | Required treatment |
|---|---:|---|---|
| DIRECT_CAPABILITY | 3 | SHP-01, SHP-05, SHP-06 | Reuse the existing shared service and preserve access/provenance |
| EXTRACT_TO_SERVICE_THEN_CAPABILITY | 28 | ORD-02, ORD-04–08, ORD-10–11, SHP-02–04, QC-04–13, ITM-05, ITM-07, ITM-09, ITM-11, ITM-13–14, SAM-02 | Move the existing builder/aggregation intact into a service, add focused tests, then register |
| CAPABILITY_PLUS_MONGO | 9 | ORD-01, ORD-03, QC-01–02, ITM-01, ITM-04, ITM-06, ITM-12, VEN-01 | Use a bounded capability for business semantics; allow safe raw projection for unmodeled fields |
| RAW_MONGO | 9 | ORD-09, ORD-12, ITM-03, ITM-16, VEN-02–04, SAM-01, SAM-03 | Safe scoped projection; no custom report logic needed |
| FORECAST_INPUT | 0 | None currently | Do not designate one until ITM-14 formulas and the delay definitions are confirmed |
| NOT_ASSISTANT_SAFE | 19 | ORD-13–15, ITM-15, WF-01–06, CMP-01–03, OTH-01–02, OTH-04, SEC-01–03 | Keep excluded unless a separately permissioned, purpose-limited design is approved |
| EXPORT_ONLY | 5 | QC-03, ITM-02, ITM-08, ITM-10, OTH-03 | Render/download only; route analytical questions to the underlying dataset |
| PRESENTATION_ONLY | 1 | VEN-05 | Do not register as analytical capability |

The **Assistant-useful total is 49** (`DIRECT` + `EXTRACT` + `CAPABILITY_PLUS_MONGO` + `RAW_MONGO`). Twenty-five are not general analytical tools: 19 explicitly unsafe, five export-only and one presentation-only.

### 20.2 Recommended extraction order

1. **Order report core:** extract `buildPoBucketDataset`, Pending PO, reformed Delayed PO and Upcoming/Shipping Delay. Resolve the duplicate delayed export and field naming first.
2. **Logistics core:** extract Shipping Pending, Shipment and Container builders together so one filter/provenance contract covers all three.
3. **QC reports:** extract Daily/Weekly/Inspector/Vendor/QA datasets, then Common Errors, Inspected Items and QC Mismatch. Keep Inspection event dates and snapshot/current provenance explicit.
4. **Item comparison core:** extract PIS diff, Final PIS and three-inspection comparison. Rename Master-facing payload keys at a versioned boundary, not inside the current UI contract.
5. **Composite analytics:** extract Item Database and Product Analytics only after replacing stored-status dependencies and confirming formulas.
6. **Samples:** extract shipped-sample rows so shipment/container and sample pages share one service.

### 20.3 Capability contract requirements

Every future capability should:

- enforce existing `applyDataAccessMatch`/permission scope before any grouping;
- return the capability ID, source class, generated-at time, filters, row limit and collection/service provenance;
- label stored versus derived fields and explicitly expose `cbm_source` or fallback use;
- use `deriveOrderProgress` for current analytical status unless the report’s audited definition intentionally uses stored status;
- define date timezone, inclusivity and which event date is filtered;
- cap rows and disallow unbounded exports, signed file URLs, raw comments, actors, emails, phone numbers and security fields;
- never allow report tools to call mutation endpoints;
- route ambiguous “delay,” “pending,” “packed,” “PIS mismatch,” and “inspection mismatch” language through the definitions in Sections 14–16.

### 20.4 Raw Mongo boundary

The existing Assistant raw catalog allows orders, items, qcs, inspections, samples, brands and vendors and denies users, sessions, permissions/security, notifications, email logs, audit logs, inspectors and Assistant stores. Keep that deny boundary. For new collection access, prefer a purpose-built capability over adding workflow, complaints, communication or logs to the generic catalog.

## 21. Audit Findings

| Severity | Finding | Evidence / effect | Recommended follow-up (not performed) |
|---|---|---|---|
| Critical | Email Logs router is unmounted | UI calls `/email-logs*`; router/controller exist; `backend/index.js` has no import or `app.use` | Decide permissions, mount the router, add route smoke tests |
| High | Delayed PO export is defined twice | Later `exports.exportDelayedPoReport` replaces earlier function; older rich builder/export is dead and uses different ETD semantics | Remove dead definition after confirming desired workbook and effective-ETD rule |
| High | Delayed row field is semantically wrong | Reformed row `passed_quantity` receives `inspected_unshipped_quantity` | Rename/version field or populate actual passed quantity |
| High | Stored status bypasses canonical derivation | Monthly Shipments, Item Database running PO and QC Vendor report prefilter `orders.status` | Replace prefilters with shipment/QC derivation or explicitly certify stored status synchronization |
| High | Final PIS contract contradicts its name/catalog | Executable helper compares Inspected to Master, requires Master and 3 valid POs; internal `pis_*` keys mean Master; no PIS fallback | Confirm intended business definition, then version payload/docs consistently |
| High | Product Analytics formulas may double count | Sums `Inspection.passed`; repeated snapshots may be cumulative; rejection iteration is nonstandard | Confirm whether passed is incremental, then add fixture-based formulas/tests |
| Medium | Shipment stuffing-date filters are dropped | Internal builder supports dates; Shipment API/export callers omit them; Container caller passes them | Wire identical date parameters through API/export |
| Medium | Shipment placeholder rows look physical | Progressed orders without shipment entries emit quantity/pending rows with no shipment CBM | Add explicit `is_placeholder`/`has_shipment` and exclude from physical-shipment questions |
| Medium | Today ETD ignores revised ETD | Dashboard filters `ETD`, whereas most delay/upcoming reports prefer revised ETD when set | Confirm “original promise” versus “current effective date” and rename or change |
| Medium | Vendor shipping report has unreachable logic | It first selects fully shipped PO groups, then contains branches for unshipped timing | Remove dead branch or widen intended population after confirmation |
| Medium | Measurement documentation is stale | `MEASUREMENT_MISMATCH_COMPARISON_FLOW.md` says 1 cm item tolerance; code is 0.5 cm | Update doc from executable constants |
| Medium | Shipping Pending catalog wording is too narrow | Current builder includes every unshipped line, including zero packed quantity | Define it as open/unshipped, not inspected/available |
| Medium | Inspected-items PIS summary excludes Giga | Hard-coded behavior can surprise cross-brand totals | Confirm business exception and document it in UI/API metadata |
| Medium | Audit pages lack date filters | Upload and order-edit reads only filter identity/status/operation | Add date filters if histories become operational reports |
| Medium | Broad workflow user options | `/workflow/users` returns all names/emails/roles to any workflow viewer | Review least-privilege projection and audience |
| Low | Frontend duplicates presentation calculations | Packed Goods totals/filtering and Shipping Pending PO grouping are client-side; order-status mirror duplicates backend | Keep presentation-only or return server grouping when one contract is desired |
| Low | Static API map can be mistaken for truth | Generated files list missing/duplicate routes at generation time and do not resolve mounts/runtime overrides | Regenerate after route fixes and always retain source audit date |
| Low | Several large controller-local reports lack focused tests | 12 named builders, only selected reports have direct fixtures | Add one behavior-focused test per extracted service |

No business behavior was changed to address these findings because this task explicitly requested discovery only.

## 22. Coverage Statistics

| Measure | Exact count | Counting rule |
|---|---:|---|
| Capability groups in Master Index | **74** | One stable ID per distinct business read/report/support/control capability group |
| Order-management capabilities | 15 | ORD-01–15 |
| Shipment/logistics capabilities | 6 | SHP-01–06 |
| QC/inspection capabilities | 13 | QC-01–13 |
| Item/PIS/Product capabilities | 16 | ITM-01–16 |
| Vendor/brand capabilities | 5 | VEN-01–05 |
| Sample capabilities | 3 | SAM-01–03 |
| Workflow capabilities | 6 | WF-01–06 |
| Complaint capabilities | 3 | CMP-01–03 |
| Other business/platform reads | 4 | OTH-01–04 |
| Sensitive/control-plane groups | 3 | SEC-01–03 |
| Report/report-like frontend pages | **57** | Primary read/filter/aggregate/history surfaces listed in Section 2.3 |
| Backend GET declarations scanned | **133** | Regex count of `router.get` across all 23 routers |
| Primary-mount reachable GET declarations | **129** | 133 less four GETs in unmounted Email Logs router; excludes duplicate `/api` aliases |
| Explicit report endpoint declarations | **24** | Paths containing report/report namespace plus associated exports/drilldown/QC-mismatch-comment support; excludes PDF health as business data |
| Canonical reusable services | **8** | Packed Goods, Monthly Shipments, Shipment CBM, Order CBM, Valid Inspection History, Workflow Status, Workflow Batch, Notification |
| Material derived helpers | **12** | Backend order status, box measurement, common errors, mismatch rules, inspection snapshots, Final PIS, PIS comparison, Product Database, vendor reference; frontend order status, shipping-pending grouping, monthly chart packing |
| Controller-local dataset builders | **12** | Exact names in Section 18; 11 live and one dead |
| Assistant-useful capability groups | **49** | Direct + extract + capability/Mongo + raw Mongo |
| Explicitly sensitive/non-eligible groups | **19** | `NOT_ASSISTANT_SAFE` rows |
| Other non-analytical groups | **6** | Five export-only + one presentation-only |
| Backend/frontend test files | **63** | 55 backend + 8 frontend test files |
| Test/it cases | **354** | Source occurrences in those test files |

Source-class distribution across the 74 groups: 20 `CANONICAL`, 12 `CANONICAL_WITH_FALLBACK`, nine `DERIVED_HELPER`, seven `RAW_COLLECTION`, two `PRESENTATION_ONLY`, 23 `DUPLICATED_LOGIC`, and one `UNCLEAR`.

The 24 explicit report endpoints are: nine order report/view-export declarations (PO Status; Pending, Delayed, Upcoming ETD and Shipping Delay view/export), five QC report declarations (Daily, Inspectors, Vendors, Weekly Summary, Daily Summary), and ten report-router declarations (Vendor-wise QA summary/detail, Monthly Shipments view/drilldown, QC Mismatch view/comment-read support, Common Errors view/export, Inspected Items view/export).

## 23. Uncertainties / Questions Requiring Business Confirmation

1. Should “Today ETD” use original `ETD` as it does now, or effective `revised_ETD || ETD`?
2. Is the reformed Delayed PO rule authoritative, particularly “not completely inspected before ETD,” or should the overwritten older rule/workbook survive?
3. Should reformed delayed rows expose actual cumulative passed quantity, inspected-unshipped quantity, or both?
4. Is Shipping Pending intentionally every unshipped order line, or should it require inspected/packed quantity?
5. Should shipment pages include progressed-order placeholders with no physical shipment entry? If yes, what user-facing name distinguishes them?
6. Are shipment stuffing-date filters intended in the Shipment page/API/export, given that the shared builder and Container page support them?
7. Is `orders.status` guaranteed synchronously correct enough for Monthly Shipments, Item Database running POs and vendor shipping performance, or must all three derive progress?
8. In Monthly Shipments, what is the physical-container identity when container labels repeat across time/vendors/invoices? Confirm the service’s normalization key.
9. Does “fully packed before ETD” require the last inspection date strictly before ETD, or is same-day completion on time?
10. Is Final PIS Check intended to compare Inspected versus Master only, or should PIS be a fallback/reference as the Knowledge Base currently states?
11. Is the three-distinct-inspected-PO requirement mandatory for Final PIS Check, the comparison page only, or both?
12. Should Final PIS output expose barcode/country differences as top-level diff fields? Current fixed list is Item Size, Box Size, Weight and CBM.
13. Are Inspection `passed` values incremental per visit or cumulative snapshots? Product Analytics depends on this answer.
14. What is the approved rejection-percentage formula for multi-inspection POs?
15. Should vendor shipping performance include partially shipped/open POs, since current unshipped branches cannot execute?
16. Is Giga’s exclusion from the Inspected Items PIS summary an enduring rule or a temporary exception?
17. Should PIS Diff checked exports recompute only items that still differ, or preserve a historical “was checked with differences” snapshot?
18. Which Item measurement source is authoritative for each user-facing context: current inspected, PIS, accepted Master, or Product Database? Existing reports intentionally choose different references.
19. Are vendor names historical snapshots allowed to differ from current Vendor master names, and should grouping use `vendor_id` whenever present?
20. Should Sample Workflow remain a separate record system long term, or is any relationship to generic workflow batches/tasks intended?
21. Who should be authorized to read Email Logs? The current unmounted router requires authentication but no explicit permission.
22. Should complaint categories alone ever be Assistant-readable, or should the entire complaints domain remain excluded?
23. Should workflow viewers see every user’s email/role through `/workflow/users`, or only assignable/accessible users?
24. Which controller-local reports are contractual public reports versus internal UI read models? This determines extraction/versioning priority.
25. Are the `/api/*` dual mounts a supported external contract or compatibility aliases that can eventually be retired?

Until these are answered, the existing executable behavior described in this document is the audit truth; recommendations should not be interpreted as authorization to change it.
