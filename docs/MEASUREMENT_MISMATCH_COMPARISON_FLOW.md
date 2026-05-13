# Measurement Mismatch Comparison Flow

This document describes where OMS compares and displays inspected data, PIS data, Product Database data, and master data for the PIS Diffs, QC Report Mismatch, Final PIS Check, and Product Database surfaces.

## Shared Mismatch Rules

The numeric measurement rules are centralized in `backend/helpers/measurementMismatchRules.js`.

| Measurement | Compared only when | Mismatch rule | Notes |
|---|---|---|---|
| Weight | Both inspected/current value and reference value are present and greater than zero | `abs(inspected - reference) / reference * 100 > 10` | Exactly 10% is accepted. Missing weight on either side is not compared. |
| Item size `L`, `B`, `H` | Both side values for that axis are present and greater than zero | Absolute variance is `> 0.5 cm` | Exactly `0.5 cm` is accepted. Missing axis data is not compared. |
| Box size `L`, `B`, `H` | Both side values for that axis are present and greater than zero | Absolute variance is `> 1 cm` | Exactly `1 cm` is accepted. Missing axis data is not compared. |

For these measurement rules, "reference" depends on the page:

| Page | Inspected side | Reference side |
|---|---|---|
| PIS Diffs | Item inspected fields | Item PIS fields |
| Final PIS Check | Item inspected fields | Master fields when present, otherwise PIS fields |
| QC Report Mismatch | Historical inspection snapshot | Current item inspected fields |

Non-measurement checks still exist where the page already supported them:

| Surface | Existing non-measurement checks |
|---|---|
| PIS Diffs | Barcode and calculated CBM can still appear in detailed report/export differences. |
| Final PIS Check | Barcode and calculated CBM can still appear in detailed differences. |
| QC Report Mismatch | Box mode can still mismatch, but only when actual comparable box data exists. Empty/default box mode alone is not treated as comparable data. |

## Page Flow Table

| Surface | Route / page | Backend source | Main helper | What is compared | What is shown |
|---|---|---|---|---|---|
| PIS Diffs | `GET /items/pis-diffs`, `client/OMS/src/pages/PISDiffs.jsx` | `Item` documents selected with `PIS_DIFF_ITEM_SELECT` in `backend/controllers/item.controller.js` | `buildPisDiffRows`, `buildPisDiffSummary`, `buildPisDiffDetailedComparisons` | `inspected_item_sizes` vs `pis_item_sizes`, `inspected_box_sizes` vs `pis_box_sizes`, inspected weights vs PIS weights. Checked rows are excluded by `pis_checked_flag: { $ne: true }`. | Unchecked item rows where the comparison still has differences. The table shows inspected item/box data beside PIS item/box data, plus inspection report mismatch status. |
| PIS Diffs report/export | `GET /items/pis-diffs/export-preview`, `GET /items/pis-diffs/export` | Checked `Item` documents | `getCheckedPisDiffRowsForReport`, `buildPisDiffReportPayload` | Same PIS-vs-inspected comparison, but only for checked PIS diff rows. | Preview/PDF/XLSX report rows with measurements and detailed difference rows. |
| QC Report Mismatch | `GET /reports/qc-report-mismatch`, `client/OMS/src/pages/QcReportMismatch.jsx` | `Inspection` aggregation joined back to current `Item` by item code | `compareInspectionSizeSnapshot` in `backend/helpers/inspectionSizeSnapshot.js` | Only the latest 3 inspection snapshots per item code are compared against the current item inspected fields. Inspections with no comparable data are filtered out before grouping. | Grouped QC rows. The detail modal shows current inspected item/box data and comparable fields from those latest inspection snapshot columns. Missing per-field data is shown as no comparable data, not as a difference. Highlighting comes from backend mismatch keys, not exact frontend re-comparison. |
| Final PIS Check | `GET /items/final-pis-check`, `client/OMS/src/pages/FinalPISCheck.jsx` | Checked `Item` documents from `buildFinalPisCheckMatch` | `backend/helpers/finalPisCheck.js` | `inspected_*` fields are compared against `master_*` fields when those exist; otherwise against `pis_*` fields. Only rows with remaining differences are returned. | Checked items that still have differences. The UI shows inspected item/box data and the active reference label, either `Master` or `PIS`. |
| Final PIS Check report/export | `GET /items/final-pis-check/export-preview`, `GET /items/final-pis-check/export` | Same checked `Item` dataset | `buildFinalPisCheckReportPayload` | Same final check comparison. | Preview/PDF/XLSX report with summary, measurement cards, and detailed difference rows. |
| Product Database | `GET /items/product-database`, `client/OMS/src/pages/ProductDatabase.jsx` | `Item` documents with `pd_*` fields | `backend/helpers/productDatabase.js` | This page does not participate in the PIS Diffs, QC Report Mismatch, or Final PIS Check mismatch calculations. It has its own save/check/approve workflow. | PD item sizes, PD box sizes, PD barcode, product type/spec fields, status, and audit actors. |

