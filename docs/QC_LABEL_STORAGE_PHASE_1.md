# QC Serial Label Storage Upgrade — Phase 1

> Phase 2 found that the original mutually exclusive Label status could not
> represent allocated-and-used serials. The source schema is now corrected to
> independent allocation, rejection, and usage fields. See
> docs/QC_LABEL_STORAGE_PHASE_2.md for the current model and migration workflow.

## Deployment state

Phase 1 adds normalized storage and a compatibility gateway without migrating data or changing the default authority:

- Legacy `Inspector` and `Inspection` data remains authoritative.
- No `LabelStorageState` row means legacy reads, legacy writes, and legacy fallback enabled.
- No code creates storage-state rows automatically.
- The only existing read boundary routed through the gateway is `GET /inspectors/:id/label-usage?detail=summary`.
- Existing allocation, transfer, rejection, replacement, removal, QC update, historical edit, and full-detail reads remain directly legacy in Phase 1.

## Current source-of-truth rules

- Allocation and rejection ownership: `Inspector.alloted_labels`, `Inspector.rejected_labels`, and `Inspector.label_allocation_history`.
- Forensic usage evidence: `Inspection.labels_added` and its owning Inspection record.
- Derived views: `Inspector.used_labels`, `Inspector.label_used_history`, and `QC.labels`.
- The misspelled external field alloted_labels remains unchanged for API compatibility.

## New collections

### `labels`

One current-state record per serial number. Phase 2 replaces the original
status enum with independent owner_inspector, rejected_by_inspector, and
usage.inspector projections:

- `{ number: 1 }`, unique
- { owner_inspector: 1, number: 1 }
- { "usage.inspector": 1, number: 1 }
- { rejected_by_inspector: 1, number: 1 }

The schema accepts zero because existing QC and historical Inspection edit paths accept non-negative values, even though normal allocation APIs require positive integers.

### `label_transactions`

Future normalized replacement for `Inspector.label_allocation_history`, preserving `allocate`, `transfer_in`, `transfer_out`, `reject`, `replace`, and `remove` semantics. It stores full label arrays rather than compressing ranges.

Indexes:

- `{ inspector: 1, recorded_at: -1 }`
- unique partial `{ migration.legacy_inspector: 1, migration.legacy_history_id: 1 }` when both values are ObjectIds, making a future migration rerunnable without reusing legacy `_id` values
- unique partial legacy Inspector + migration.legacy_key for Phase 2 deterministic fallback identity

### `label_usages`

One usage record per authoritative Inspection record, not one record per serial. It retains Inspection/QC/request links, label arrays, QC metadata, dates, and the existing embedded vendor representation.

Indexes:

- `{ inspection_record: 1 }`, unique
- `{ inspector: 1, used_at: -1 }`

Uniqueness is justified by both existing rebuild implementations: each maps one Inspection document to at most one non-empty usage-history entry. Transfer creates a separate target Inspection rather than a second entry for the same Inspection.

### `label_storage_states`

One optional routing row per Inspector. Supported values:

- Migration: `legacy`, `backfilling`, `backfilled`, `verifying`, `verified`, `modern`, `failed`
- Read source: `legacy`, `modern`
- Write mode: `legacy`, `dual`, `modern`

Index: { inspector: 1 }, unique. Corrected modern storage uses
schema_version=2; version 1 state is not eligible for modern reads.

Modern reads require both `read_source=modern` and `migration_status` of `verified` or `modern`. Missing state, legacy state, backfilling, backfilled, and verifying all read legacy.

### `label_sync_failures`

Durable audit/repair records for future dual-write mirror failures. Queue scans use `{ resolved: 1, createdAt: 1 }`; inspector audit uses `{ inspector: 1, resolved: 1, createdAt: -1 }`.

### label_migration_conflicts (Phase 2)

Structured, idempotent reconciliation findings for controlled backfill. This
collection is separate from future live dual-write failures. See the Phase 2
document for evidence fields, indexes, and resolution behavior.

## Read routing and fallback

The gateway selects the repository per Inspector:

1. Missing/ineligible state uses legacy.
2. Eligible modern state queries modern storage.
3. A successful empty modern result is returned as empty and never triggers fallback.
4. A modern query error falls back only when `legacy_fallback_enabled=true`; otherwise it propagates.
5. Fallback logging includes Inspector, operation, requested source, actual source, and error message without dumping label arrays.

The legacy repository reconstructs used labels and usage history from `Inspection.labels_added`; it does not trust stale `Inspector.used_labels` for those reads.

## Write routing

The centralized write router is available but no production write controller calls it in Phase 1:

- `legacy`: legacy write only.
- `dual`: legacy authoritative write first, then modern mirror. A legacy failure stops the operation. A modern failure preserves the successful legacy result, logs the failure, and records `label_sync_failures`.
- `modern`: modern write only.

No row is created or changed to enable `dual` or `modern`. Cross-inspector transfer needs a later coordinator that resolves both Inspectors' states and preserves paired `transfer_out`/`transfer_in` behavior before either mode can be activated.

## Discovered implementation differences

- Inspector allocation endpoints accept only positive integers, while QC update, historical Inspection editing, and persisted Inspection/QC schemas accept non-negative integers.
- `inspector.controller.js` usage rebuilding includes transferred Inspection records. `qc.controller.js` rebuilding excludes status `transferred`. Phase 1 preserves both existing paths; reconciliation must resolve this difference before migration or full modern activation.
- Historical Inspection editing can replace `labels_added` without re-running allocation-ownership validation, then rebuilds `QC.labels`, `Inspector.used_labels`, and `Inspector.label_used_history`.
- Inspection transfer retains labels on the source Inspection, marks it transferred, creates/updates a target Inspection, and rebuilds both QC aggregates and Inspector-derived usage.

## Later phases

Phase 2 now provides controlled backfill and independent reconciliation without
production cutover. Later reviewed phases must complete global verification,
implement live mutation semantics and failure recovery, coordinate mixed-state
transfers, and only then consider dual writes or modern writes. Phase 1 itself
performed none of those actions.
