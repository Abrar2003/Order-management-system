import assert from "node:assert/strict";
import test from "node:test";
import { getRemainingTasks } from "./loginTaskPopup.js";

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
