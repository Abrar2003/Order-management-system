import assert from "node:assert/strict";
import test from "node:test";
import { getItemPoTarget } from "./itemNavigation.js";
import { isQcAllowedPagePath } from "../auth/permissions.js";

test("QCs open QC details even before an inspection; missing QC never opens Orders", () => {
  assert.equal(getItemPoTarget({ po: "PO-1", qc_id: "qc-1", inspection_count: 0 }, true), "/qc/qc-1");
  assert.equal(getItemPoTarget({ po: "PO-1" }, true), "");
  assert.equal(getItemPoTarget({}, true), "");
});

test("other roles keep the existing PO navigation", () => {
  assert.equal(getItemPoTarget({ po: "PO 1", qc_id: "qc-1", inspection_count: 0 }), "/orders?order_id=PO%201");
  assert.equal(getItemPoTarget({ po: "PO-1", qc_id: "qc-1", inspection_count: 1 }), "/qc/qc-1");
});

test("QC page allowlist admits item viewing and keeps Orders and item history blocked", () => {
  for (const path of ["/items", "/items/ABC/details?vendor=123", "/qc/123", "/qc/123/inspection-report"]) {
    assert.equal(isQcAllowedPagePath(path), true, path);
  }
  for (const path of ["/orders", "/all-orders", "/items/ABC/orders-history", "/items/ABC/edit"]) {
    assert.equal(isQcAllowedPagePath(path), false, path);
  }
});
