# PIS, Product Database, and Master Item Data Flow

This document maps the current OMS item data surfaces after the PIS update log work.

## Shared Data Model

Main item data lives in `backend/models/item.model.js`.

Important field groups:

| Data group | Item fields |
| --- | --- |
| PIS | `country_of_origin`, `pis_barcode`, `pis_master_barcode`, `pis_inner_barcode`, `pis_item_sizes`, `pis_box_sizes`, `pis_box_mode`, `pis_weight`, `cbm.calculated_pis_total`, `pis_checked_flag` |
| Product Database | `pd_barcode`, `pd_master_barcode`, `pd_inner_barcode`, `pd_item_sizes`, `pd_box_sizes`, `pd_box_mode`, `pd_checked`, `pd_created_by`, `pd_checked_by`, `pd_approved_by`, `pd_last_changed_by`, `pd_history`, `product_type`, `product_specs` |
| Master | `master_item_sizes`, `master_box_sizes`, `master_box_mode`, `pis_checked_flag` |

Size arrays are capped at 4 entries by the item schema. Inner + master carton mode stores 2 box entries: `inner` and `master`.

## Backend Routes

| Data | Operation | Route | Controller | Business behavior |
| --- | --- | --- | --- | --- |
| PIS list | Read | `GET /items` | `backend/controllers/item.controller.js#getItems` | Used by the PIS and Items pages to read item rows, PIS measurements, barcodes, files, QC flags, and metadata. |
| PIS update | Update | `PATCH /items/:id/pis` | `backend/controllers/item.controller.js#updateItemPis` | Updates PIS country, barcodes, `pis_item_sizes`, `pis_box_sizes`, box mode, derived weights, and calculated CBM. Legacy PIS LBH fields are read-only. In PIS Diff mode it only writes master sizes, master box mode, and `pis_checked_flag`; PIS fields are left unchanged. |
| PIS diffs | Read | `GET /items/pis-diffs` | `backend/controllers/item.controller.js#getPisDiffItems` | Reads unchecked rows where inspected data differs from PIS data. Checked rows are excluded by `pis_checked_flag: { $ne: true }`. |
| Product Database | Read | `GET /items/product-database` | `backend/controllers/item.controller.js#getProductDatabaseItems` | Reads Product Database rows, status counts, filters, and row-level permissions. |
| Product Database | Update | `PATCH /items/:id/product-database` | `backend/controllers/item.controller.js#updateProductDatabaseItem` | Saves PD fields through `backend/helpers/productDatabase.js#applyProductDatabaseSave`, moves the record to Created, and appends `pd_history`. |
| Product Database | Check | `POST /items/:id/product-database/check` | `backend/controllers/item.controller.js#checkProductDatabaseItem` | Manager check flow. If submitted data changed, it remains Created; otherwise it moves Created to Checked. |
| Product Database | Approve | `POST /items/:id/product-database/approve` | `backend/controllers/item.controller.js#approveProductDatabaseItem` | Admin approval flow. Can also save changed submitted data while approving. |
| Master item data | Read | `GET /items/masters` | `backend/controllers/item.controller.js#getItemMasters` | Reads master sizes first, then falls back to PIS sizes when master sizes are empty. |
| PIS update logs | Read | `GET /items/pis-update-logs` | `backend/controllers/item.controller.js#getPisUpdateLogs` | Reads append-only logs for PIS, PD, and Master updates, including changed fields and missing fields after save. |

There is no hard-delete route for PIS, PD, or Master item data. Clearing values is done by updating those fields to empty values. File deletion is separate: `DELETE /items/:id/files/:fileType`.

## Frontend Pages And Modals

| Page or modal | File path | Reads from | Updates through | Business flow |
| --- | --- | --- | --- | --- |
| PIS page | `client/OMS/src/pages/PIS.jsx` | `GET /items` | Opens `EditPisModal` | Shows PIS data and lets users with PIS edit permission open the PIS update modal. |
| PIS update modal | `client/OMS/src/components/EditPisModal.jsx` | Receives selected item from PIS, PIS Diffs, or Final PIS Check page | `PATCH /items/:id/pis` | Builds PIS payload with country, barcodes, item sizes, box sizes, and box mode. Missing size fields are now allowed and logged instead of blocking the save. |
| PIS Diffs page | `client/OMS/src/pages/PISDiffs.jsx` | `GET /items/pis-diffs` | Opens `EditPisModal` with `updateSource="pis_diffs"` | Shows unchecked diffs. When Update Master is saved, backend requires Admin/Super Admin, saves the submitted size values to master fields only, sets `pis_checked_flag`, removes the row from the visible list, and logs Master changes. |
| Final PIS Check page | `client/OMS/src/pages/FinalPISCheck.jsx` | `GET /items/final-pis-check` and related report routes | Opens `EditPisModal` | Report/checking surface that can still update PIS through the same modal and backend route. |
| Product Database page | `client/OMS/src/pages/ProductDatabase.jsx` | `GET /items/product-database` and product type template APIs | Product Database patch/check/approve routes | Shows status-based PD workflow. The modal saves barcodes, origin, product type specs, PD sizes, and status actions. Empty/missing values are allowed on save/check/approve and are logged. |
| Item Masters page | `client/OMS/src/pages/ItemMasters.jsx` | `GET /items/masters` | No direct update modal | Read-only master view. It displays `master_item_sizes` and `master_box_sizes`; if those are empty it falls back to PIS sizes. |
| PIS Update Logs page | `client/OMS/src/pages/PisUpdateLogs.jsx` | `GET /items/pis-update-logs` | Read-only | Shows who updated data, source page, operation type, whether PIS/PD/Master was touched, changed fields, and missing fields after the update. |

## Update Logging Flow

Append-only log rows are stored in `backend/models/pisUpdateLog.model.js` as `pis_update_logs`.

Log creation is centralized through `backend/helpers/itemUpdateAudit.js` and is called by:

| Update source | Logged operation | Logged data scope |
| --- | --- | --- |
| PIS update modal | `pis_update` | `PIS` |
| PIS Diff modal | `pis_diff_update` | `Master` |
| Product Database Save | `product_database_update` | `PD` |
| Product Database Check | `product_database_check` | `PD` |
| Product Database Approve | `product_database_approve` | `PD` |

Each log keeps:

- User id and display name.
- Item id, item code, item name, description, brand, and vendors.
- Page name and source key.
- Operation type and data scope.
- Changed field count and before/after values.
- Missing field count and missing field labels after the update.
- Extra metadata such as PD status or PIS diff sync flags.

Log save failures are caught and printed to the backend console so the user update itself is not rolled back by a secondary logging failure.

## Empty And Missing Field Rule

The PIS update modal, PIS Diff modal, and Product Database modal now allow saves with missing fields.

What is allowed:

- Empty country/barcode fields.
- Empty or partial PIS item and box size rows.
- Empty or partial PD item and box size rows.
- Empty remarks for multi-entry rows.
- Empty carton count fields.

What is still rejected:

- Negative numbers.
- Non-numeric values in numeric fields.
- More than the schema limit of size rows.
- Unauthorized PIS Diff check/master sync attempts.

Missing fields are not hidden. They are stored in `pis_update_logs.missing_fields` and are visible on the PIS Update Logs page.

## Delete Flow

There is no dedicated delete flow for PIS, PD, or Master values.

Current delete-like behavior:

- To remove PIS or PD field values, save the modal with blank values.
- To remove master size values, save the PIS Diffs modal with blank size values.
- To delete item files, use the existing item file delete route: `DELETE /items/:id/files/:fileType`.
