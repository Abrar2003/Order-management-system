# OMS Knowledge Base V2

## Scope and version

The runtime Knowledge Base is version **2.0.0**. This is the material migration from the former 28-capability Step-1/Step-2 abstraction to the **74 audited capability groups** in `OMS_REPORTS_AND_FUNCTIONS_SUMMARY.md`.

V2 is complete discovery metadata for the next OMS Assistant capability-execution phase. It does **not** register all 49 Assistant-useful capabilities as tools, extract controller-local reports, alter report calculations, change forecasting, widen raw Mongo access, or change Gemini orchestration. Existing Assistant functionality remains in place; the explicit capability adapter registry still contains only `packed_goods` and `monthly_shipments`.

Runtime files:

- `backend/knowledge/omsKnowledgeBase.catalog.js` — domains, collections, relationships, source-of-truth rules, business definitions, risks, and the assembled frozen catalog.
- `backend/knowledge/omsKnowledgeBase.capabilities.js` — the 74 audited capability records, concept mappings, ambiguities, and 25 business-confirmation questions.
- `backend/knowledge/omsKnowledgeBase.schema.js` — referential, classification, source-path, readiness, and safety validation.
- `backend/services/omsKnowledgeBase.service.js` — deterministic lookup/search; no embeddings, model, network, or database dependency.

## Coverage and classification

| Recommendation | Count | Meaning |
| --- | ---: | --- |
| `DIRECT_CAPABILITY` | 3 | Existing reusable canonical implementation |
| `EXTRACT_TO_SERVICE_THEN_CAPABILITY` | 28 | Current controller/helper logic must become a reusable service first |
| `CAPABILITY_PLUS_MONGO` | 9 | Bounded business capability plus approved raw projection |
| `RAW_MONGO` | 9 | Safe scoped projection is the intended future treatment |
| `FORECAST_INPUT` | 0 | None approved; Product Analytics formulas require confirmation |
| `NOT_ASSISTANT_SAFE` | 19 | Sensitive/control/mutation-adjacent; not executable |
| `EXPORT_ONLY` | 5 | Workbook/PDF generation only; use underlying data for analytics |
| `PRESENTATION_ONLY` | 1 | UI options/images only |

| Source class | Count |
| --- | ---: |
| `CANONICAL` | 20 |
| `CANONICAL_WITH_FALLBACK` | 12 |
| `DERIVED_HELPER` | 9 |
| `RAW_COLLECTION` | 7 |
| `PRESENTATION_ONLY` | 2 |
| `DUPLICATED_LOGIC` | 23 |
| `UNCLEAR` | 1 |

The 74 capabilities span 14 Knowledge Base domains: order management, shipment/logistics, quality control, catalog/master data, product information, samples, workflow, complaints, communication, reporting/exports, access/security, audit/history, platform operations, and Assistant platform context.

## Capability metadata contract

Every capability records:

- runtime ID and stable audit ID;
- name, domain, description, business purpose, and result type/grain;
- source class, Assistant recommendation, and separate runtime readiness status;
- keywords, unambiguous aliases, intent examples, and business-concept mappings;
- contributing collections and relationship IDs;
- implemented routes and canonical file/symbols;
- canonical/reusable/controller-local/fallback source-of-truth metadata;
- real filter names, aliases, types, required state, and semantics;
- output field meaning/type/provenance;
- date/timezone, quantity, CBM, and status semantics;
- raw Mongo policy, safety boundary, limitations, risks, and uncertainty references.

Readiness statuses are `ready`, `not_ready`, `blocked_business_confirmation`, `not_tool_eligible`, and `existing_assistant_feature`. Recommendation is architectural treatment; readiness is current runtime state. A controller-local report is not marked ready merely because its handler exists.

## Complete capability map

