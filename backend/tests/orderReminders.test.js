const assert = require("node:assert/strict");
const test = require("node:test");

const Order = require("../models/order.model");
const {
  getUnacknowledgedReminderWarnings,
  normalizeReminderStatus,
  normalizeReminderType,
  selectReminderAnchor,
} = require("../services/orderReminder.service");

test("order reminders default legacy values to pending QC", () => {
  const order = new Order({
    reminders: [{ comment: "Check artwork" }],
  });

  assert.equal(order.reminders[0].type, "qc");
  assert.equal(order.reminders[0].status, "pending");
  assert.equal(normalizeReminderType(""), "qc");
  assert.equal(normalizeReminderStatus(""), "pending");
  assert.ok(order.validateSync().errors["reminders.0.comment"] === undefined);
});

test("reminder anchor prefers inspected, then shipped, then oldest open PO", () => {
  const inspected = { order_id: "INSPECTED", order_date: "2026-01-01", qc_record: { last_inspected_date: "2026-05-01" } };
  const shipped = { order_id: "SHIPPED", order_date: "2026-01-02", shipment: [{ stuffing_date: "2026-06-01" }] };
  const pending = { order_id: "PENDING", order_date: "2026-01-03", quantity: 1 };
  assert.equal(selectReminderAnchor([shipped, pending, inspected]).order.order_id, "INSPECTED");
  assert.equal(selectReminderAnchor([shipped, pending]).order.order_id, "SHIPPED");
  assert.equal(
    selectReminderAnchor([
      { order_id: "NEWER", order_date: "2026-02-01", quantity: 1 },
      { order_id: "OLDER", order_date: "2026-01-01", quantity: 1 },
    ]).order.order_id,
    "OLDER",
  );
});

test("only unacknowledged pending Admin warnings block a request", () => {
  const warnings = [{ _id: "one" }, { _id: "two" }];
  assert.deepEqual(
    getUnacknowledgedReminderWarnings({ warnings, acknowledgedReminderIds: ["one"] }),
    [{ _id: "two" }],
  );
});
