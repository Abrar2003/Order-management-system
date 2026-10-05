# PIS data sanity workflow

Effective cycle: **3 October 2026, Asia/Kolkata** (2026-10-02T18:30:00Z). One cycle per Item record. This is an additive rollout: do not reset master data, check flags, or historical logs, and do not reconstruct stages from old logs.

## Review sequence

| Current state | Page | Evidence and Super Admin action |
| --- | --- | --- |
| Awaiting Master 1 | PIS Diffs | Latest approved inspection from one PO; review/save or Confirm unchanged |
| Master 1 | Final PIS Check | First three additional qualifying distinct POs; review/save Master 2 |
| Master 2 | Final Master | First three more qualifying distinct POs; review/save Final Master |
| Final Master | Master vs PD | Correct Final Master, open the normal PD editor, or accept each unresolved issue with a reason; sign off |
| Current comparison signed off | Master vs PD | Finalize PIS permanently locks Final Master |

Every approved item awaiting Master 1 appears even if it has legacy masters, an old checked flag, imported data, matching measurements, or missing measurements. Existing master values remain in use until the first review; that review also preserves a legacy snapshot. Later pages show waiting progress as well as ready items. Final Master also shows created and finalized items. Only Super Admin can write master data or approve stages/sign-offs/finalization; inspection approval permissions are unchanged.

**Workflow actions write only master data and workflow history. Vendor PIS values and the PIS page are unchanged. Finalize PIS locks only Final Master.** Normal PIS edits, PD approval/editing and inspections remain available after finalization. There is no unlock action.

## Evidence rules

Evidence comes from actual approved Inspection records joined through QC to the item and PO, within existing brand/vendor access. Cached latest item inspection values are never evidence. PO identifiers are trimmed and case-normalized; repeated visits count once, and a PO consumed by an earlier stage cannot count again.

For Master 2 and Final Master, a visit must have been recorded strictly after the previous stage review and its inspection date must be on or after that review's India calendar date. Fresh same-day visits are valid; older recorded visits, backdating, future dates, and unapproved records are excluded. Eligible POs are ordered by their first qualifying visit; the first three are selected, using the latest approved qualifying visit for each. Latest visits are ordered by inspection date, recording timestamp and ID. No automatic averaging is performed.

The reviewer sees all selected visits before submission. Each stage stores the exact evidence, measurements, normalized consumed POs, reviewer, timestamp, and saved master snapshot. Later source inspection changes do not rewrite completed stage evidence. Matching measurements still require an explicit review.

## Data and concurrency

Item.master_workflow stores cycle_version, started_at, stage, revision, consumed_pos, legacy_master, reviews, events, pd_review and finalization details. No workflow field means awaiting Master 1 for this cycle. Current master_* fields remain the values consumed elsewhere; cbm.calculated_master_total belongs to Master.

Every action requires the exact current workflow revision. Stage reviews also require the evidence token returned by the list API. PD review/finalization require the current comparison token. The service rechecks evidence and authorization and uses an atomic item update matching revision, stage, master values and PD measurements. A stale or simultaneous second submission returns 409 without advancing. Snapshots and workflow audit events are part of the same atomic write. Existing Item update history and PIS update logs remain available.

PD measurement writes increment pd_measurement_revision, including changes that are later reverted. Comparison tokens include that revision and both measurement snapshots. Changing either side before finalization requires another sign-off. An unlocked Final Master correction invalidates its sign-off and adds a correction event without changing the original stage evidence.

## Master vs PD

Comparison aligns parts/remarks and packaging using existing dimension orientation rules. Every row remains visible, including missing values and unmatched parts.

| Field | Accepted boundary |
| --- | --- |
| Item L/B/H | Absolute difference at most 0.5 cm |
| Box L/B/H | Absolute difference at most 1 cm |
| Net/gross weight | Difference at most 10% of the Final Master value |
| Packaging modes and carton counts | Exact match |
| Missing/zero measurements | Visible issue requiring an explicit acceptance reason |

Every unresolved discrepancy needs its own nonblank reason (maximum 2,000 characters). Sign-off records both compared snapshots, reasons and actor. PD changes after finalization may change the live comparison display but cannot reopen or alter Final Master or its final snapshot. Existing PD approval rules continue independently.

## APIs and pages

Shared implementation: backend/helpers/masterWorkflow.js, backend/services/masterWorkflow.service.js, backend/controllers/masterWorkflow.controller.js and client/OMS/src/components/MasterWorkflowPage.jsx.

| Method / route | Purpose |
| --- | --- |
| GET /items/pis-diffs | Awaiting Master 1 with approved records |
| GET /items/final-pis-check | Master 1 items and progress toward Master 2 |
| GET /items/final-masters | Master 2 waiting/ready, Final Master created, finalized |
| GET /items/master-vs-pd | Final Master and current PD comparison |
| POST /items/:id/master-workflow/review | Advance one stage with revision, evidence_token and values containing only master fields |
| PATCH /items/:id/master-workflow/final-master | Correct unlocked Final Master with revision and master values |
| POST /items/:id/master-workflow/pd-review | Sign off with revision, comparison_token and reasons keyed by comparison row |
| POST /items/:id/master-workflow/finalize | Permanently lock with revision and comparison_token |

Lists support search, brand, vendor, country, status, page and limit. Responses expose current stage, revision, evidence/progress and permitted actions. Each list has /export-preview and /export; PDFs use the central /items/pdf/render service. Existing comments and Item Masters stage labels are retained. All writes invalidate related item/QC/report caches.

Legacy direct modal master updates via PATCH /items/:id/pis and the inline /final-pis-check/:code/master-values route return 409 directing callers to the workflow. Ordinary PIS updates continue using PATCH /items/:id/pis.

## Permanent lock and rollout checks

Finalization records final_snapshot, finalized_at and finalized_by. Model middleware guards document saves, query updates, replacements and bulk writes, including parent CBM replacements and stale documents. Normalization hooks skip frozen master values, and the master remark maintenance script excludes finalized records. Application scripts must use the guarded Item model; direct database writes are outside application protections and must never be used to modify finalized masters.

No migration or destructive reset is required. Deploy backend and client together. Existing masters remain available, while all approved legacy items reappear for Master 1. Item rows allow up to five item-size rows and four box-size rows; Inner + Master mode uses two rows and Individual + Master uses one master carton row. Existing nonnegative numeric and remark validation remains in place.

Validation: backend/tests/masterWorkflow.test.js covers the full 1 + 3 + 3 sequence, legacy and unchanged reviews, duplicate/reused POs, approval/date rules, concurrent/stale submissions, PD invalidation, tolerances/missing data, permissions, PIS preservation and locked model writes. Frontend utility tests cover master-only payloads and packaging transitions. Run backend npm test, frontend npm test and npm run build, then exercise the four pages with representative items before production rollout.

After building the frontend, run `node tests/masterWorkflow.browser.js` from backend for the browser check. It serves the built client locally and intercepts all API requests using synthetic data: no database or production API is contacted. It exercises all four pages, unchanged stage reviews, waiting progress, PO reuse exclusion, discrepancy reasons, invalidated sign-off and finalization, then writes a screenshot under .tmp.
