const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRectifyText, processRectifyRows } = require("../helpers/rectifyImporterHelper");

test("normalizeRectifyText strips invalid values", () => {
  assert.equal(normalizeRectifyText("abc"), "abc");
  assert.equal(normalizeRectifyText(" abc  "), "abc");
  assert.equal(normalizeRectifyText(null), "");
  assert.equal(normalizeRectifyText(undefined), "");
  assert.equal(normalizeRectifyText("null"), "");
  assert.equal(normalizeRectifyText("undefined"), "");
  assert.equal(normalizeRectifyText("[object Object]"), "");
  assert.equal(normalizeRectifyText("N/A"), "");
});

test("processRectifyRows handles invalid rows missing code or description", () => {
  const rows = [
    { ourItemCode: "", yourItemCode: "", description: "Good Item" },
    { ourItemCode: "ITEM1", description: "" },
    { ourItemCode: "ITEM2", description: "Good Item" },
  ];
  const existingCodesSet = new Set();
  const vendor = { _id: "v123", name: "Vendor A", country: "China" };
  const brand = { name: "Brand X" };

  const res = processRectifyRows({ rows, existingCodesSet, vendor, brand });

  assert.equal(res.invalid.length, 2);
  assert.equal(res.toCreate.length, 1);
  assert.equal(res.toCreate[0].code, "ITEM2");
  assert.equal(res.toCreate[0].name, "Good Item");
  assert.equal(res.toCreate[0].country_of_origin, "China");
});

test("processRectifyRows handles duplicates and conflicts case-insensitively", () => {
  const rows = [
    { ourItemCode: "item1", description: "Desc 1" },
    { ourItemCode: "ITEM1", description: "Desc 1" }, // Duplicate, same desc
    { ourItemCode: "ITEM2", description: "Desc A" },
    { ourItemCode: "item2", description: "Desc B" }, // Conflict, diff desc
  ];
  const existingCodesSet = new Set();
  const vendor = { _id: "v123", name: "Vendor A", country: "Vietnam" };
  const brand = { name: "Brand X" };

  const res = processRectifyRows({ rows, existingCodesSet, vendor, brand });

  // invalid
  assert.equal(res.invalid.length, 0);
  // conflicting: item2 should be flagged as conflict
  assert.equal(res.conflicting.length, 1);
  assert.equal(res.conflicting[0].code, "item2");
  // duplicates: ITEM1 (same description) should be duplicate
  assert.equal(res.duplicates.length, 1);
  assert.equal(res.duplicates[0].code, "ITEM1");
  // toCreate: only item1 should be created, item2 should be skipped due to conflict
  assert.equal(res.toCreate.length, 1);
  assert.equal(res.toCreate[0].code, "item1");
  assert.equal(res.toCreate[0].country_of_origin, "Vietnam");
});

test("processRectifyRows filters out existing codes", () => {
  const rows = [
    { ourItemCode: "ITEM1", description: "Desc 1" },
    { ourItemCode: "ITEM2", description: "Desc 2" },
  ];
  const existingCodesSet = new Set(["ITEM1"]);
  const vendor = { _id: "v123", name: "Vendor A", country: "India" };
  const brand = { name: "Brand X" };

  const res = processRectifyRows({ rows, existingCodesSet, vendor, brand });

  assert.equal(res.existing.length, 1);
  assert.equal(res.existing[0].code, "ITEM1");
  assert.equal(res.toCreate.length, 1);
  assert.equal(res.toCreate[0].code, "ITEM2");
});
