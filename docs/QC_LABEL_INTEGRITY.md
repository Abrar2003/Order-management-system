# Label 72481: confirmed production cause

Read-only investigation through `ssh hostinger` on 17 October 2026. No production records were changed.

## Evidence (times in Asia/Kolkata)

- 10 October, 17:44:58: allocation history `6aca2c42882a54ff197dbc44` assigned labels 72001–72720 to Ashwini Khandelwal (Inspector `6993feed473290fa1cf76b52`).
- 15 October, 13:12:48: edit log `6ad083f8c2220b393e43dd4b`, operation `qc_inspection_record_edit`, recorded under Nikita Goswami, replaced Hitesh's labels 72845–72846 with range **72481–72844**. Inspection `6ad06978141c1df3f8abd285`, QC `6ac3225073877f9f07af8ef0`, PO 106899 / DL-2412 now has **364 labels for 4 passed pieces**.
- 17 October, 09:43:43: edit log `6ad2f5f7c2220b393e43ddc3`, also `qc_inspection_record_edit`, recorded under Nikita Goswami, added 72481–72491 to an Ashwini inspection (`6ad0cdbc8638044ef2a460e9`). Label 72481 therefore occurs in two inspection records at investigation time.
- The database-wide scan found **452 distinct positive serials in multiple inspection records**, including duplicates within the same inspector's history. Current Inspector allocation lists had **zero cross-inspector duplicates**.
- All nine storage states use verified dual writes with legacy reads. The unique `labels.number` index exists; it ensures one serial document but did not constrain its multiple usage records.

## Root cause

The inspection edit route expanded and saved supplied ranges without the ownership, global reuse, and required label-count checks in the normal QC update route. Its usage projection then represented the supplied inspection data, including conflicting inspectors, without rejecting it. The checker separately compared each inspector's allocation against only that inspector's usage, allowing an allocation to appear unused while another QC had already used it.

The audit establishes the accepted range and editing account. It does not preserve the original HTTP payload or keystrokes, so it cannot establish whether the incorrect starting number was typed or populated by the UI.

## Prevention

- A shared Inspection save guard checks newly added serials against current exclusive allocation, rejections, and every other Inspection (including the same inspector's other records). Inspector reassignment validates every retained serial.
- An atomic claim on the unique Label document binds the serial to one Inspection. Concurrent claims cannot both commit. Label changes require transactions; moving labels between records releases and claims them in the same transaction.
- Allocation, replacement, removal, rejection, and unused-label transfers transact with their conditional Label writes. A failed claim rolls back the whole operation instead of allowing a failed mirror to be logged after saving.
- Inspection transfers now transact their source and target changes. Label-count edits use the existing passed-quantity/box-count rule. Unchanged historical label sets do not block unrelated metadata edits.
- Existing historical conflicts are preserved for review. This change does not decide which physical label was used or rewrite inspection evidence. Deleting an inspection does not release its new usage reservation for reuse.

## Validation and rollout

The isolated local MongoDB replica-set tests exercise concurrent allocation, concurrent same-QC reuse, wrong-owner use, historical-use checks, rollback, allocation-transfer/use races, atomic movement between inspections, and refusal of nontransactional label writes.

Run `node --test tests/labelIntegrity.integration.js` from `backend`, with `LABEL_TEST_MONGOD` set if `mongod` is not on PATH. This uses a disposable loopback database and never connects to OMS data.

Deploy through the existing main-branch Hostinger workflow. Historical duplicate usages require an evidence-based correction plan; no unique index was imposed on historical Inspection arrays because the existing 452 conflicts would make it fail.
