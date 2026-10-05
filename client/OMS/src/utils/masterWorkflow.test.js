import test from "node:test";
import assert from "node:assert/strict";
import { masterForm, formFromInspection, changeBoxMode } from "./masterWorkflow.js";

test("master editor never includes PIS fields and clones measurements", () => {
  const item = { master_barcode: "legacy", master_item_sizes: [{ L: 10 }], pis_barcode: "vendor", pis_item_sizes: [{ L: 20 }] };
  const form = masterForm(item);
  assert.equal(form.master_master_barcode, "legacy"); assert.equal(form.master_box_mode, "individual");
  assert.equal(Object.keys(form).some((field) => field.startsWith("pis_")), false);
  form.master_item_sizes[0].L = 99; assert.equal(item.master_item_sizes[0].L, 10);
});
test("inspection copy is explicit and packaging mode changes preserve entered sizes", () => {
  const inspection = { item_sizes: [{ L: 10 }], box_sizes: [{ L: 20 }], box_mode: "individual", master_barcode: "qc", inner_barcode: "inner" };
  const form = formFromInspection(masterForm({}), inspection);
  const carton = changeBoxMode(form, "carton");
  assert.equal(carton.master_box_sizes.length, 2); assert.equal(carton.master_box_sizes[0].L, 20);
  assert.deepEqual(carton.master_box_sizes.map((entry) => entry.box_type), ["inner", "master"]);
  const master = changeBoxMode(carton, "individual_master"); assert.equal(master.master_box_sizes.length, 1);
  assert.equal(master.master_box_sizes[0].box_type, "master");
  carton.master_item_sizes[0].L = 123; assert.equal(inspection.item_sizes[0].L, 10);
});
