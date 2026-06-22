const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const mongoose = require("mongoose");
const {
  BOX_ENTRY_TYPES,
  BOX_PACKAGING_MODES,
} = require("../helpers/boxMeasurement");
const {
  normalizeHeader,
  parseNumericValue,
  parsePisWorkbook,
} = require("../helpers/pisExcelParser");
const {
  createParseAndSyncPisUpload,
} = require("../middlewares/parseAndSyncPisUpload.middleware");

const buildFixtureWorkbook = ({
  articleNumber = "260484",
  includeArticleNumber = true,
} = {}) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Wall_deco");

  sheet.getCell("F4").value = "article number";
  if (includeArticleNumber) sheet.getCell("J4").value = articleNumber;
  sheet.getCell("F9").value = "Barcode Master box";
  sheet.getCell("I9").value = "8721274914153";
  sheet.getCell("F10").value = "Barcode pcs";
  sheet.getCell("I10").value = "8721274914092";

  const headers = [
    ["A40", "Dimension in cm"],
    ["D40", "Length"],
    ["F40", "Width"],
    ["H40", "Depth"],
    ["J40", "Height"],
    ["L40", "Thickness"],
    ["N40", "Netto Weight (KG)"],
    ["P40", "Gross Weight (KG)"],
    ["T40", "Quantities in box"],
  ];
  headers.forEach(([address, value]) => {
    sheet.getCell(address).value = value;
  });

  [
    [41, "Item", 60, 21, 4, 2.36, 3.45, 1],
    [45, "Inner Carton", 62, 22, 5, 2.36, 3.45, 1],
    [46, "Outer Carton", 65, 24, 10, 4.72, 6.5, 2],
  ].forEach(([row, label, L, B, H, net, gross, quantity]) => {
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 4).value = L;
    sheet.getCell(row, 6).value = B;
    sheet.getCell(row, 12).value = H;
    sheet.getCell(row, 14).value = net;
    sheet.getCell(row, 16).value = gross;
    sheet.getCell(row, 20).value = quantity;
  });

  return workbook;
};

const createResponse = () => ({
  statusCode: 200,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
});

const createFakeItem = (overrides = {}) => {
  const item = {
    _id: new mongoose.Types.ObjectId(),
    code: "260484",
    pis_master_barcode: "",
    pis_barcode: "",
    pis_inner_barcode: "",
    pis_item_sizes: [],
    pis_box_sizes: [],
    pis_box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
    update_history: [],
    saveCount: 0,
    markModified() {},
    toObject() {
      return {
        _id: this._id,
        code: this.code,
        pis_master_barcode: this.pis_master_barcode,
        pis_barcode: this.pis_barcode,
        pis_inner_barcode: this.pis_inner_barcode,
        pis_item_sizes: this.pis_item_sizes,
        pis_box_sizes: this.pis_box_sizes,
        pis_box_mode: this.pis_box_mode,
        update_history: this.update_history,
      };
    },
    async save() {
      this.saveCount += 1;
    },
    ...overrides,
  };
  return item;
};

test("normalizes headers and parses decimal/unit values", () => {
  assert.equal(normalizeHeader(" Netto\u00a0Weight\n(KG) "), "nettoweightkg");
  assert.equal(parseNumericValue("60"), 60);
  assert.equal(parseNumericValue("60,5"), 60.5);
  assert.equal(parseNumericValue("3.45 KG"), 3.45);
  assert.equal(parseNumericValue(""), null);
});