| Audit ID | Runtime capability ID | Name | Source class | Assistant recommendation | Assistant status | Canonical source |
| --- | --- | --- | --- | --- | --- | --- |
| ORD-01 | `order_list` | Active order lines | CANONICAL_WITH_FALLBACK | CAPABILITY_PLUS_MONGO | existing_assistant_feature | `backend/controllers/order.controller.js#getOrdersByFiltersDb` |
| ORD-02 | `po_buckets` | Open/inspected/shipped PO buckets | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/order.controller.js#buildPoBucketDataset` |
| ORD-03 | `order_detail` | Order/PO detail | CANONICAL_WITH_FALLBACK | CAPABILITY_PLUS_MONGO | not_ready | `backend/controllers/order.controller.js#getOrderById` |
| ORD-04 | `po_status_report` | PO Status report | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/order.controller.js#getPoStatusReport` |
| ORD-05 | `pending_po` | Pending PO report | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/order.controller.js#buildPendingPoReportDataset` |
| ORD-06 | `delayed_po` | Delayed PO report | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/order.controller.js#buildReformedDelayedPoReportDataset` |
| ORD-07 | `upcoming_etd` | Upcoming ETD report | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/order.controller.js#buildUpcomingEtdReportDataset` |
| ORD-08 | `shipping_delay` | Shipping Delay report | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/order.controller.js#buildUpcomingEtdReportDataset` |
| ORD-09 | `revised_etd_history` | Revised ETD history | RAW_COLLECTION | RAW_MONGO | not_ready | `backend/controllers/order.controller.js#getRevisedEtdHistory` |
| ORD-10 | `today_etd` | Today ETD dashboard | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/order.controller.js#getTodayEtdOrdersByBrand` |
| ORD-11 | `brand_vendor_dashboard` | Brand/vendor status dashboard | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/order.controller.js#getVendorSummaryByBrand` |
| ORD-12 | `archived_orders` | Archived orders | CANONICAL_WITH_FALLBACK | RAW_MONGO | not_ready | `backend/controllers/order.controller.js#getArchivedOrders` |
| ORD-13 | `order_upload_logs` | Order upload/import logs | RAW_COLLECTION | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/controllers/order.controller.js#getUploadLogs` |
| ORD-14 | `order_edit_logs` | Order edit/archive logs | RAW_COLLECTION | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/controllers/order.controller.js#getOrderEditLogs` |
| ORD-15 | `order_entry_options` | Previous order lookup and entry options | CANONICAL_WITH_FALLBACK | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/controllers/order.controller.js#lookupPreviousOrder` |
| SHP-01 | `packed_goods` | Packed Goods | CANONICAL_WITH_FALLBACK | DIRECT_CAPABILITY | existing_assistant_feature | `backend/services/packedGoods.service.js#buildPackedGoodsDataset` |
| SHP-02 | `shipping_pending` | Shipping Pending | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/order.controller.js#buildShippingPendingDataset` |
| SHP-03 | `shipments` | Shipment rows | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | existing_assistant_feature | `backend/controllers/order.controller.js#getShipmentDataset` |
| SHP-04 | `containers` | Container aggregation | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | existing_assistant_feature | `backend/controllers/order.controller.js#getContainerDataset` |
| SHP-05 | `monthly_shipments` | Monthly Shipments | CANONICAL_WITH_FALLBACK | DIRECT_CAPABILITY | existing_assistant_feature | `backend/services/monthlyShipmentsReport.service.js#getMonthlyShipmentsReportData` |
| SHP-06 | `shipment_cbm` | PO/shipment/sample CBM allocation | CANONICAL_WITH_FALLBACK | DIRECT_CAPABILITY | existing_assistant_feature | `backend/services/shipmentCbmAllocation.service.js#resolveOrderRowCbmSummary` |
| QC-01 | `qc_list` | QC request list | CANONICAL_WITH_FALLBACK | CAPABILITY_PLUS_MONGO | not_ready | `backend/controllers/qc.controller.js#getQCList` |
| QC-02 | `qc_detail` | QC detail and inspection report | CANONICAL_WITH_FALLBACK | CAPABILITY_PLUS_MONGO | not_ready | `backend/controllers/qc.controller.js#getQCById` |
| QC-03 | `qc_workbook` | QC list workbook | DUPLICATED_LOGIC | EXPORT_ONLY | not_tool_eligible | `backend/controllers/qc.controller.js#exportQCList` |
| QC-04 | `daily_qc` | Daily QC report | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/qc.controller.js#getDailyReport` |
| QC-05 | `inspector_performance` | Inspector performance report | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/qc.controller.js#getInspectorReports` |
| QC-06 | `vendor_shipping_performance` | Vendor shipping performance | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/qc.controller.js#getVendorReports` |
| QC-07 | `weekly_qc_summary` | Weekly order/QC summary | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/qc.controller.js#getWeeklyOrderSummary` |
| QC-08 | `daily_qc_summary` | Daily order/QC summary | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/qc.controller.js#getDailyOrderSummary` |
| QC-09 | `vendor_qa_summary` | Vendor-wise QA summary | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/reports.controller.js#getVendorWiseQaSummary` |
| QC-10 | `vendor_qa_detail` | Vendor-wise QA detail | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/reports.controller.js#getVendorWiseQaDetailed` |
| QC-11 | `inspected_items` | Inspected-items readiness | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/reports.controller.js#getInspectedItemsReportDataset` |
| QC-12 | `common_inspection_errors` | Common inspection errors | DERIVED_HELPER | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/helpers/commonInspectionErrors.js#evaluateCommonInspectionErrors` |
| QC-13 | `qc_report_mismatch` | QC report mismatch | DERIVED_HELPER | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/helpers/inspectionSizeSnapshot.js#compareInspectionSizeSnapshot` |
| ITM-01 | `item_catalog` | Item catalog | CANONICAL | CAPABILITY_PLUS_MONGO | existing_assistant_feature | `backend/controllers/item.controller.js#getItems` |
| ITM-02 | `item_workbook` | Item catalog and running-PO workbook | DUPLICATED_LOGIC | EXPORT_ONLY | not_tool_eligible | `backend/controllers/item.controller.js#getItemsExportDataset` |
| ITM-03 | `accepted_item_masters` | Accepted item masters | CANONICAL | RAW_MONGO | not_ready | `backend/controllers/item.controller.js#getItemMasters` |
| ITM-04 | `item_detail` | Item detail and file availability | CANONICAL_WITH_FALLBACK | CAPABILITY_PLUS_MONGO | not_ready | `backend/controllers/item.controller.js#getItemDetails` |
| ITM-05 | `item_history` | Item order presence and history | CANONICAL_WITH_FALLBACK | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/item.controller.js#getItemOrderPresence` |
| ITM-06 | `pis_data` | PIS catalog and PIS file view | CANONICAL | CAPABILITY_PLUS_MONGO | existing_assistant_feature | `backend/controllers/item.controller.js#getItems` |
| ITM-07 | `pis_differences` | Unchecked PIS differences | DERIVED_HELPER | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/item.controller.js#getPisDiffItems` |
| ITM-08 | `checked_pis_difference_export` | Checked PIS difference report | DERIVED_HELPER | EXPORT_ONLY | not_tool_eligible | `backend/controllers/item.controller.js#getCheckedPisDiffRowsForReport` |
| ITM-09 | `final_pis_check` | Final PIS Check (Inspected vs Master) | DERIVED_HELPER | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/helpers/finalPisCheck.js#finalPisCheck` |
| ITM-10 | `final_pis_export` | Final PIS Check report | DERIVED_HELPER | EXPORT_ONLY | not_tool_eligible | `backend/controllers/item.controller.js#buildFinalPisCheckReportPayload` |
| ITM-11 | `pis_inspection_master_comparison` | PIS / inspections / Master comparison | DERIVED_HELPER | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/helpers/pisInspectionMasterComparison.js#buildComparisonRows` |
| ITM-12 | `product_database` | Product Database | DERIVED_HELPER | CAPABILITY_PLUS_MONGO | not_ready | `backend/helpers/productDatabase.js#buildProductDatabaseRow` |
| ITM-13 | `item_database` | Item Database composite | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/item.controller.js#getItemDatabaseDataset` |
| ITM-14 | `product_analytics` | Product Analytics | DUPLICATED_LOGIC | EXTRACT_TO_SERVICE_THEN_CAPABILITY | blocked_business_confirmation | `backend/controllers/item.controller.js#groupProductAnalyticsRows` |
| ITM-15 | `pis_update_logs` | PIS/Product/Master update history | RAW_COLLECTION | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/controllers/item.controller.js#getPisUpdateLogs` |
| ITM-16 | `product_type_templates` | Product Type Templates | CANONICAL | RAW_MONGO | not_ready | `backend/controllers/productTypeTemplate.controller.js#getProductTypeTemplates` |
| VEN-01 | `vendor_master` | Vendor master list and workbook | CANONICAL | CAPABILITY_PLUS_MONGO | existing_assistant_feature | `backend/controllers/vendor.controller.js#getVendors` |
| VEN-02 | `brand_vendor_options` | Brand/vendor option sets | CANONICAL | RAW_MONGO | not_ready | `backend/controllers/vendor.controller.js#getVendorBrandOptions` |
| VEN-03 | `brand_identity` | Brand identity, logo, and calendar | CANONICAL | RAW_MONGO | not_ready | `backend/controllers/brand.controller.js#getAllBrands` |
| VEN-04 | `finishes` | Finish catalog | CANONICAL_WITH_FALLBACK | RAW_MONGO | not_ready | `backend/controllers/finish.controller.js#getFinishes` |
| VEN-05 | `finish_presentation` | Finish vendor/item options and images | PRESENTATION_ONLY | PRESENTATION_ONLY | not_tool_eligible | `backend/controllers/finish.controller.js#getFinishVendorOptions` |
| SAM-01 | `samples` | Sample catalog | CANONICAL | RAW_MONGO | existing_assistant_feature | `backend/controllers/sample.controller.js#getSamples` |
| SAM-02 | `shipped_samples` | Shipped samples | DERIVED_HELPER | EXTRACT_TO_SERVICE_THEN_CAPABILITY | not_ready | `backend/controllers/sample.controller.js#flattenSampleShipmentRows` |
| SAM-03 | `sample_workflow` | Separate sample workflow list | CANONICAL | RAW_MONGO | not_ready | `backend/controllers/sampleWorkflow.controller.js#getSampleWorkflows` |
| WF-01 | `workflow_dashboard` | Workflow dashboard | CANONICAL | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/services/workflow/workflowStatusService.js#getWorkflowDashboardSummary` |
| WF-02 | `workflow_batches` | Workflow batches and detail | CANONICAL | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/services/workflow/workflowBatchService.js#listWorkflowBatches` |
| WF-03 | `workflow_tasks` | Workflow task board/list | CANONICAL | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/services/workflow/workflowStatusService.js#listWorkflowTasks` |
| WF-04 | `workflow_task_detail` | Workflow task detail/history/comments | CANONICAL | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/controllers/workflow/task.controller.js#buildTaskDetail` |
| WF-05 | `workflow_users` | Workflow assignable users | RAW_COLLECTION | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/controllers/workflow/task.controller.js#getWorkflowAssignableUsers` |
| WF-06 | `workflow_configuration` | Workflow task types and departments | CANONICAL | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/routers/workflow.routes.js` |
| CMP-01 | `complaints` | Complaint list and detail | CANONICAL | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/controllers/complaint.controller.js#getComplaints` |
| CMP-02 | `item_complaints` | Item-related complaints | CANONICAL | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/controllers/complaint.controller.js#getItemRelatedComplaints` |
| CMP-03 | `complaint_categories` | Complaint categories | CANONICAL | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/controllers/complaint.controller.js#getComplaintCategories` |
| OTH-01 | `notifications` | Notifications and workflow dock | CANONICAL | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/services/notificationService.js` |
| OTH-02 | `email_logs` | Email logs and options | UNCLEAR | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/routers/emailLogs.routes.js` |
| OTH-03 | `pdf_exports` | Shared PDF rendering/status | PRESENTATION_ONLY | EXPORT_ONLY | not_tool_eligible | `backend/services/pdfRenderer.js#renderPdf` |
| OTH-04 | `job_status` | Queue/job status | CANONICAL | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/controllers/jobs.controller.js#getQueueStatus` |
| SEC-01 | `identity_sessions` | Identity, user list, and current session | RAW_COLLECTION | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/controllers/auth.controller.js` |
| SEC-02 | `permissions` | Role permissions and user data access | CANONICAL | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/services/permission.service.js` |
| SEC-03 | `security_platform` | Security, OAuth, and Assistant platform state | RAW_COLLECTION | NOT_ASSISTANT_SAFE | not_tool_eligible | `backend/services/securityMonitoringService.js` |

