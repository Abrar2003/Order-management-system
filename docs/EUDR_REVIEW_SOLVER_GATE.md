# Resolution: network-level review replaces attribution

The user explicitly removed `supportableAtStage` and container-specific upstream
quantity/loss attribution. The integration now reviews each connected supply
network per species, excluding container commitments as artificial bridges between
otherwise separate production networks. Shared invoices and physical mixing remain
network links; all competing commitments remain in authoritative quantity checks.

Finished production is counted once per FINISHED manufacturing output lot feeding
any reserved/committed container. Same-form onward receipts are not extra finished
production. Each documented stage lot/operation is counted once within its network.
The table says **Network-level; not attributed to this container**. Independent
network totals and the existing solver ranges are never added to make a clearance
claim. Yield and factory-wastage checks use recorded per-operation inputs/outputs.
The old eight diagnostics, including the 162-network sweep, remain unchanged.

This decision supersedes the historical stop condition below. Implementation
continues through models, migration, services, APIs, UI, and verification.

---

# Timber Trace: solver gate result

## Result: blocked before dependent implementation

The approved plan requires container-specific upstream ranges, including competing
commitments and transformations, and requires stopping if those ranges cannot be
validated while preserving the existing guarantees. That gate has **not passed**.

The current lower-bound circulation correctly answers documentary feasibility and
aggregate lot-use questions. Its existing range API does not answer the new
container-specific lineage question. The tests below establish this difference;
they do not establish that no exact algorithm can ever answer the new question.

No production solver, schema, migration, API, clearance rule, or UI was changed.
No `supportableAtStage` export or approximate fallback was added.

## Mapping to the existing OMS

| Prototype concept | Existing OMS concept |
| --- | --- |
| Case | Real container + shipping-vendor group, possibly with several contribution chains |
| Document register | Global inventory ledger and canonical invoice registry |
| Exporter and product | Existing Vendor and Item/Sample records |
| Felling proof | Production source and its RAW lot |
| Sawing record | RAW -> PROCESSING_INPUT transformation |
| Sawn-wood purchase | PROCESSING_INPUT transfer and receipt |
| Factory production | PROCESSING_INPUT -> FINISHED transformation |
| Exported wood | FINISHED commitment(s) for the container/vendor group |

## Executable counterexamples

Run from `backend`:

```powershell
node --test tests/eudrQuantity.test.js tests/eudrStageSupport.gate.test.js
```

Fixtures use deliberately small integer **milli-CFT**. The labelled oracle is
test-only, exhaustive, and limited to small lossless graphs. It keeps each full
documentary allocation and independently enumerates every compatible target-group
label. It does not use a solver witness as real provenance or persist witnesses.

### 1. Shared production is not the selected container's production

Six RAW units pass through sawing, a sawn-wood sale, and manufacturing. Container G
commits two finished units; container H commits four. All conversions are lossless.

| Quantity | Minimum | Maximum |
| --- | ---: | ---: |
| Existing range: global RAW lot use | 6 | 6 |
| Exhaustive range: RAW contribution attributable to G | 2 | 2 |

Filtering lots to G's ancestor network does not fix this: G and H share the same
ancestors. Historical operations continue to consume their full documentary
quantities even if a downstream commitment is removed. Subtracting ranges from a
graph with that commitment removed is therefore not an attribution algorithm.

### 2. Unknown upstream input shares need another set of constraints

Two RAW roots each have four units. An UNKNOWN sawing operation consumes six,
followed by sale/manufacturing and G=2, H=4 finished commitments.

| Quantity | Minimum | Maximum |
| --- | ---: | ---: |
| Existing range: global use of root A | 2 | 4 |
| Exhaustive range: root A attributable to G | 0 | 2 |
| Existing range: global use of roots A+B | 6 | 6 |
| Exhaustive range: roots A+B attributable to G | 2 | 2 |

Neither global committed use nor uncommitted capacity represents G's upstream
support. Summing individual maxima also fails: two roots can each contribute up
to two to G, while their combined contribution cannot exceed G's two units.

### 3. A competing commitment can exclude an ancestor

Separate two-unit RAW roots each become separate finished lots A and B. G can draw
two finished units from A or B. H has an EXACT two-unit allocation from A.

