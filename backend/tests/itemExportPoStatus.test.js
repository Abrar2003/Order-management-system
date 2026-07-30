const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: { buildItemPoStatusSummary },
} = require("../controllers/item.controller");

const order = (overrides = {}) => ({
  quantity: 10,
  shipment: [],
  qc_record: null,
  ...overrides,
});

test("item exports count each active PO status and omit shipped POs from current running rows", () => {
  const { summary, currentRunningPos } = buildItemPoStatusSummary([
    order(),
    order({
      qc_record: {
        quantities: { qc_passed: 5 },
        request_history: [{ status: "open", quantity_requested: 5 }],
      },
    }),
    order({ qc_record: { quantities: { qc_passed: 10 } } }),
    order({ qc_record: { quantities: { qc_passed: 10 } }, shipment: [{ quantity: 4 }] }),
    order({ qc_record: { quantities: { qc_passed: 10 } }, shipment: [{ quantity: 10 }] }),
  ]);

  assert.deepEqual(summary, {
    current_running_pos: 4,
    inspected_pos: 1,
    partially_inspected_pos: 1,
    shipped_pos: 1,
    partially_shipped_pos: 1,
    pending_pos: 1,
  });
  assert.equal(currentRunningPos.length, 4);
});
