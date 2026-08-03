const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getQcUserInspectionUpdateAllowance,
} = require("../helpers/qcUpdateWindow");

const now = new Date("2026-08-03T10:00:00.000Z");
const ownRecord = (overrides = {}) => ({
  inspector: "qc-user",
  qc_update_count: 1,
  qc_update_window_started_at: new Date("2026-08-03T09:15:00.000Z"),
  ...overrides,
});

test("QC can make two further updates in the one-hour window", () => {
  const result = getQcUserInspectionUpdateAllowance({
    inspectionRecord: ownRecord(),
    userId: "qc-user",
    now,
  });

  assert.equal(result.isAvailable, true);
  assert.equal(result.currentUpdateCount, 1);
  assert.equal(result.remainingUpdates, 2);
});

test("QC cannot exceed three updates for one inspection record", () => {
  const result = getQcUserInspectionUpdateAllowance({
    inspectionRecord: ownRecord({ qc_update_count: 3 }),
    userId: "qc-user",
    now,
  });

  assert.equal(result.isAvailable, false);
  assert.match(result.reason, /3-update limit/);
});

test("QC cannot update after one hour", () => {
  const result = getQcUserInspectionUpdateAllowance({
    inspectionRecord: ownRecord({
      qc_update_window_started_at: new Date("2026-08-03T09:00:00.000Z"),
    }),
    userId: "qc-user",
    now,
  });

  assert.equal(result.isAvailable, false);
  assert.match(result.reason, /1-hour/);
});

test("QC cannot update another inspector's record", () => {
  const result = getQcUserInspectionUpdateAllowance({
    inspectionRecord: ownRecord({ inspector: "another-qc" }),
    userId: "qc-user",
    now,
  });

  assert.equal(result.isAvailable, false);
  assert.match(result.reason, /only their own/);
});