The existing RAW-A global range remains [2,2]. G's RAW-A attributable range is
[0,0]. An ON_HOLD H still excludes A; cancellation changes G's range to [0,2].
Thus keeping the ancestor graph but ignoring other target labels can overstate
even the most generous support available to G.

The suite also checks EXACT/PARTIAL target bounds, canonical invoice caps and
invoice chronology. An exhaustive sweep of 162 small competing-demand networks
matches independently calculated target-range extrema and existing feasibility.

### 4. Recorded loss needs an explicit stage-quantity definition

A recorded saw operation consumes ten RAW units and produces six sawn units.
These become six finished units, with G=3 and H=3. Documentary feasibility passes.

Three different quantities could be called G's upstream support:

- Retained output-equivalent volume: three units.
- Gross input with an unknown split of the four lost units: anywhere from three
  to seven units. For every loss split, G's and H's gross inputs still sum to ten.
- Proportional gross input: five units, which assumes a proportional loss split
  that the plan explicitly disallows.

The recorded aggregate loss does not choose between these definitions. The test
enumerates all five integer loss splits; the lossless oracle deliberately refuses
to manufacture an answer for this graph. This matters when comparing RAW support
with `finished / max_yield`, which is a gross RAW requirement rather than a
retained-finished-volume requirement.

## Why the existing query cannot simply be extended with a lot filter

In `eudrQuantity.service.js`, the circulation contains lot-capacity edges, bounded
lot-to-operation input edges, and fixed operation-to-sink demand edges. A receipt
lot gets its own capacity edge. Its relationship to its incoming operation is
validated, but there is no flow edge carrying a target-container label from that
operation into the receipt and onward into a particular commitment.

The range bisection constrains the total capacity consumed from selected lots
across **all** active operations. It neither identifies the selected commitment
nor couples an upstream subflow to that commitment through successive receipts.

`component()` already retains connected competing commitments. `potentialOrigins()`
already traverses possible ancestry. Neither supplies those missing quantitative
constraints; narrowing origin reporting to an arbitrary flow would violate the
approved plan.

## Required revision before implementing the integration

1. Keep the current `reconcile()` contract, integer arithmetic, A-H scenarios,
   chronology, invoice caps, and work limits authoritative. Do not replace its
   established results with stage-attribution results.
2. Define each stage measurement explicitly: selected group commitments, species,
   a deduplicated stage boundary, and gross versus retained volume. Recommended
   loss treatment for evaluation is a bounded unknown loss allocation, not a
   proportional allocation; that interpretation needs to be adopted explicitly.
3. Design a separate read-only, coupled integer lineage query. If `f(l,o)` is a
   full documentary input allocation and `g(l,o)` is its hypothetical target-group
   portion, enforce `0 <= g(l,o) <= f(l,o)` along with every existing constraint
   on `f`. Selected commitments consume their full target labels; other terminal
   commitments consume none of those labels.
4. Couple target-labelled input, receipt output, and recorded loss at every
   operation. For gross accounting, the target's attributed input equals its
   tagged output plus a bounded attributed loss. Account for unused receipt
   capacity and other commitments without creating supply or assigning loss to
   an unrelated path. Material stages and species must stay distinct.
5. Prove a reduction to a bounded circulation query or select an exact integer
   optimization approach for those coupled constraints. The existing circulation
   API alone is not that implementation. A production query must handle realistic
   milli-CFT without enumerating individual units; this test oracle is unsuitable
   for production sizes.
6. Validate both extrema against an independent exhaustive oracle expanded to
   nested merges, multiple group commitments, and the adopted loss policy. Retain
   `additive:false`, `allocation_is_provenance:false`, and no returned/persisted
   source assignment. Infeasibility/work limits must fail closed, not yield a
   reassuring approximate range.

Only after that design passes the gate should species/schema changes, proof-index
transitions, review evaluation, reports, APIs, or UI implementation begin. This is
the stop condition explicitly selected in the approved plan, not a request to
weaken the requirement or an approval requirement imposed by a skill.

## Verification scope

The focused command above passes 26 tests: 18 existing quantity tests and eight
gate diagnostics (including the 162-network sweep). Those passing diagnostics
reproduce the missing capability; they do **not** mean the release gate passed.

The full backend `npm test` run also completed: 703 tests total, 702 passed, one
skipped, and zero failed. Production code was not changed to obtain these results.

Production migration, MongoDB integration, provider calls, frontend/browser tests,
and the production build are outside this stopped implementation stage.
