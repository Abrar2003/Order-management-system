const test = require("node:test");
const assert = require("node:assert/strict");

const Sample = require("../models/sample.model");
const SampleWorkflow = require("../models/sampleWorkflow.model");

const buildItemSizes = () => [
  { remark: "item", L: 10, B: 20, H: 30, net_weight: 1 },
  { remark: "top", L: 11, B: 21, H: 31, net_weight: 2 },
  { remark: "base", L: 12, B: 22, H: 32, net_weight: 3 },
  { remark: "pedestal", L: 13, B: 23, H: 33, net_weight: 4 },
  { remark: "stretcher", L: 14, B: 24, H: 34, net_weight: 5 },
];

test("Sample item sizes accept Stretcher and five item entries", () => {
  const sample = new Sample({
    code: "STRETCHER-SAMPLE-1",
    item_sizes: buildItemSizes(),
  });

  assert.equal(sample.validateSync(), undefined);
});

test("Sample Workflow item sizes accept Stretcher and five item entries", () => {
  const sampleWorkflow = new SampleWorkflow({
    code: "STRETCHER-WORKFLOW-1",
    item_sizes: buildItemSizes(),
  });

  assert.equal(sampleWorkflow.validateSync(), undefined);
});
