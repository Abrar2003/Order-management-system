# QC Serial Label Storage Upgrade — Phase 2

## Scope and production boundary

Phase 2 corrects the normalized label model and adds controlled migration and
verification tooling. It does not migrate production data, change permissions,
add administrative routes, enable controller dual writes, or remove any legacy
Inspector field.

Production behavior remains legacy by default:

- Missing LabelStorageState means legacy reads and writes.
- Backfilled data remains unread by the application until separately verified.
- Apply never changes read_source from legacy.
- Apply and verification never change write_mode from legacy.
- Only the existing summary label-usage route can read modern storage, and only
  for schema version 2 states explicitly marked verified or modern with
  read_source=modern.
- Allocation, transfer, reject, replace, remove, QC updates, historical
  Inspection edits/transfers/deletes, full usage reads, and all derived rebuilds
  remain legacy.

Phase 3 is not authorized by this work.

## Corrected current-state semantics

The Phase 1 Label.status enum was a migration blocker because allocation,
usage, and rejection are not one mutually exclusive lifecycle.

Each labels document now has independent concepts:

| Concept | Modern field | Meaning |
| --- | --- | --- |
| Current allocation | owner_inspector | Inspector document ID; null means not currently allocated |
| Rejection | rejected_by_inspector | Inspector document ID; null means no current rejection projection |
| Usage projection | usage.inspector | Inspector document ID derived from Inspection evidence; null means no usage evidence |
| Usage freshness | usage.source_updated_at | Latest relevant Inspection update time |

A label may therefore have both owner_inspector and usage.inspector. Removing
or replacing current allocation clears only ownership; forensic usage survives.
Reject currently clears ownership in the legacy controller, but the fields
remain independent so anomalous overlaps can be represented and reported rather
than discarded.

The label record intentionally does not select one inspection_record as the
winner. Inspection transfer retains source label evidence and creates target
evidence, so one serial can have multiple forensic evidence records. Those
records remain one LabelUsage document per Inspection.

## Data authority

| Concept | Migration authority | Modern role |
| --- | --- | --- |
| Current allocation | Inspector.alloted_labels | Label.owner_inspector projection |
| Current rejection | Inspector.rejected_labels | Label.rejected_by_inspector projection |
| Allocation history | Inspector.label_allocation_history | LabelTransaction projection |
| Actual serial usage | Inspection.labels_added | Label.usage plus LabelUsage projection |
| Derived used list | Inspector.used_labels | Checked for discrepancies; never trusted for backfill |
| Derived usage detail | Inspector.label_used_history | Checked by stable Inspection/business fields |
| QC aggregate | QC.labels | Convenience data only; never a migration authority |

Inspection.inspector is a User ID. The migration resolves that User to an
Inspector document and writes only the Inspector ID to modern foreign keys.

For compatibility with the Phase 1 summary route, forensic usage includes all
Inspection statuses, including transferred records. The analyzer emits a
warning because inspector.controller.js includes transferred records while the
QC-controller rebuild excludes the legacy transfered status.

## Summary compatibility

The summary preserves independent counts:

- total_allocated: current allocation count
- total_used: distinct positive serials found in Inspection.labels_added
- total_unused: current allocation set minus forensic usage set
- total_rejected: current rejection count
- usage_percentage: total_used / total_allocated * 100

Used labels are not restricted to the current allocation intersection. For
example, allocated [1,2,3] and used [1,2,10] produces allocated 3, used 3,
unused 1, and usage percentage 100.00.

Legacy duplicate array values are reported. They can make raw legacy summary
counts impossible to reproduce with the globally unique modern label model, so
verification will not pass until the anomaly is understood.

## Collections and indexes

### labels

- unique { number: 1 }
- { owner_inspector: 1, number: 1 }
- { "usage.inspector": 1, number: 1 }
- { rejected_by_inspector: 1, number: 1 }

The schema still accepts zero for compatibility with persisted legacy model
boundaries. Phase 2 tooling treats non-positive serials as blocking migration
conflicts because allocation and summary behavior use positive serials.

### label_transactions

Allocation actions remain allocate, transfer_in, transfer_out, reject, replace,
and remove, including full previous/next snapshots.

Idempotency indexes:

- unique partial legacy Inspector + embedded history ObjectId
- unique partial legacy Inspector + deterministic migration.legacy_key

The key uses the embedded history ID when available. A deterministic business
content/occurrence hash is used only for anomalous entries without a stable ID.

### label_usages

- unique { inspection_record: 1 }
- { inspector: 1, used_at: -1 }

Inspection editing updates that stable record, Inspection deletion removes the
migration-owned projection, and transfer creates a separate target record while
retaining source evidence.

### label_migration_conflicts

- unique { fingerprint: 1 }
- { inspector: 1, status: 1, conflict_type: 1 }
- { label_number: 1, status: 1 }

Each record stores severity, Inspector, optional serial, bounded legacy/modern
evidence, source document IDs, first/last seen times, and resolution status.
Dry-run never writes conflict records. Explicit apply records current findings
and marks prior findings resolved only when they no longer appear in a fresh
analysis.

### label_storage_states

Corrected storage uses schema_version=2. Version 1 state cannot activate modern
reads after this correction.

## Dry-run analyzer

From backend:

    node scripts/migrateLabels.js --inspector <Inspector._id>

Equivalent explicit form:

    node scripts/migrateLabels.js --inspector <Inspector._id> --dry-run

Dry-run is the default and disables Mongoose automatic index creation, so it
performs database reads only. It:

