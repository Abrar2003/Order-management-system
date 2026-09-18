import assert from "node:assert/strict";
import test from "node:test";
import { normalizeApiVendorRefs } from "./axios.js";

test("keeps vendor access options with their brand ids", () => {
  const response = normalizeApiVendorRefs({
    vendors: [{ _id: "vendor-1", name: "Boranada", country: "IN", brand_ids: ["brand-1"] }],
  });

  assert.deepEqual(response.vendors, [{
    _id: "vendor-1",
    name: "Boranada",
    country: "IN",
    brand_ids: ["brand-1"],
  }]);
});