test("parses the supplied PIS layout into item, carton, and barcode fields", () => {
  const workbook = buildFixtureWorkbook();
  workbook.getWorksheet("Wall_deco").getCell("H41").value = 0;
  const parsed = parsePisWorkbook(workbook);

  assert.equal(parsed.articleNumber, "260484");
  assert.equal(parsed.sheetName, "Wall_deco");
  assert.equal(parsed.masterBarcode, "8721274914153");
  assert.equal(parsed.pcsBarcode, "8721274914092");
  assert.deepEqual(parsed.itemSizes, [{
    L: 60,
    B: 21,
    H: 4,
    net_weight: 2.36,
    gross_weight: 3.45,
    remark: "Item",
  }]);
  assert.deepEqual(parsed.boxSizes, [
    {
      L: 62,
      B: 22,
      H: 5,
      net_weight: 2.36,
      gross_weight: 3.45,
      remark: BOX_ENTRY_TYPES.INNER,
      box_type: BOX_ENTRY_TYPES.INNER,
      item_count_in_inner: 1,
      box_count_in_master: 0,
    },
    {
      L: 65,
      B: 24,
      H: 10,
      net_weight: 4.72,
      gross_weight: 6.5,
      remark: BOX_ENTRY_TYPES.MASTER,
      box_type: BOX_ENTRY_TYPES.MASTER,
      item_count_in_inner: 0,
      box_count_in_master: 2,
    },
  ]);
  assert.equal(parsed.boxMode, BOX_PACKAGING_MODES.CARTON);
});

test("missing article number fails before item lookup or save", async () => {
  let lookups = 0;
  const middleware = createParseAndSyncPisUpload({
    ItemModel: {
      async findOne() {
        lookups += 1;
        return null;
      },
    },
    parseUpload: async () => parsePisWorkbook(
      buildFixtureWorkbook({ includeArticleNumber: false }),
    ),
  });
  const response = createResponse();

  await middleware(
    { file: { originalname: "pis.xlsx", buffer: Buffer.from("test") }, params: {} },
    response,
    () => assert.fail("next must not be called"),
  );

  assert.equal(response.statusCode, 422);
  assert.equal(lookups, 0);
});

test("middleware replaces PIS data, saves aliases, and remains idempotent", async () => {
  const item = createFakeItem();
  const parsed = parsePisWorkbook(buildFixtureWorkbook());
  const middleware = createParseAndSyncPisUpload({
    ItemModel: { findOne: async () => item },
    parseUpload: async () => parsed,
  });
  const request = {
    file: { originalname: "pis.xlsx", buffer: Buffer.from("test") },
    params: { itemId: String(item._id) },
    originalUrl: `/items/${item._id}/pis-upload`,
    user: { _id: new mongoose.Types.ObjectId(), name: "Admin", role: "admin" },
  };

  let nextCalls = 0;
  await middleware(request, createResponse(), () => {
    nextCalls += 1;
  });
  assert.equal(item.pis_master_barcode, "8721274914153");
  assert.equal(item.pis_barcode, "8721274914153");
  assert.equal(item.pis_inner_barcode, "8721274914092");
  assert.equal(item.pis_item_sizes.length, 1);
  assert.equal(item.pis_box_sizes.length, 2);
  assert.equal(item.update_history.length, 1);
  assert.equal(item.update_history[0].action, "pis_file_import");

  await middleware(request, createResponse(), () => {
    nextCalls += 1;
  });
  assert.equal(item.pis_item_sizes.length, 1);
  assert.equal(item.pis_box_sizes.length, 2);
  assert.equal(item.update_history.length, 1);
  assert.deepEqual(request.pisImportResult.updated_fields, []);
  assert.equal(nextCalls, 2);
});

test("route item/article mismatch returns 409 without saving", async () => {
  const item = createFakeItem({ code: "DIFFERENT" });
  const middleware = createParseAndSyncPisUpload({
    ItemModel: { findOne: async () => item },
    parseUpload: async () => parsePisWorkbook(buildFixtureWorkbook()),
  });
  const response = createResponse();

  await middleware(
    {
      file: { originalname: "pis.xlsx", buffer: Buffer.from("test") },
      params: { itemId: String(item._id) },
      user: {},
    },
    response,
    () => assert.fail("next must not be called"),
  );

  assert.equal(response.statusCode, 409);
  assert.equal(item.saveCount, 0);
  assert.equal(item.update_history.length, 0);
});