## Source-of-truth rules

### Order status

Current analytical order progress/status uses `backend/helpers/orderStatus.js#deriveOrderProgress`. Stored `orders.status` is not consistently authoritative. Three audited implementations intentionally retain a stored-status prefilter as current executable behavior and are flagged, not silently fixed:

- Monthly Shipments;
- Item Database running PO;
- QC Vendor Shipping Performance.

PO Status report groups, dashboard buckets, and frontend pseudo-statuses remain separate report classifications even when they start from derived line progress.

### CBM

CBM-aware capabilities point to `shipmentCbmAllocation.service.js`/`orderCbm.service.js`; metadata never embeds a substitute formula. The canonical hierarchy is current inspected measurements, PIS measurement fallback where the canonical service supports it, applicable stored Item CBM variants, then `orders.total_po_cbm` only as a labelled final fallback. Partial quantities may be prorated only where the current service does so, and `cbm_source`/fallback provenance is required.

Packed Goods is the reference contract: it is an order-line dataset containing only `inspected_unshipped_quantity > 0`, with brand(s), vendor, PO aliases, and inclusive order-date filters. It must not be reconstructed from stored `orders.status` or `total_po_cbm` alone.

### Shipment distinctions

| Concept | Executable definition | Grain |
| --- | --- | --- |
| Packed Goods | Passed/inspected quantity remaining unshipped, strictly positive | Order line |
| Shipping Pending | Every unshipped line, including zero packed quantity | Order line plus frontend PO presentation |
| Shipment rows | Physical embedded shipment entries plus documented progressed-order placeholders | Shipment entry or placeholder |
| Containers | Nonblank-container aggregation of shipment rows | Container |
| Monthly Shipments | IST period/vendor/brand/unique-container aggregation with allocated CBM | Month/vendor/brand/container summaries |
| Shipment CBM | Calculation/allocation service, not a report dataset | Order/shipment/sample calculation |

