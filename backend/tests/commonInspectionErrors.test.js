const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateCommonInspectionErrors,
} = require("../helpers/commonInspectionErrors");

const buildInspection = (overrides = {}) => ({
  inspected_item_sizes: [
    { remark: "item", H: 100, net_weight: 2 },
    { remark: "top", H: 20 },
    { remark: "base", H: 70 },
    { remark: "pedestal", H: 10 },
  ],
  inspected_box_sizes: [
    {
      remark: "inner",
      box_type: "inner",
      item_count_in_inner: 4,
    },
    {
      remark: "master",
      box_type: "master",
      box_count_in_master: 3,
      gross_weight: 30,
    },
  ],
  ...overrides,
});

test("reports weight error when calculated net weight equals master gross weight", () => {
  const result = evaluateCommonInspectionErrors(buildInspection({
    inspected_box_sizes: [
      { remark: "inner", item_count_in_inner: 5 },
      { remark: "master", box_count_in_master: 3, gross_weight: 30 },
    ],
  }));

  assert.equal(result.errors.some((error) => error.type === "weight"), true);
});

test("does not report weight error when calculated net weight is below gross weight", () => {
  const result = evaluateCommonInspectionErrors(buildInspection());

  assert.equal(result.errors.some((error) => error.type === "weight"), false);
});

test("accepts top plus base plus pedestal equal to item height", () => {
  const result = evaluateCommonInspectionErrors(buildInspection());

  assert.equal(result.errors.some((error) => error.type === "height"), false);
});

test("accepts combined component height greater than item height", () => {
  const result = evaluateCommonInspectionErrors(buildInspection({
    inspected_item_sizes: [
      { remark: "item", H: 100, net_weight: 2 },
      { remark: "top", H: 30 },
      { remark: "base", H: 70 },
      { remark: "pedestal", H: 10 },
    ],
  }));

  assert.equal(result.errors.some((error) => error.type === "height"), false);
});

test("reports component height difference and treats pedestal as optional", () => {
  const result = evaluateCommonInspectionErrors(buildInspection({
    inspected_item_sizes: [
      { remark: "item", H: 100, net_weight: 2 },
      { remark: "top", H: 20 },
      { remark: "base", H: 70 },
    ],
  }));
  const heightError = result.errors.find((error) => error.type === "height");

  assert.equal(heightError?.actual, 90);
  assert.equal(heightError?.expected, 100);
  assert.equal(heightError?.difference, -10);
});

test("adds stretcher net weight to common weight calculation", () => {
  const result = evaluateCommonInspectionErrors(buildInspection({
    inspected_item_sizes: [
      { remark: "item", H: 100, net_weight: 2 },
      { remark: "stretcher", H: 10, net_weight: 1 },
      { remark: "top", H: 20 },
      { remark: "base", H: 80 },
    ],
    inspected_box_sizes: [
      { remark: "inner", item_count_in_inner: 4 },
      { remark: "master", box_count_in_master: 3, gross_weight: 30 },
    ],
  }));
  const weightError = result.errors.find((error) => error.type === "weight");

  assert.equal(weightError?.actual, 36);
  assert.equal(weightError?.details?.net_weight, 3);
  assert.equal(weightError?.details?.stretcher_net_weight, 1);
});

test("ignores stretcher height in common height calculation", () => {
  const result = evaluateCommonInspectionErrors(buildInspection({
    inspected_item_sizes: [
      { remark: "item", H: 100, net_weight: 2 },
      { remark: "top", H: 20 },
      { remark: "base", H: 70 },
      { remark: "stretcher", H: 10, net_weight: 1 },
    ],
  }));
  const heightError = result.errors.find((error) => error.type === "height");

  assert.equal(heightError?.actual, 90);
  assert.equal(heightError?.details?.stretcher_height, undefined);
});

test("stretcher height does not create a height error when top and base are enough", () => {
  const result = evaluateCommonInspectionErrors(buildInspection({
    inspected_item_sizes: [
      { remark: "item", H: 100, net_weight: 2 },
      { remark: "top", H: 30 },
      { remark: "base", H: 70 },
      { remark: "stretcher", H: 500, net_weight: 1 },
    ],
  }));

  assert.equal(result.errors.some((error) => error.type === "height"), false);
});

test("skips a rule when required inputs are missing", () => {
  const result = evaluateCommonInspectionErrors({
    inspected_item_sizes: [{ remark: "item", H: 100 }],
    inspected_box_sizes: [],
  });

  assert.deepEqual(result.errors, []);
});
