# QC Serial Label Storage Upgrade — Phase 2.5

## Scope and safety boundary

Phase 2.5 makes the Phase 2 backfill safe for historical anomalies. It does
not clean legacy data, choose an owner automatically, enable dual writes, or
switch production reads or writes to modern storage. The legacy Inspector and
Inspection documents remain authoritative:

- current allocation: `Inspector.alloted_labels`
- current rejection: `Inspector.rejected_labels`
- forensic usage: `Inspection.labels_added`
- derived only: `Inspector.used_labels`, `Inspector.label_used_history`, and
  `QC.labels`

## Usage field contract

`LabelUsage.inspector` is the normalized Inspector attribution for one
Inspection-level forensic record. `Label.usage.inspectors` is the sorted,
deduplicated aggregate of every Inspector found in the forensic evidence for
that serial. The singular `Label.usage.inspector` is compatibility-only:
`null` for zero usage Inspectors, the sole Inspector for exactly one, and
`null` when multiple Inspectors are valid. It is never an allocation owner,
rejection owner, winner, or source of conflict decisions.

## Conflict classification

Representable historical evidence is preserved and recorded as warnings:

- `duplicate_usage_evidence`
- `used_multiple_inspectors`
- `allocated_used_cross_inspector` when there is one current allocation owner
- `rejected_used_cross_inspector` when current rejection and history can both
  be represented
- `allocated_rejected_cross_inspector`
- transferred Inspection evidence and derived-array mismatches

Blocking conflicts remain errors when the modern projection cannot safely
choose a current state:

- `multiple_current_allocation_claims`
- `multiple_current_rejection_claims`
- `ambiguous_current_reservation`
- `current_allocation_rejection_conflict`
- invalid serials/actions, unresolved Inspector identity, incompatible
  existing modern records, unsafe routing state, and other non-representable
  errors

Historical duplicates are not removed. Every Inspection becomes its own
`LabelUsage` document, keyed by `inspection_record`.

## Quarantine and partial backfill

An unresolved current-state conflict serial is written with
`Label.allocation_state = conflicted` and no canonical owner. The shared
availability predicate treats that serial as reserved even when
`owner_inspector` is null. It cannot be offered to a future allocation path.

An Inspector with only explicit current-claim quarantine conflicts may be
partially backfilled. Unaffected labels, transactions, and usage evidence are
written normally; conflict evidence remains open; legacy arrays are untouched.
The storage state is `backfilled_with_conflicts`, with `read_source=legacy` and
`write_mode=legacy`. Non-quarantinable errors still block the whole apply. The
dry-run keeps `can_apply=false` for the full-clean/verification gate and
exposes `can_backfill=true` for this safe partial path.
Serial-scoped incompatible modern records are skipped and remain reserved by
their open conflict; errors without a representable serial still block the
Inspector.

Rerunning apply is deterministic and idempotent. After an operator resolves a
current allocation conflict, a later apply consumes the recorded canonical
owner and changes the label back to `active` without rewriting legacy arrays.

## Storage states

`LabelStorageState.migration_status` supports:

`legacy`, `backfilling`, `backfilled`, `backfilled_with_conflicts`,
`verifying`, `verified`, `modern`, and `failed`.

Only `verified` or `modern` schema-version-2 states can use a modern read, and
Phase 2.5 never changes `read_source` or `write_mode` automatically.
An Inspector with unresolved blocking conflicts cannot be marked verified.

## Review and resolution CLI

Read-only review is the default:

```bash
cd backend
node scripts/resolveLabelMigrationConflicts.js --label 500
```

The output includes current allocation/rejection claims, Inspection and
LabelUsage evidence, allocation history, conflict status, and:

```text
AUTO RESOLUTION: NO
```

Explicit resolution requires an owner that is already one of the current
claims and a reason:

```bash
node scripts/resolveLabelMigrationConflicts.js \
  --label 500 \
  --owner <Inspector._id> \
  --reason 'Confirmed current owner from transfer history' \
  --operator <operator-id-or-name>
```

The command records the conflict IDs, prior evidence, canonical owner,
operator, timestamp, reason, and resulting state in both the conflict and its
append-only `resolution_history`. It updates only the modern projection; it
does not delete conflict evidence or mutate legacy Inspector arrays.

## Global audit

The inventory command is read-only:

```bash
node scripts/auditLabelMigration.js
```

It reports each Inspector’s allocation, forensic usage, rejection, usage
record, transaction, warning, blocking-conflict, migration-status, and one of
`CLEAN`, `REPRESENTABLE_ANOMALIES`, or `BLOCKED_CURRENT_STATE`. Global totals
include Inspector counts, unique serials, blocking serials, historical
warnings, and conflicts by type.

## Batch migration

Dry-run is the default and is sequential to keep failure isolation obvious:

```bash
node scripts/migrateLabels.js --all --dry-run
node scripts/migrateLabels.js --all --apply
```

Already verified or modern Inspectors are skipped. Use
`--include-verified` only when an explicit recheck is required. Each Inspector
has its own structured result; one failure does not abort writes for another.
No batch command changes read source or write mode.

## Indexes

Phase 2.5 keeps the existing unique `Label.number`, owner/rejection/usage,
conflict lookup, transaction, and storage-state indexes. It adds
`LabelUsage.labels` because the review CLI locates forensic records by serial.
No speculative global scan indexes or live-write indexes were added.

## Verification and rollback

For a staging Inspector:

```bash
node scripts/migrateLabels.js --inspector <Inspector._id> --dry-run
node scripts/migrateLabels.js --inspector <Inspector._id> --apply
node scripts/verifyLabelMigration.js --inspector <Inspector._id>
```

The verifier checks all non-conflicted projections, conflict evidence,
quarantine/reservation, Inspector/User identity, and legacy routing. Warnings
do not fail verification; unresolved blocking conflicts prevent full
verification and `--mark-verified`.

Rollback is the existing rerunnable apply path after resolving or correcting
the source. Modern summary reads remain disabled because `read_source` stays
legacy. If a future operator explicitly enables a verified modern read, restore
it with:

```javascript
db.label_storage_states.updateOne(
  { inspector: ObjectId('<Inspector._id>') },
  { $set: { read_source: 'legacy', write_mode: 'legacy' } },
)
```

Phase 3 is not part of this change. All allocation, transfer, reject,
replace, remove, QC usage, Inspection edit/delete, and Inspection transfer
controllers continue to write legacy storage only.