1. Separately resolves the Inspector document ID and populated User ID.
2. Reads all legacy current arrays and histories.
3. Reads every Inspection for that User, including transferred records.
4. Rebuilds forensic usage from Inspection.labels_added.
5. Queries other Inspectors and Inspections only for relevant serials to detect
   global conflicts.
6. Compares compatible/incompatible partial modern records.
7. Reports valid allocation/usage overlap, used-but-deallocated, unused,
   rejection overlap, duplicates, invalid values, derived-data discrepancies,
   history anomalies, unresolved QC metadata, transfer behavior, unsafe routing
   state, and global ownership/usage/rejection conflicts.
8. Prints deterministic expected label, transaction, and usage counts without
   writing data.

Error conflicts block apply. Warnings are recorded during apply and remain
visible to verification/review.

## Apply and resume

After reviewing a clean or understood dry-run:

    node scripts/migrateLabels.js --inspector <Inspector._id> --apply

Apply:

- creates/verifies required modern indexes;
- records structured conflicts;
- refuses any error conflict;
- sets only migration status to backfilling;
- upserts label, transaction, and usage projections with stable identities;
- removes only stale records owned by this migration source;
- never deletes or rewrites legacy arrays/history;
- checks that legacy source data did not change during the run;
- finishes at migration_status=backfilled;
- leaves read_source=legacy and write_mode=legacy.

There is no separate repair script. The same apply command is the safer resume
mechanism: all writes are deterministic upserts, compatible Phase 1 partial
transactions are adopted by legacy history ID, and stale migration-owned
projections are reconciled. Incompatible modern data is never overwritten.

Mongo transactions are not assumed. The deployment probes transaction support,
but Phase 2 recovery relies on unique indexes, conditional ownership checks,
stable keys, and rerunnable operations.

## Independent verification

Read-only verification:

    node scripts/verifyLabelMigration.js --inspector <Inspector._id>

The verifier does not import the migration transformation. It independently
queries and compares:

- legacy allocation versus Label.owner_inspector;
- Inspection-derived distinct usage versus Label.usage.inspector;
- legacy rejection versus Label.rejected_by_inspector;
- legacy and modern unused sets and summary values;
- normalized allocation-history business fields versus transactions;
- per-Inspection stable usage business fields versus LabelUsage;
- Inspector ID versus User ID;
- schema/routing safety and unresolved error conflicts.

Regenerated Inspector.label_used_history entry IDs are never compared.

After a passing read-only verification, an explicit separate command may mark
the staging Inspector verified:

    node scripts/verifyLabelMigration.js --inspector <Inspector._id> --mark-verified

This changes only migration_status and verified_at; reads and writes remain
legacy.

## Staging canary and rollback

Use a non-production database and one Inspector with allocation history,
forensic usage, and preferably transferred or edited Inspection history.

1. Record the current legacy summary and full legacy usage response.
2. Run the default dry-run and review every warning/error.
3. Fix or explicitly understand legacy anomalies; rerun dry-run.
4. Run --apply.
5. Run the independent verifier.
6. Run verification again with --mark-verified.
7. In staging only, explicitly set read_source=modern while keeping
   write_mode=legacy:

       db.label_storage_states.updateOne(
         {
           inspector: ObjectId("<Inspector._id>"),
           schema_version: 2,
           migration_status: "verified",
           write_mode: "legacy"
         },
         { $set: { read_source: "modern" } }
       )

8. Call GET /inspectors/<Inspector._id>/label-usage?detail=summary and compare
   it with the saved legacy expectation.
9. Roll back immediately:

       db.label_storage_states.updateOne(
         { inspector: ObjectId("<Inspector._id>") },
         { $set: { read_source: "legacy", write_mode: "legacy" } }
       )

10. Call the same summary route and confirm the legacy result returns
    immediately.

No live staging database or Inspector identifier was supplied during
implementation, so no database canary was executed by the code change itself.
The automated fixtures provide the controlled migration proof; the procedure
above remains the required deployment gate.

## Known anomalies and limits

- Inspector-controller and QC-controller usage rebuilds disagree on transferred
  Inspection records. Phase 2 uses all Inspection evidence for summary
  compatibility and reports the discrepancy.
- Inspection transfer retains source labels and may create duplicate evidence
  for the same serial. LabelUsage preserves both records; the current label
  projection remains one used serial.
- Historical edit can change labels without allocation ownership revalidation.
- Numeric zero is accepted by some legacy schemas/controllers but excluded by
  allocation and summary semantics; migration blocks it for review.
- Duplicate or invalid legacy values are never silently rewritten.
- Global conflicts involving the target serials block apply.
- Apply is Inspector-scoped. Global completeness across every Inspector is a
  prerequisite for any future modern-only write mode.
- Old Phase 1 status-based records with non-unassigned state require explicit
  review and are not automatically converted.
- Obsolete Phase 1 status indexes are not destructively dropped by this phase;
  corrected indexes are added. Cleanup requires later database inspection.

## Phase 3 prerequisites

Before requesting dual writes or live synchronization:

1. Run dry-run/apply/independent verification on controlled staging Inspectors.
2. Complete and verify the global reservation/conflict representation for every
   Inspector, not only per-Inspector canaries.
3. Resolve all error conflicts and decide policy for transferred evidence and
   historical edits.
4. Prove index creation on the target database and inspect obsolete indexes.
5. Exercise immediate modern-read rollback in staging.
6. Design paired cross-Inspector transfer coordination.
7. Design controller integration for QC edit/transfer/delete and allocation
   mutations with durable failure recovery.
8. Obtain explicit approval for Phase 3.
