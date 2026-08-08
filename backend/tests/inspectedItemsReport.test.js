const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: {
    buildInspectedItemsReportRow,
    buildInspectedItemsVendorDetails,
    buildInspectedItemsSummary,
    buildOrderItemReportGroups,
    matchesInspectedItemsDateRange,
    matchesInspectedItemsReportFilters,
    mergeInspectedItemsSources,
  },
} = require("../controllers/reports.controller");

const order = ({
  code,
  description = "",
  brand = "Brand A",
  vendor = "Vendor A",
  lastInspectedDate = "",
  checked = 0,
  status = "Pending",
} = {}) => ({
  item: { item_code: code, description },
  brand,
  vendor,
  status,
  qc_record: {
    last_inspected_date: lastInspectedDate,
    quantities: { checked },
  },
});

test("inspected items merges case and whitespace variants into one master-backed item", () => {
  const rows = mergeInspectedItemsSources(
    [{
      _id: "master-1",
      code: " ITEM-1 ",
      description: "Master description",
      brand: "Master Brand",
      vendors: ["Master Vendor"],
    }],
    [
      order({
        code: "item-1",
        description: "Order description",
        brand: "Order Brand",
        vendor: "Order Vendor",
      }),
    ],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]._id, "master-1");
  assert.equal(rows[0].code, "ITEM-1");
  assert.equal(rows[0].description, "Master description");
  assert.deepEqual(rows[0].vendors, ["Master Vendor"]);
});

test("inspected items includes master-only and order-only items", () => {
  const rows = mergeInspectedItemsSources(
    [{ _id: "master-only", code: "MASTER-ONLY" }],
    [order({ code: "ORDER-ONLY", description: "From order" })],
  );

  assert.equal(rows.length, 2);
  const orderOnly = rows.find((row) => row.code === "ORDER-ONLY");
  assert.match(orderOnly._id, /^order:/);
  assert.equal(orderOnly.description, "From order");
  assert.deepEqual(orderOnly.vendors, ["Vendor A"]);
});

test("order-only rows have no document flags and never-inspected rows have no date", () => {
  const [source] = mergeInspectedItemsSources(
    [],
    [order({ code: "ORDER-ONLY" })],
  );
  const row = buildInspectedItemsReportRow(source);

  assert.equal(row.flags.inspected, false);
  assert.equal(row.flags.cad, false);
  assert.equal(row.flags.pis, false);
  assert.equal(row.flags.product_image, false);
  assert.equal(row.last_inspected_date, "");
});

test("order-only item inspection state uses QC records and latest date", () => {
  const groups = buildOrderItemReportGroups([
    order({ code: "ITEM-1", lastInspectedDate: "2026-01-10", checked: 1 }),
    order({ code: " item-1 ", lastInspectedDate: "2026-03-10" }),
  ]);
  const group = groups.get("item-1");

  assert.equal(group.inspected, true);
  assert.equal(group.last_inspected_date, "2026-03-10");
});

test("source and size snapshots alone do not mark an item inspected", () => {
  const row = buildInspectedItemsReportRow({
    _id: "item-1",
    code: "DL-2299",
    source: { from_qc: true },
    inspected_item_sizes: [{ L: 1, B: 1, H: 1 }],
    inspected_box_sizes: [{ L: 1, B: 1, H: 1 }],
    qc: { last_inspected_date: "", quantities: { checked: 0, passed: 0 } },
  });

  assert.equal(row.flags.inspected, false);
});

test("cancelled-only order items are excluded while archived non-cancelled shapes remain valid", () => {
  const groups = buildOrderItemReportGroups([
    order({ code: "CANCELLED", status: "Cancelled" }),
    {
      ...order({ code: "ARCHIVED", status: "Shipped" }),
      archived: true,
    },
  ]);

  assert.equal(groups.has("cancelled"), false);
  assert.equal(groups.has("archived"), true);
});

test("date-filtered views exclude never-inspected rows", () => {
  assert.equal(
    matchesInspectedItemsDateRange(
      { last_inspected_date: "" },
      {
        from_time: Date.parse("2026-01-01T00:00:00.000Z"),
        to_time: Date.parse("2026-12-31T00:00:00.000Z"),
      },
    ),
    false,
  );
});

test("merged report filters search, brand, vendor, and country values", () => {
  const row = buildInspectedItemsReportRow({
    code: "ITEM-42",
    description: "Wooden chair",
    brand: "Giga",
    brands: ["Giga"],
    vendors: ["Vendor One"],
    country_of_origin: "India",
  });

  assert.equal(
    matchesInspectedItemsReportFilters(row, {
      search: "chair",
      brand: "giga",
      vendor: "vendor one",
    }),
    true,
  );
  assert.equal(
    matchesInspectedItemsReportFilters(row, { vendor: "Other Vendor" }),
    false,
  );
  assert.equal(
    matchesInspectedItemsReportFilters(row, { country: "india" }),
    true,
  );
  assert.equal(
    matchesInspectedItemsReportFilters(row, { country: "China" }),
    false,
  );
});

test("inspected items include brand-matched vendor codes and contact details", () => {
  const vendorDetails = buildInspectedItemsVendorDetails(
    {
      brand: "Brand A",
      vendors: ["Vendor One"],
    },
    new Map([[
      "vendor one",
      {
        vendor_code: [
          { brand: "Brand A", code: "BA-001" },
          { brand: "Brand B", code: "BB-001" },
        ],
        contact_person: [
          {
            name: "Jane Doe",
            type: "merchant",
            email: "jane@example.com",
            phone: "+91 1234567890",
          },
        ],
      },
    ]]),
  );

  assert.deepEqual(vendorDetails, [{
    name: "Vendor One",
    code: "BA-001",
    contact_details: "Jane Doe | merchant | jane@example.com | +91 1234567890",
  }]);
});

test("satin label summary counts only items that require a label", () => {
  const uploaded = buildInspectedItemsReportRow({
    code: "SATIN-1",
    satin_label_required: true,
    satin_label: { key: "item-shipping-marks/satin-label.pdf" },
  });
  const notRequired = buildInspectedItemsReportRow({ code: "SATIN-2" });
  const summary = buildInspectedItemsSummary([uploaded, notRequired]);

  assert.deepEqual(summary.satin_label, {
    key: "satin_label",
    label: "Satin Label Uploaded",
    count: 1,
    total: 1,
  });
  assert.equal(notRequired.flags.satin_label, null);
});