### Final PIS and comparison truth

Final PIS Check currently compares **Inspected versus Master**, requires Master evidence and three distinct valid inspected POs, and has no PIS fallback. Internal `pis_*` response keys can contain Master/reference values. PIS Differences, Final PIS, PIS/three-Inspection/Master comparison, and QC Report Mismatch remain four separate capabilities with different populations and references.

## Business routing and ambiguity

Unambiguous examples:

| User language | Capability |
| --- | --- |
| goods ready / ready to ship / ready CBM | `packed_goods` |
| shipping pending / unshipped quantity | `shipping_pending` |
| delayed PO | `delayed_po` |
| packed PO late for shipment / shipping delay | `shipping_delay` |
| upcoming ETD | `upcoming_etd` |
| today ETD | `today_etd` |
| monthly shipment | `monthly_shipments` |

The catalog records seven explicit ambiguity groups: `delay`, `pending`, `packed`, `shipment`, `PIS mismatch`, `inspection mismatch`, and `order status`. Each stores candidate capability IDs, a clarification prompt, and executable distinctions. For example, `delay` exposes both `delayed_po` and `shipping_delay`; `PIS mismatch` exposes `pis_differences`, `final_pis_check`, `pis_inspection_master_comparison`, and `qc_report_mismatch`. Ambiguous bare phrases are not global one-target aliases.

