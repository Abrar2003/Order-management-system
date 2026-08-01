import assert from "node:assert/strict";
import test from "node:test";
import { hasOpenVendorOrders } from "./vendorSummary.js";

test("recognizes vendors with an unshipped order as active", () => {
  assert.equal(hasOpenVendorOrders({ totalOrders: 3, totalShipped: 2 }), true);
  assert.equal(hasOpenVendorOrders({ totalOrders: 3, totalShipped: 3 }), false);
  assert.equal(hasOpenVendorOrders(), false);
});
