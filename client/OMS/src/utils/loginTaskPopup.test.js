import assert from "node:assert/strict";
import test from "node:test";
import { getRemainingTasks, getTaskPopupSlot } from "./loginTaskPopup.js";

test("reminders are limited to the two IST workday slots, regardless of device timezone", () => {
  const cases = [
    ["2026-10-19T03:29:59Z", null],
    ["2026-10-19T03:30:00Z", null],
    ["2026-10-19T04:29:59Z", null],
    ["2026-10-19T04:30:00Z", "2026-10-19:morning"],
    ["2026-10-19T09:59:59Z", "2026-10-19:morning"],
    ["2026-10-19T10:00:00Z", "2026-10-19:afternoon"],
    ["2026-10-19T12:29:59Z", "2026-10-19:afternoon"],
    ["2026-10-19T12:30:00Z", null],
    ["2026-10-19T18:30:00Z", null],
    ["2026-10-20T04:30:00Z", "2026-10-20:morning"],
    ["2026-10-19T10:00:00+05:30", "2026-10-19:morning"],
    ["2026-10-18T23:00:00-07:00", "2026-10-19:morning"],
  ];
  for (const [time, expected] of cases) {
    assert.equal(getTaskPopupSlot(new Date(time)), expected, time);
  }
});

test("login task popup keeps every task with remaining work", () => {
  assert.deepEqual(
    getRemainingTasks([
      { key: "cad", pending_count: 2 },
      { key: "assembly", pending_count: 0 },
      { key: "marks", pending_count: 1 },
    ]).map((task) => task.key),
    ["cad", "marks"],
  );
});
