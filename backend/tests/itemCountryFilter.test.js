const assert = require("node:assert/strict");
const test = require("node:test");

const { __test__ } = require("../controllers/item.controller");
const {
  buildItemMatch,
  buildFinalPisCheckAccessMatch,
  buildFinalPisCheckMatch,
  buildPisDiffMissingItemMasterMatch,
} = __test__;

test("missing item country leaves the item query unfiltered", () => {
  assert.deepEqual(buildItemMatch(), {});
});

test("item search matches every current barcode variant", () => {
  const match = buildItemMatch({ search: "871234" });
  const barcodeFields = [
    "pis_barcode",
    "pis_master_barcode",
    "pis_inner_barcode",
    "pis_logistics_ean",
    "pis_logistics_eans",
    "inspected_logistics_ean",
    "inspected_logistics_eans",
    "master_barcode",
    "master_master_barcode",
    "master_inner_barcode",
    "pd_barcode",
    "pd_master_barcode",
    "pd_inner_barcode",
    "qc.barcode",
    "qc.master_barcode",
    "qc.inner_barcode",
  ];

  barcodeFields.forEach((field) => {
    assert.deepEqual(match.$or.find((condition) => field in condition), {
      [field]: { $regex: "871234", $options: "i" },
    });
  });
});

test("item country filter matches country of origin case-insensitively", () => {
  assert.deepEqual(buildItemMatch({ country: " India " }), {
    country_of_origin: {
      $regex: "^India$",
      $options: "i",
    },
  });
});

test("all item countries leaves the item query unfiltered", () => {
  assert.deepEqual(buildItemMatch({ country: "all" }), {});
});

test("unspecified country keeps report drill-downs on items without a country", () => {
  assert.deepEqual(buildItemMatch({ country: "Unspecified" }), {
    $or: [
      { country_of_origin: { $exists: false } },
      { country_of_origin: null },
      { country_of_origin: { $regex: "^\\s*$" } },
    ],
  });
});

test("item country filter combines with existing filters", () => {
  const match = buildItemMatch({
    brand: "Brand A",
    vendor: "Vendor A",
    country: "India",
  });

  assert.equal(match.$and.length, 3);
  assert.deepEqual(match.$and[2], {
    country_of_origin: {
      $regex: "^India$",
      $options: "i",
    },
  });
});

test("Final PIS Check filters the current Master 1 stage and keeps the country filter", () => {
  const match = buildFinalPisCheckMatch({ country: "India" });
  assert.deepEqual(match.$and[0], buildItemMatch({ country: "India" }));
  assert.deepEqual(match.$and[1]["master_workflow.stage"], { $in: ["master_1"] });
  assert.doesNotMatch(JSON.stringify(match), /pis_checked_flag|is_rectify_imported/);
});
test("Final PIS Check ignores country when all is selected", () => {
  assert.deepEqual(buildFinalPisCheckMatch({ country: "all" }).$and[0], {});
});
test("PIS Diffs requeue legacy items regardless of existing masters or old flags", () => {
  const match = buildPisDiffMissingItemMasterMatch();
  assert.equal(match.$or[0]["master_workflow.cycle_version"].$ne, "2026-10-03");
  assert.equal(match.$or[1]["master_workflow.stage"], "awaiting_master_1");
  assert.doesNotMatch(JSON.stringify(match), /master_item_sizes|pis_checked_flag/);
});

test("Final PIS Check applies the user's brand and vendor access", () => {
  const match = buildFinalPisCheckAccessMatch({}, {
    allowed_brands: [{ _id: "69bcc477e6dcf6dd5be3c0d8", name: "Giga" }],
    allowed_vendors: ["Jodhana"],
  });
  const serialized = JSON.stringify(match);

  assert.match(serialized, /Giga/);
  assert.match(serialized, /Jodhana/);
  assert.doesNotMatch(serialized, /By Boo/);
});
