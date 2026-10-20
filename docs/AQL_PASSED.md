# AQL passed quantities

`inspection.passed` remains the sample count. The server stores `aql_passed` as the
inspection's requested quantity when its AQL sample has any passes, otherwise
zero. Normal requests store `null`. The field is read-only and appears in QC
inspection views, never in quantity-entry modals.

Each AQL request contributes once to approved-goods totals, at its latest passing
visit. Distinct requests approve their own batches. Historical request types take
precedence over the current QC type. Sample validation, rejected quantities,
label requirements, and inspection-transfer limits retain their existing rules.

From `backend`, populate existing records and refresh QC totals and historical
pending quantities:

```powershell
node scripts/backfillAqlPassed.js --dry-run
node scripts/backfillAqlPassed.js --apply
```

Dry-run is the default. The script uses the configured MongoDB connection and
preserves explicit environment overrides. It reports passing AQL records with
no recoverable requested quantity rather than substituting order demand. Apply
is idempotent and stops if a concurrent edit invalidates its snapshot; rerun it
to finish refreshing derived values. Sample quantities and audit timestamps are
preserved. Historical report totals may increase to the full AQL-approved batches.

Checks: `node --test tests/aqlPassed.test.js`; use `AQL_TEST_MONGOD` to point to a
local `mongod` executable for `node --test tests/aqlPassed.integration.js`.
After the frontend build, `node tests/aqlPassed.browser.js` checks desktop/mobile
inspection views and modal exclusion against mocked API data.
