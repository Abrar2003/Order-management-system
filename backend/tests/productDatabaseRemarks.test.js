const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProductDatabaseCompletion,
  buildProductDatabaseCompletionRangeSummary,
  buildProductDatabaseCompletionSummary,
  buildProductDatabaseRow,
  getProductDatabaseMaterialOptions,
  getProductDatabaseCompletionRange,
  normalizeProductDatabaseInput,
  applyProductDatabaseBarcodeDefaults,
  applyProductDatabaseApprove,
  applyProductDatabaseCheck,
  applyProductDatabaseSave,
  assertProductDatabaseBarcodes,
} = require("../helpers/productDatabase");

test("Product Database rows expose shared switches and type fields", () => {
  const row = buildProductDatabaseRow({
    kd: true,
    mounting_file_needed: true,
    product_type: { key: "cabinet", label: "Cabinet" },
    product_specs: {
      fields: [{ key: "sub_product_type", value_text: "TV Cabinet" }],
    },
  });

  assert.equal(row.kd, true);
  assert.equal(row.mounting_file_needed, true);
  assert.equal(row.product_type_label, "Cabinet");
  assert.equal(row.sub_product_type, "TV Cabinet");
});

test("Product Database accepts Base 2, Pedestal, and Stretcher item-size remarks", () => {
  const result = normalizeProductDatabaseInput({
    pd_item_sizes: [
      { remark: "base2", L: 10, B: 20, H: 30, net_weight: 1 },
      { remark: "pedestal", L: 11, B: 21, H: 31, net_weight: 2 },
      { remark: "stretcher", L: 12, B: 22, H: 32, net_weight: 3 },
    ],
  });

  assert.deepEqual(
    result.data.pd_item_sizes.map((entry) => entry.remark),
    ["base2", "pedestal", "stretcher"],
  );
});

test("Product Database accepts five item-size entries", () => {
  const result = normalizeProductDatabaseInput({
    pd_item_sizes: [
      { remark: "item", L: 10, B: 20, H: 30, net_weight: 1 },
      { remark: "top", L: 11, B: 21, H: 31, net_weight: 2 },
      { remark: "base", L: 12, B: 22, H: 32, net_weight: 3 },
      { remark: "pedestal", L: 13, B: 23, H: 33, net_weight: 4 },
      { remark: "stretcher", L: 14, B: 24, H: 34, net_weight: 5 },
    ],
  });

  assert.equal(result.data.pd_item_sizes.length, 5);
});

test("Product Database rejects blank writes and requires mode-specific barcodes", () => {
  assert.throws(
    () => normalizeProductDatabaseInput({ pd_inner_barcode: "" }),
    /Barcode fields cannot be blank/,
  );
  assert.throws(
    () => assertProductDatabaseBarcodes({ pd_box_mode: "individual" }),
    /Product Database barcode is required/,
  );
  assert.throws(
    () => assertProductDatabaseBarcodes({ pd_box_mode: "individual_master" }),
    /master barcode is required/,
  );
  assert.throws(
    () => assertProductDatabaseBarcodes({ pd_box_mode: "carton", pd_master_barcode: "123" }),
    /inner barcode is required/,
  );
  assert.throws(
    () => assertProductDatabaseBarcodes(
      { pd_box_mode: "individual_master", pd_master_barcode: "123" },
    ),
    /inner barcode is required/,
  );
  assert.throws(
    () => assertProductDatabaseBarcodes(
      {
        pd_box_mode: "individual_master",
        pd_master_barcode: "123",
        pd_inner_barcode: "456",
      },
      { pis_master_barcode: "123" },
    ),
    /PIS inner barcode is required/,
  );
  assert.throws(
    () => assertProductDatabaseBarcodes(
      { pd_box_mode: "individual_master", pd_master_barcode: "123" },
      {},
    ),
    /PIS master barcode is required/,
  );
});

