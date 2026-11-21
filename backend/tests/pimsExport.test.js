const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const { PIMS_HEADERS, buildPimsRow, buildPimsWorkbook } = require("../helpers/pimsExport");
const { PIMS_FIELDS, addPimsTemplateFields } = require("../helpers/pimsTemplateFields");
const { prepareTemplatePayload } = require("../helpers/productTypeTemplates");
const { buildProductDatabaseRow } = require("../helpers/productDatabase");

const field = (key, value) => ({ key, value_type: "string", value_text: value });
const diningTable = () => ({
  code: "000123", name: "Existing name", kd: true,
  product_type: { key: "table", label: "Table" },
  product_specs: {
    fields: [
      field("sub_product_type", "Dining Table"), field("article_name", "Oak table"),
      field("season", "SS26"), field("top_color_name", "Brown, Black"),
      field("legs_color_name", "Black"), field("top_wood_type", "Oak"),
      field("legs_metal_type", "Steel"), field("finish", "Lacquered, brushed"),
      field("maintenance_text", "Wipe with a dry cloth"),
      { key: "table_top_thickness", value_type: "number", value_number: 3 },
      { key: "height_to_underside", value_type: "number", value_number: 72 },
      { key: "distances_between_legs", value_type: "array", value_array: [120, 60] },
    ],
    item_sizes: [{ remark: "article", L: 180, B: 90, H: 75 }],
    box_sizes: [
      { remark: "box3", L: 30, B: 20, H: 10, gross_weight: 5 },
      { remark: "box1", L: 190, B: 100, H: 15, gross_weight: 25 },
    ],
  },
});

test("PIMS workbook matches all image headings, preserving codes, colli slots, and source data", () => {
  const table = diningTable();
  const original = structuredClone(table);
  const buffer = buildPimsWorkbook([buildProductDatabaseRow(table), { product_type: { key: "cabinet" } }]);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const data = XLSX.utils.sheet_to_json(workbook.Sheets.PIMS, { header: 1, defval: "" });
  assert.deepEqual(data, [PIMS_HEADERS, [
    "000123", "Oak table", "SS26", "Brown, Black", "Oak, Steel", "Lacquered, brushed",
    "Wipe with a dry cloth", 180, 90, 75, 3, 72, "120, 60", "Yes",
    "190 x 100 x 15", "", "30 x 20 x 10", 25, "", 5,
  ]]);
  assert.equal(workbook.Sheets.PIMS.A2.t, "s");
  assert.deepEqual(table, original);
});

test("PIMS uses existing fallbacks without turning maintenance flags or clearance into instructions", () => {
  const row = buildPimsRow({
    code: "001", name: "Coffee table", kd: false,
    pd_item_sizes: [{ remark: "item", L: 0, B: 50, H: 40 }],
    pd_box_sizes: [{ remark: "top", L: 110, B: 60, H: 10, gross_weight: 0 }],
    product_specs: {
      fields: [field("sub_product_type", "Coffee Table"), field("treated", "Lacquered"),
        { key: "wire_brush", label: "Wire Brush", value_type: "boolean", value_boolean: true },
        { key: "maintenance_instruction", value_type: "boolean", value_boolean: true },
        { key: "leg_clearance_from_floor", value_type: "number", value_number: 38 },
        { key: "assembly_needed", value_type: "boolean", value_boolean: true }],
      item_sizes: [{ remark: "article", L: 100, B: 50, H: 40 }],
    },
  });
  assert.equal(row[1], "Coffee table");
  assert.equal(row[5], "Lacquered, Wire Brush");
  assert.equal(row[6], "");
  assert.equal(row[7], 0);
  assert.equal(row[11], "");
  assert.equal(row[12], "");
  assert.equal(row[13], "Yes");
  assert.equal(row[14], "110 x 60 x 10");
  assert.equal(row[17], 0);
  assert.deepEqual(buildPimsRow({}).slice(14), ["", "", "", "", "", ""]);
});

test("PIMS field additions are optional, additive, valid and idempotent", () => {
  const template = { key: "table", label: "Table", groups: [{
    key: "basic_info", label: "Basic Info", fields: [
      { key: "season", label: "Existing Season", input_type: "text", value_type: "string", required: true },
      { key: "maintenance_instruction", label: "Maintenance Instruction", input_type: "boolean", value_type: "boolean" },
    ],
  }] };
  const originalGroup = structuredClone(template.groups[0]);
  addPimsTemplateFields(template);
  assert.deepEqual(template.groups[0], originalGroup);
  assert.equal(template.groups[1].fields.length, 4);
  assert.ok(template.groups[1].fields.every((entry) => entry.required === false));
  assert.deepEqual(template.groups[1].fields.map((entry) => entry.key), PIMS_FIELDS.map((entry) => entry.key).filter((key) => key !== "season"));
  const once = structuredClone(template);
  addPimsTemplateFields(template);
  assert.deepEqual(template, once);
  assert.doesNotThrow(() => prepareTemplatePayload(template));
  const cabinet = { key: "cabinet", groups: [] };
  addPimsTemplateFields(cabinet);
  assert.deepEqual(cabinet.groups, []);
});

test("PIMS ignores not-applicable materials and keeps spreadsheet text as text", () => {
  const table = diningTable();
  table.product_specs.fields.push(field("frame_wood_type", "N/A"));
  table.product_specs.fields.find((entry) => entry.key === "article_name").value_text = "=1+1";
  const book = XLSX.read(buildPimsWorkbook([table]), { type: "buffer" });
  assert.equal(book.Sheets.PIMS.B2.t, "s");
  assert.equal(book.Sheets.PIMS.B2.f, undefined);
  assert.equal(book.Sheets.PIMS.E2.v, "Oak, Steel");
});
