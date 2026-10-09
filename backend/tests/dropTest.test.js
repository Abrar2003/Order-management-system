const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DROP_TEST_STAGES,
  buildRequirementStatus,
  getDropHeights,
  hasAllDropStages,
  isAllowedDropMedia,
  requiresClaimTest,
} = require("../helpers/dropTest");
const { deriveOrderStatus } = require("../helpers/orderStatus");

test("Drop Test uses a strict claim threshold and the last height band above 91 kg", () => {
  assert.equal(requiresClaimTest(3), false);
  assert.equal(requiresClaimTest(3.01), true);
  assert.deepEqual(getDropHeights(18), { drops_1_to_5_mm: 305, drop_6_mm: 460 });
  assert.deepEqual(getDropHeights(91), { drops_1_to_5_mm: 180, drop_6_mm: 230 });
  assert.deepEqual(getDropHeights(92), { drops_1_to_5_mm: 180, drop_6_mm: 230 });
});

test("a run from an earlier request cannot satisfy the current Drop Test", () => {
  const status = buildRequirementStatus({
    claimPercentage: 4,
    activeTests: [{ _id: "drop-test", version: "1" }],
    qc: {
      _id: "qc-1",
      request_history: [
        { _id: "old", request_date: "2026-01-01" },
        { _id: "current", request_date: "2026-02-01" },
      ],
      test_runs: [{ test: "drop-test", test_version: "1", request_key: "history:old" }],
    },
  });

  assert.equal(DROP_TEST_STAGES.length, 6);
  assert.deepEqual(status.missing_test_ids, ["drop-test"]);
});

test("Drop Test requires all six stages and allows only the specified optional evidence", () => {
  const stages = DROP_TEST_STAGES.map((stage) => stage.id);
  assert.equal(hasAllDropStages(stages), true);
  assert.equal(hasAllDropStages(stages.slice(0, -1)), false);
  assert.equal(hasAllDropStages([...stages.slice(0, -1), "unknown"]), false);

  const image = { originalname: "proof.png", mimetype: "image/png" };
  const video = { originalname: "proof.mp4", mimetype: "video/mp4" };
  assert.equal(isAllowedDropMedia(Array(10).fill(image), "image"), true);
  assert.equal(isAllowedDropMedia(Array(11).fill(image), "image"), false);
  assert.equal(isAllowedDropMedia(Array(2).fill(video), "video"), true);
  assert.equal(isAllowedDropMedia(Array(3).fill(video), "video"), false);
  assert.equal(isAllowedDropMedia([{ originalname: "proof.pdf", mimetype: "application/pdf" }], "image"), false);
});

test("a failed completed test releases the shared QC completion gate", () => {
  const requirement = buildRequirementStatus({
    claimPercentage: 4,
    activeTests: [{ _id: "drop-test", version: "1" }],
    qc: {
      request_history: [{ _id: "current", request_date: "2026-02-01" }],
      test_runs: [{ test: "drop-test", test_version: "1", request_key: "history:current", result: "fail" }],
    },
  });
  assert.deepEqual(requirement.missing_test_ids, []);

  const order = { quantity: 10, shipment: [] };
  assert.equal(deriveOrderStatus({ orderEntry: order, qcRecord: { quantities: { qc_passed: 10 }, test_requirement_pending: true } }), "Under Inspection");
  assert.equal(deriveOrderStatus({ orderEntry: order, qcRecord: { quantities: { qc_passed: 10 } } }), "Inspection Done");
});