`searchCapabilities()` searches runtime ID, audit ID, name, description, business purpose, domain, keywords, capability aliases, intent examples, and business-concept mappings. Results remain deterministic and include `matchScore`, `matchedTerms`, `ambiguityFlag`, Assistant recommendation, and Assistant status.

## Sensitive, export, and presentation boundary

All 19 `NOT_ASSISTANT_SAFE` groups remain `not_tool_eligible`, and their raw Mongo mode is `denied`. This includes upload/edit/PIS audit logs, workflow, complaints, notifications, email logs, job/control state, users/sessions, permissions, security/OAuth, and Assistant internal state. A purpose-built capability may later join a sensitive collection internally only if it returns an explicitly approved projection; the generic raw Mongo deny boundary is unchanged.

QC workbook, Item workbook, checked PIS difference export, Final PIS export, and the PDF renderer remain `EXPORT_ONLY`. Finish vendor/item/image support remains `PRESENTATION_ONLY`. Neither class is analytical-ready.

## Current high-risk findings

- Email Logs router exists but is not mounted; the UI's intended reads 404 and read permission is unresolved.
- `exportDelayedPoReport` is assigned twice; the later reformed implementation overrides the older richer export.
- Monthly Shipments, Item Database, and QC Vendor Shipping Performance depend on stored order-status prefilters.
- Delayed PO, Shipping Delay, and frontend overdue-pending use different definitions.
- Final PIS old Knowledge Base wording was wrong: current behavior is Inspected versus Master with no PIS fallback.
- Shipment stuffing-date filters are accepted by the shared builder but not wired by Shipment API/export callers.
- Static mismatch documentation says 1 cm while executable item-size comparison uses greater than 0.5 cm.

