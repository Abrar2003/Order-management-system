const assert = require("node:assert/strict");
const test = require("node:test");

const { __test__ } = require("../controllers/item.controller");
const {
  buildItemMatch,
  buildFinalPisCheckAccessMatch,
  buildFinalPisCheckMatch,
} = __test__;

test("missing item country leaves the item query unfiltered", () => {
  assert.deepEqual(buildItemMatch(), {});
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

test("buildFinalPisCheckMatch builds expected filters and excludes rectify items", () => {
  const match = buildFinalPisCheckMatch({ country: "India" });
  assert.ok(match.$and);
  // conditions: pis_checked_flag, is_rectify_imported, size_or_barcode_exists, country_of_origin
  assert.equal(match.$and.length, 4);
  assert.deepEqual(match.$and[1], { is_rectify_imported: { $ne: true } });
  assert.deepEqual(match.$and[3], {
    country_of_origin: {
      $regex: "^India$",
      $options: "i",
    },
  });
});

test("buildFinalPisCheckMatch ignores country filter if country is 'all'", () => {
  const match = buildFinalPisCheckMatch({ country: "all" });
  assert.equal(match.$and.length, 3); // no country filter added
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
