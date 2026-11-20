import assert from "node:assert/strict";
import test from "node:test";
import { normalizeApiVendorRefs } from "./axios.js";

test("QC vendor scope preserves IDs used for authorized vendor selection", () => {
  const vendor_scope = { restricted: true, vendors: [{ vendor_id: "vendor-1", name: "Alpha" }], selected_vendor_id: "vendor-1" };
  assert.deepEqual(normalizeApiVendorRefs({ vendor_scope }).vendor_scope, vendor_scope);
});

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

test("preserves vendor identity and tax identifiers while flattening shipment references", () => {
  const vendor = { _id: "vendor-1", name: "Boranada", gst: "08AADCB3689G1ZH", pan: "AADCB3689G" };
  const response = normalizeApiVendorRefs({
    vendors: [{ vendor, stuffed_cft: 17.6 }],
    chain: { vendor },
    shipment: { vendor: { name: "Boranada", vendor_id: "vendor-1", country: "India" } },
  });

  assert.deepEqual(response.vendors[0].vendor, vendor);
  assert.deepEqual(response.chain.vendor, vendor);
  assert.equal(response.shipment.vendor, "Boranada");
});
