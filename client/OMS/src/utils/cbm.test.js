import assert from "node:assert/strict";
import test from "node:test";
import { resolvePreferredCbm } from "./cbm.js";

test("prefers the first available calculated CBM", () => {
  assert.equal(resolvePreferredCbm("0", "0.45", "0.5"), 0.45);
});