These are metadata/risk records only. V2 does not change the underlying report behavior.

## Unresolved business-confirmation questions

1. Should Today ETD use original ETD or effective `revised_ETD || ETD`?
2. Is the reformed Delayed PO rule authoritative, or should the overwritten older rule/workbook survive?
3. Should reformed delayed rows expose cumulative passed, inspected-unshipped, or both?
4. Is Shipping Pending intentionally every unshipped line, or should it require packed quantity?
5. Should Shipment pages include progressed-order placeholders, and what should they be called?
6. Should Shipment page/API/export wire the shared stuffing-date filters?
7. Can stored order status be trusted by Monthly Shipments, Item Database, and the vendor shipping report, or must they derive progress?
8. What is physical-container identity when labels repeat across time/vendors/invoices?
9. Does fully packed before ETD require inspection strictly before ETD, or is same-day completion on time?
10. Is Final PIS intended to compare Inspected versus Master only, or should PIS be a fallback/reference?
11. Where is the three-distinct-inspected-PO rule mandatory?
12. Should Final PIS expose barcode/country as top-level difference fields?
13. Are Inspection `passed` values incremental or cumulative?
14. What is the approved multi-inspection rejection-percentage formula?
15. Should vendor shipping performance include partially shipped/open POs?
16. Is Giga's exclusion from the Inspected Items PIS summary permanent?
17. Should checked PIS exports recompute current differences or preserve historical checked-difference state?
18. Which Item measurement source is authoritative in each user-facing context?
19. May historical vendor snapshots differ from current Vendor names, and should grouping prefer `vendor_id`?
20. Should Sample Workflow remain separate from generic workflow?
21. Who may read Email Logs?
22. May complaint categories ever be Assistant-readable separately?
23. Should workflow viewers see every user's email/role?
24. Which controller-local reports are contractual versus internal UI read models?
25. Are `/api/*` dual mounts supported contracts or compatibility aliases?

The catalog stores these as `BQ-01` through `BQ-25` and links affected capabilities. Product Analytics is `blocked_business_confirmation`; other capabilities continue to describe current executable behavior without pretending it is a desired future rule.

## Planned execution architecture

```text
question
  -> deterministic V2 Knowledge Base search and ambiguity detection
  -> planner sees only a compact relevant subset
  -> recommendation/status decides direct adapter, extraction requirement,
     capability-plus-Mongo, raw projection, or denial
  -> explicit server-owned adapter registry only
  -> existing permission/data-scope enforcement and read-only query boundary
  -> bounded result with source/date/quantity/CBM provenance
```

V2 metadata does not dynamically import a controller or source path. Future work must extract the 28 controller/helper report datasets before registration and add explicit adapters one at a time. Existing adapters remain Packed Goods and Monthly Shipments; existing deterministic shipment/CBM and forecasting paths are unchanged.

## Validation and maintenance

The validator enforces 74 unique audit IDs and runtime IDs, valid domains/collections/relationships/source files/classes/recommendations/statuses, ambiguity and uncertainty targets, reusable sources for direct capabilities, current controller/helper sources for extraction candidates, and non-readiness for unsafe/export/presentation groups.

Run:

```bash
cd backend
node --test tests/omsKnowledgeBase.test.js
npm test
```

When executable report behavior changes, update the audit, capability metadata, its linked uncertainty/risk, and the count tests in the same intentional change. Never change a count merely to make a test pass.
