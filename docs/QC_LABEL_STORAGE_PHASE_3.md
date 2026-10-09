# QC Serial Label Storage Upgrade — Phase 3

## Current stage

The first Phase 3 stage is enabled for the nine verified Inspectors:

- `migration_status=verified`
- `read_source=legacy`
- `write_mode=dual`
- `legacy_fallback_enabled=true`

Legacy data remains the read authority. Allocation changes mirror to the
normalized collections, and QC usage writes update `LabelUsage` plus only the
affected `Label` rows. A normal QC update no longer rebuilds and saves the
multi-megabyte derived `Inspector.used_labels` cache after a successful modern
projection.

The normal QC update performs the modern usage write inside the existing Mongo
transaction. A projection failure rolls back the entire QC update. Historical
Inspection edit, transfer, and delete routes keep legacy authority and record
dual-write failures in `label_sync_failures`.

## Verification gate

Keep modern reads disabled until a representative live-write burn-in has both:

```bash
cd backend
node scripts/verifyLabelMigration.js --all
```

- every Inspector verified;
- `read_source=legacy` and `write_mode=dual` in the report;
- zero unresolved `label_sync_failures`;
- observed QC update latency below the product target.

The browser timeout remains 20 seconds as a network safety margin. The server
work should meet the five-second target; shortening the cancellation timeout
does not make the transaction faster and is unsafe on slow connections.

## Rollback

Rollback does not require restoring label data. Change only verified dual-write
states back to legacy writes:

```javascript
db.label_storage_states.updateMany(
  {
    migration_status: 'verified',
    read_source: 'legacy',
    write_mode: 'dual',
  },
  { $set: { write_mode: 'legacy' } },
)
```

Do not set `read_source=modern` as part of this stage.