test("Product Database admin override accepts intentionally blank barcodes", () => {
  const input = normalizeProductDatabaseInput(
    { pd_barcode: "", pd_inner_barcode: "" },
    { allowBlankBarcodes: true },
  );

  assert.deepEqual(input.data, {
    pd_barcode: "",
    pd_master_barcode: "",
    pd_inner_barcode: "",
  });
  assert.doesNotThrow(() =>
    assertProductDatabaseBarcodes(
      { pd_box_mode: "carton", ...input.data },
      {},
      { allowMissingRequiredFields: true },
    ),
  );

  const buildItem = () => ({
    pd_checked: "created",
    pd_box_mode: "individual",
    pd_barcode: "123",
    pd_master_barcode: "123",
    pd_history: [],
  });
  assert.throws(
    () =>
      applyProductDatabaseSave({
        item: buildItem(),
        payload: { admin_override_required_fields: true, pd_barcode: "" },
        user: { role: "manager" },
      }),
    /Only Admin or Super Admin/,
  );

  const item = buildItem();
  applyProductDatabaseSave({
    item,
    payload: { admin_override_required_fields: true, pd_barcode: "" },
    user: { role: "admin" },
  });
  assert.equal(item.pd_barcode, "");
});

test("Product Database does not require barcodes for barcode-exempt items", () => {
  const item = {
    barcode_exempted: true,
    pd_checked: "",
    pd_box_mode: "individual_master",
    pd_history: [],
  };

  assert.doesNotThrow(() =>
    assertProductDatabaseBarcodes({ pd_box_mode: "individual_master" }, item),
  );

  applyProductDatabaseSave({
    item,
    payload: { kd: true },
    user: { id: "creator", role: "manager" },
  });
  item.pd_checked = "checked";
  applyProductDatabaseApprove({
    item,
    user: { id: "approver", role: "admin" },
  });

  assert.equal(item.pd_checked, "approved");
});

test("Product Database lets every manager type check unless they last changed it", () => {
  const buildItem = () => ({
    pd_checked: "created",
    pd_box_mode: "individual",
    pd_barcode: "123",
    pd_master_barcode: "123",
    pis_barcode: "123",
    pd_created_by: { user: "creator" },
    pd_last_changed_by: { user: "updater" },
    pd_history: [],
  });

  ["manager", "product manager", "inspection manager"].forEach((role) => {
    const item = buildItem();
    applyProductDatabaseCheck({
      item,
      user: { id: "creator", role },
    });
    assert.equal(item.pd_checked, "checked");
  });
  assert.throws(
    () => applyProductDatabaseCheck({ item: buildItem(), user: { id: "updater", role: "manager" } }),
    /last changed/,
  );
  assert.throws(
    () => applyProductDatabaseCheck({ item: buildItem(), user: { id: "admin", role: "admin" } }),
    /Only managers/,
  );
  assert.throws(
    () => applyProductDatabaseApprove({ item: buildItem(), user: { id: "manager", role: "manager" } }),
    /Only admin/,
  );
});

test("Product Database check ignores legacy raw duplicates but preserves unknown raw changes", () => {
  const buildItem = () => ({
    pd_checked: "created",
    pd_box_mode: "individual",
    pis_barcode: "123",
    pd_last_changed_by: { user: "updater" },
    pd_history: [],
    product_specs: {
      fields: [
        {
          key: "quantity",
          input_type: "number",
          value_type: "number",
          value_number: 2,
          raw_value: "2",
          source_header: "Quantity",
        },
        {
          key: "description",
          input_type: "text",
          value_type: "string",
          value_text: "Name",
          raw_value: "Name ",
          source_header: "Description",
        },
      ],
      raw_values: { quantity: "2", description: "Name ", identifier: "001" },
    },
  });
  const buildPayload = (identifier = "001") => ({
    pd_box_mode: "individual",
    pd_barcode: "123",
    product_specs: {
      fields: [
        {
          key: "quantity",
          input_type: "number",
          value_type: "number",
          value_number: 2,
          raw_value: 2,
        },
        {
          key: "description",
          input_type: "text",
          value_type: "string",
          value_text: "Name",
          raw_value: "Name",
        },
      ],
      box_mode: "individual",
      raw_values: { quantity: 2, description: "Name", identifier },
    },
  });

  const unchangedItem = buildItem();
  const unchanged = applyProductDatabaseCheck({
    item: unchangedItem,
    payload: buildPayload(),
    user: { id: "checker", role: "inspection manager" },
  });
  assert.deepEqual(
    { changed: unchanged.changed, checked: unchanged.checked, status: unchanged.status },
    { changed: false, checked: true, status: "checked" },
  );

  const changedItem = buildItem();
  const changed = applyProductDatabaseCheck({
    item: changedItem,
    payload: buildPayload("1"),
    user: { id: "checker", role: "inspection manager" },
  });
  assert.deepEqual(
    { changed: changed.changed, checked: changed.checked, status: changed.status },
    { changed: true, checked: false, status: "created" },
  );
});

