import assert from "node:assert/strict";
import test from "node:test";
import {
  SHIPPING_MARK_FILE_PAGE_OPTIONS,
  buildItemFileUploadRequest,
  getItemFileValues,
  isItemFileOptionAvailableForItem,
} from "./itemFiles.js";

test("shipping mark page keeps the five upload destinations separate", () => {
  assert.deepEqual(SHIPPING_MARK_FILE_PAGE_OPTIONS.map(option => option.value), [
    "shipping_marks", "flat_carton", "ean", "logistics_ean", "three_d_carton",
  ]);
  for (const option of SHIPPING_MARK_FILE_PAGE_OPTIONS) {
    const file = new File(["test"], `${option.value}.pdf`, { type: "application/pdf" });
    const request = buildItemFileUploadRequest({ itemId: "item-1", fileType: option.value, file });
    assert.equal(request.path, "/items/item-1/files");
    assert.equal(request.formData.get("file_type"), option.value);
    assert.equal(request.formData.get("file").name, file.name);
  }
});

test("shipping mark page preserves legacy files and KD eligibility", () => {
  const file = { key: "legacy.pdf" };
  const item = { shipping_marks: { shipping_marks_1: file, flat_carton_2: file } };
  assert.deepEqual(getItemFileValues(item, "shipping_marks"), [file]);
  assert.deepEqual(getItemFileValues(item, "flat_carton"), [file]);
  assert.deepEqual(getItemFileValues(item, "ean"), []);
  assert.equal(isItemFileOptionAvailableForItem("logistics_ean", item), false);
  assert.equal(isItemFileOptionAvailableForItem("logistics_ean", { kd: true }), true);
});
