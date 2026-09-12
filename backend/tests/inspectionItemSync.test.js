const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isEligibleInspectionForItemSync,
  pickLatestInspectionRecord,
} = require("../services/inspectionItemSync.service");

test("an empty later inspection cannot replace an item's measured snapshot", () => {
  const measured = {
    _id: "measured",
    inspection_date: "2026-09-09",
    createdAt: "2026-09-08T10:49:05.438Z",
    status: "Inspection Done",
    checked: 33,
    inspected_item_sizes: [{ L: 80, B: 80, H: 42 }],
  };
  const emptyLaterRecord = {
    _id: "empty",
    inspection_date: "2026-09-09",
    createdAt: "2026-09-11T07:05:47.208Z",
    status: "Inspection Done",
    checked: 1,
    inspected_item_sizes: [],
    inspected_box_sizes: [],
  };

  assert.equal(isEligibleInspectionForItemSync(emptyLaterRecord), false);
  assert.equal(
    pickLatestInspectionRecord([measured, emptyLaterRecord].filter(isEligibleInspectionForItemSync))._id,
    "measured",
  );
});