## Data Fields By Meaning

| Meaning | Item fields / model fields | Written by | Displayed at | Used for mismatch? |
|---|---|---|---|---|
| Inspected data on the item | `inspected_item_sizes`, `inspected_box_sizes`, `inspected_box_mode`, `inspected_weight`, legacy inspected LBH fields | QC/update inspection flows and item sync paths | PIS Diffs, Final PIS Check, QC Report Mismatch current side, inspection report pages | Yes. It is the inspected side for PIS Diffs and Final PIS Check, and the current side for QC Report Mismatch. |
| Historical inspected snapshot | `Inspection.inspected_item_sizes`, `Inspection.inspected_box_sizes`, `Inspection.inspected_box_mode` | Inspection record snapshot creation/update | QC Report Mismatch detail modal | Yes. It is compared against current item inspected data. Rows without comparable data are skipped. |
| PIS data | `pis_item_sizes`, `pis_box_sizes`, `pis_box_mode`, `pis_weight`, PIS barcode fields, legacy PIS LBH fields | PIS upload/sync and PIS edit flow | PIS page, PIS Diffs, Final PIS Check when no master data exists, reports | Yes for PIS Diffs. Yes for Final PIS Check only when master data is not available. |
| Master data | `master_item_sizes`, `master_box_sizes`, `master_box_mode` | Admin/Super Admin updates from PIS Diffs copy accepted PIS size arrays into master fields | Final PIS Check reference cards and detailed difference rows | Yes, Final PIS Check prefers master item/box sizes over PIS item/box sizes when present. |
| Product Database data | `pd_item_sizes`, `pd_box_sizes`, `pd_box_mode`, `pd_barcode`, `pd_master_barcode`, `pd_inner_barcode`, `product_type`, `product_specs`, `pd_checked`, `pd_history` | Product Database save/check/approve workflow | Product Database list and modal | No for the three mismatch pages. It is stored and reviewed separately from PIS/inspection mismatch comparisons. |

## Detailed Flow

| Step | PIS Diffs | QC Report Mismatch | Final PIS Check |
|---|---|---|---|
| 1. Query base data | Query unchecked `Item` records matching search/brand/vendor. | Aggregate `Inspection` records by report filters, keep only the latest 3 inspections per item code, then fetch current `Item` documents for those item codes. | Query checked `Item` records matching search/brand/vendor. |
| 2. Normalize measurements | Build comparable inspected and PIS entries from array-backed fields first, then legacy LBH/weight fallback fields. | Normalize both historical inspection snapshot and current item inspected data with `buildNormalizedInspectionSizeState`. | Build inspected entries, PIS entries, and master entries from array-backed fields first, then legacy fallback fields. |
| 3. Select reference | PIS fields are the reference. | Current item inspected fields are the reference. | Master fields are the reference when present; otherwise PIS fields are the reference. |
| 4. Apply measurement rules | Weight `> 10%`, item size `> 0.5 cm`, box size `> 1 cm`; missing one-side measurement values are skipped. | Same rules; inspections with no comparable data are removed before grouping and pagination, and missing per-field data does not create a mismatch. | Same rules; missing one-side measurement values do not create size/weight differences. |
| 5. Build mismatch rows | Return only items with `pis_diff` fields. | Group only comparable inspections by QC/item. Mismatch highlighting is based on backend mismatch arrays. | Return only checked items with at least one difference. |
| 6. Render | Main table renders inspected vs PIS measurements. Preview/export renders detailed differences. | Main table renders grouped QC rows. Detail modal renders current inspected values and each comparable inspection snapshot. | Cards and reports render inspected values beside Master/PIS reference values with detailed differences. |

## Important Implementation Files

| File | Responsibility |
|---|---|
| `backend/helpers/measurementMismatchRules.js` | Shared numeric thresholds and missing-data behavior. |
| `backend/controllers/item.controller.js` | PIS Diffs list/export helpers and inspection-report mismatch lookup used by PIS surfaces. |
| `backend/helpers/finalPisCheck.js` | Final PIS Check comparison, row shaping, summary, sorting, and export payloads. |
| `backend/helpers/inspectionSizeSnapshot.js` | QC Report Mismatch snapshot normalization and comparison. |
| `backend/controllers/reports.controller.js` | QC Report Mismatch endpoint, grouping, filtering, options, pagination. |
| `client/OMS/src/pages/PISDiffs.jsx` | PIS Diffs table and checked diff report preview/export UI. |
| `client/OMS/src/pages/QcReportMismatch.jsx` | QC Report Mismatch filters, table, and detail modal. |
| `client/OMS/src/pages/FinalPISCheck.jsx` | Final PIS Check table, cards, and report preview/export UI. |
| `client/OMS/src/pages/ProductDatabase.jsx` | Product Database display/edit/check/approve UI for `pd_*` fields. |
