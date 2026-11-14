const assert = require("node:assert/strict");
const test = require("node:test");
const { CYCLE_VERSION, masterSnapshot } = require("../helpers/masterWorkflow");
const { buildReset } = require("../scripts/resetMasterWorkflowToMaster");

const start = "2026-07-03T12:32:00.000Z";
const master = masterSnapshot({ master_item_sizes: [{ L: 25 }], cbm: { calculated_master_total: "0.012" } });
const review = { stage: "master", reviewed_at: start, evidence: [{ po: " PO-123 " }], master };
const history = [
  { source: "master_workflow", metadata: { stage: "master" } },
  { source: "master_workflow", metadata: { stage: "master_1" } },
  { source: "unrelated", metadata: { stage: "master_1" } },
];

test("restores saved Master fields and only the first review for each later stage", () => {
  for (const stage of ["master_1", "master_2", "final_master", "finalized"]) {
    const update = buildReset({
      update_history: history,
      master_workflow: {
        cycle_version: CYCLE_VERSION, stage, revision: 5, reviews: [review, { stage: "master_1" }],
        consumed_pos: ["po-123", "po-456"],
        events: [{ stage: "master", action: "review" }, { stage: "master_1", action: "review" }],
        pd_review: {}, finalized_by: {}, finalized_at: start, final_snapshot: {},
      },
    });
    assert.deepEqual(update.master_item_sizes, master.master_item_sizes);
    assert.equal(update["cbm.calculated_master_total"], "0.012");
    assert.deepEqual(update.update_history, [history[0], history[2]]);
    assert.deepEqual(update.master_workflow, {
      cycle_version: CYCLE_VERSION, stage: "master", revision: 6, started_at: new Date(start),
      consumed_pos: ["po-123"], reviews: [review], events: [{ stage: "master", action: "review" }],
    });
    for (const field of ["pis_item_sizes", "pd_item_sizes", "qc_mismatch_comments", "qc_mismatch_reviewed_at"]) {
      assert.equal(Object.hasOwn(update, field), false);
    }
  }
});

test("restores a legacy Master and rejects missing or incomplete restoration data", () => {
  const workflow = {
    cycle_version: CYCLE_VERSION, stage: "master_1", revision: 1,
    legacy_master: master, legacy_master_created_at: start,
  };
  const { master_workflow: restored } = buildReset({ master_workflow: workflow });
  assert.equal(restored.stage, "master");
  assert.deepEqual(restored.reviews, []);
  assert.deepEqual(restored.consumed_pos, []);
  assert.equal(restored.legacy_master, master);
  const undated = { master_workflow: { ...workflow, legacy_master_created_at: undefined } };
  assert.equal(buildReset(undated).master_workflow.started_at, null);
  assert.deepEqual(buildReset(undated, [start]).master_workflow.started_at, new Date(start));
  for (const invalid of [{ legacy_master: undefined }, { legacy_master: {} }]) {
    assert.throws(() => buildReset({ master_workflow: { ...workflow, ...invalid } }), /restorable Master/);
  }
});