test("Product Database defaults required barcodes from PIS", () => {
  assert.deepEqual(
    applyProductDatabaseBarcodeDefaults(
      { pd_box_mode: "carton" },
      { pis_master_barcode: "123", pis_inner_barcode: "456" },
    ),
    {
      pd_box_mode: "carton",
      pd_barcode: "123",
      pd_master_barcode: "123",
      pd_inner_barcode: "456",
    },
  );
  assert.deepEqual(
    applyProductDatabaseBarcodeDefaults(
      { pd_box_mode: "individual_master" },
      { pis_master_barcode: "123", pis_inner_barcode: "456" },
    ),
    {
      pd_box_mode: "individual_master",
      pd_barcode: "123",
      pd_master_barcode: "123",
      pd_inner_barcode: "456",
    },
  );
});

test("Product Database completion counts unset booleans as false", () => {
  const templateFields = [
    { key: "item_number", input_type: "text", value_type: "string" },
    { key: "description", input_type: "textarea", value_type: "string" },
    { key: "dropship", input_type: "boolean", value_type: "boolean" },
    { key: "article_size", input_type: "item_size", value_type: "array", size_remark: "article" },
  ];
  const items = [
    {
      product_specs: {
        fields: [
          { key: "item_number", value_type: "string", value_text: "T-1" },
          { key: "description", value_type: "string", value_text: "Dining table" },
          { key: "dropship", value_type: "boolean", value_boolean: false },
        ],
        item_sizes: [{ remark: "article", L: 120, B: 80, H: 76 }],
      },
    },
    {
      product_specs: {
        fields: [
          { key: "item_number", value_type: "string", value_text: "T-2" },
          { key: "description", value_type: "string", value_text: "Coffee table" },
        ],
      },
    },
    {
      product_specs: {
        fields: [
          { key: "item_number", value_type: "string", value_text: "T-3" },
        ],
      },
    },
  ].map((item) => ({
    ...item,
    pd_completion: buildProductDatabaseCompletion(item, templateFields),
  }));

  assert.deepEqual(
    items.map((item) => item.pd_completion),
    [
      { filled: 4, total: 4, percentage: 100, bucket: 100 },
      { filled: 3, total: 4, percentage: 75, bucket: 75 },
      { filled: 2, total: 4, percentage: 50, bucket: 50 },
    ],
  );

  assert.deepEqual(
    buildProductDatabaseCompletionSummary(items, templateFields).buckets,
    { 25: 0, 50: 1, 75: 1, 100: 1 },
  );
});

test("Product Database material options reuse saved material values", () => {
  assert.deepEqual(
    getProductDatabaseMaterialOptions([
      {
        product_specs: {
          fields: [
            { key: "material_top", value_text: "Oak" },
            { key: "material_leg", value_text: "Steel" },
            { key: "top_color", value_text: "Walnut" },
          ],
        },
      },
      {
        product_specs: {
          fields: [{ key: "material_1", value_text: "oak" }],
        },
      },
    ]),
    ["Oak", "Steel"],
  );
});

test("Product Database completion range buckets use Item Database ranges", () => {
  assert.equal(getProductDatabaseCompletionRange(0), "0-25");
  assert.equal(getProductDatabaseCompletionRange(25), "0-25");
  assert.equal(getProductDatabaseCompletionRange(26), "26-50");
  assert.equal(getProductDatabaseCompletionRange(50), "26-50");
  assert.equal(getProductDatabaseCompletionRange(51), "51-75");
  assert.equal(getProductDatabaseCompletionRange(75), "51-75");
  assert.equal(getProductDatabaseCompletionRange(76), "76-100");
  assert.equal(getProductDatabaseCompletionRange(100), "76-100");

  const summary = buildProductDatabaseCompletionRangeSummary([
    { pd_completion: { percentage: 0 } },
    { pd_completion: { percentage: 25 } },
    { pd_completion: { percentage: 26 } },
    { pd_completion: { percentage: 51 } },
    { pd_completion: { percentage: 76 } },
  ]);

  assert.deepEqual(summary.buckets, {
    "0-25": 2,
    "26-50": 1,
    "51-75": 1,
    "76-100": 1,
  });
});
