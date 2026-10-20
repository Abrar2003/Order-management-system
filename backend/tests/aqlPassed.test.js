const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getInspectionPassedFields,
  buildEffectivePassedQuantityByInspectionId,
  calculateQcAggregateMetrics,
} = require("../helpers/inspectionPassedQuantity");
const { buildAqlPassedBackfill } = require("../services/aqlPassedBackfill.service");

const qc = {
  _id: "qc", request_type: "FULL", quantities: { client_demand: 600 },
  request_history: [
    { _id: "first", request_type: "AQL", quantity_requested: 300, request_date: "2026-10-01", inspector: "inspector" },
    { _id: "second", request_type: "AQL", quantity_requested: 300, request_date: "2026-10-02" },
    { _id: "normal", request_type: "FULL", quantity_requested: 300 },
  ],
};
const visit = (overrides = {}) => ({
  _id: "visit", qc, request_history_id: "first", vendor_requested: 300, passed: 1,
  checked: 1, rejected: 0, vendor_offered: 300, inspection_date: "2026-10-01", status: "Inspection Done",
  ...overrides,
});

test("AQL uses the requested snapshot, never order demand or sample quantity", () => {
  assert.deepEqual(getInspectionPassedFields(visit({ vendor_requested: 600, passed: 50 })), { request_type: "AQL", aql_passed: 600 });
  assert.equal(getInspectionPassedFields(visit({ passed: 0 })).aql_passed, 0);
  assert.equal(getInspectionPassedFields(visit({ vendor_requested: 100 })).aql_passed, 100);
  assert.equal(getInspectionPassedFields(visit({ vendor_requested: 0 })).aql_passed, 300);
  assert.equal(getInspectionPassedFields(visit({ request_history_id: "missing", vendor_requested: 0 }), { request_type: "AQL", quantities: { client_demand: 600 } }).aql_passed, 0);
  assert.deepEqual(getInspectionPassedFields(visit({ request_history_id: "normal" })), { request_type: "FULL", aql_passed: null });
});

test("separate AQL requests approve 300 each and normal passes remain sample counts", () => {
  const records = [visit(), visit({ _id: "v2", request_history_id: "second" }), visit({ _id: "v3", request_history_id: "normal", passed: 5 })];
  const metrics = calculateQcAggregateMetrics(qc, records);
  assert.equal(metrics.totalEffectivePassed, 605);
  assert.equal(metrics.totalSamplePassed, 7);
  assert.equal(calculateQcAggregateMetrics(qc, [records[0]]).totalEffectivePassed, 300);
});

test("duplicate visits contribute once at the latest passing visit, before filtering", () => {
  const records = [visit(), visit({ _id: "later", inspection_date: "2026-10-02" }), visit({ _id: "failed", passed: 0, inspection_date: "2026-10-03" })];
  const map = buildEffectivePassedQuantityByInspectionId(records);
  assert.deepEqual(Object.fromEntries(map), { visit: 0, later: 300, failed: 0 });
  assert.equal(map.get(records.filter((record) => record.inspection_date === "2026-10-01")[0]._id), 0);
  assert.equal(calculateQcAggregateMetrics(qc, records.map((record) => ({ ...record, passed: 0 }))).totalEffectivePassed, 0);
});

test("transferred visits are excluded, including both stored spellings", () => {
  for (const status of ["transferred", "transfered"]) {
    assert.equal(calculateQcAggregateMetrics(qc, [visit({ status })]).totalEffectivePassed, 0);
  }
  assert.equal(calculateQcAggregateMetrics(qc, [visit({ passed: 1 })]).totalEffectivePassed, 300);
});

test("legacy requests match by date and inspector, with historical type precedence", () => {
  const record = visit({ request_history_id: null, requested_date: "2026-10-01", inspector: "inspector" });
  assert.deepEqual(getInspectionPassedFields(record), { request_type: "AQL", aql_passed: 300 });
  const map = buildEffectivePassedQuantityByInspectionId([record, visit({ _id: "linked", inspection_date: "2026-10-02" })]);
  assert.deepEqual(Object.fromEntries(map), { visit: 0, linked: 300 });
});

test("backfill is idempotent, refreshes pending, and preserves all sample counts", () => {
  const records = [visit({ aql_passed: 123, pending_after: 599 }), visit({ _id: "v2", request_history_id: "second", passed: 50, checked: 50, inspection_date: "2026-10-02" })];
  const result = buildAqlPassedBackfill(qc, records);
  assert.equal(result.quantities.qc_passed, 600);
  assert.equal(result.quantities.pending, 0);
  assert.deepEqual(result.visits.map((record) => record.pending_after), [300, 0]);
  assert.deepEqual(result.visits.map((record) => record.passed), [1, 50]);
  assert.deepEqual(buildAqlPassedBackfill({ ...qc, quantities: result.quantities }, result.visits), result);
});
