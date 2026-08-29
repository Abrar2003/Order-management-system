const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Inspection = require("../models/inspection.model");
const {
  _private: { processOrderAnalyticsRow },
} = require("../controllers/product.controller");

const {
  __test__: {
    calculateQcAggregateMetrics,
    getInspectionQuantityError,
    getRejectionEvidenceError,
  },
} = require("../controllers/qc.controller");

const image = (index, comment = "Rejected finish") => ({
  key: `rejections/${index}.jpg`,
  comment,
});

test("rejected inspection quantities require 2-10 images with rejection remarks", () => {
  assert.equal(
    getRejectionEvidenceError({ rejected: 0 }),
    "",
  );
  assert.match(
    getRejectionEvidenceError({
      rejected: 1,
      inspection: { rejected_images: [image(1)] },
    }),
    /At least 2 rejection images/,
  );
  assert.equal(
    getRejectionEvidenceError({
      rejected: 1,
      inspection: { rejected_images: [image(1), image(2)] },
    }),
    "",
  );
  assert.match(
    getRejectionEvidenceError({
      rejected: 1,
      inspection: { rejected_images: [image(1), image(2, "")] },
    }),
    /rejection remark is required/,
  );
  assert.match(
    getRejectionEvidenceError({
      rejected: 1,
      inspection: {
        rejected_images: Array.from({ length: 11 }, (_, index) => image(index)),
      },
    }),
    /up to 10 rejection images/,
  );
});

test("manual inspection quantities enforce whole pieces and allow unclassified checked pieces", () => {
  assert.equal(
    getInspectionQuantityError({ checked: 10, passed: 7, rejected: 2, offered: 10 }),
    "",
  );
  assert.equal(
    getInspectionQuantityError({ checked: 10, passed: 7, rejected: 3, offered: 10 }),
    "",
  );
  assert.match(
    getInspectionQuantityError({ checked: 10, passed: 7, rejected: 4, offered: 10 }),
    /cannot exceed checked/,
  );
  assert.match(
    getInspectionQuantityError({ checked: 11, passed: 7, rejected: 2, offered: 10 }),
    /cannot exceed offered/,
  );
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.match(
      getInspectionQuantityError({ checked: 10, passed: 7, rejected: value, offered: 10 }),
      /non-negative whole number/,
    );
  }
});

test("QC aggregate sums stored rejected values and ignores transferred records", () => {
  const result = calculateQcAggregateMetrics(
    { request_type: "FULL", request_history: [] },
    [
      { checked: 10, passed: 7, rejected: 2, vendor_offered: 10, status: "Inspection Done" },
      { checked: 4, passed: 1, rejected: 3, vendor_offered: 4, status: "transferred" },
      { checked: 5, passed: 5, vendor_offered: 5, status: "Inspection Done" },
    ],
  );

  assert.equal(result.totalRejected, 2);
});

test("product analytics uses manual rejection instead of unchecked quantity", () => {
  const result = processOrderAnalyticsRow({
    quantity: 10,
    inspections: [
      {
        inspection_date: "2026-08-27",
        checked: 10,
        passed: 7,
        rejected: 2,
      },
    ],
  });

  assert.equal(result.rejectionPercent, 20);
});

test("inspection schema stores manual rejected quantity, defaults old values to zero, and caps images", async () => {
  const record = new Inspection({
    qc: new mongoose.Types.ObjectId(),
    inspector: new mongoose.Types.ObjectId(),
    inspection_date: "2026-08-27",
    requested_date: "2026-08-27",
    vendor_requested: 10,
    vendor_offered: 10,
    checked: 8,
    passed: 5,
    rejected: 2,
    pending_after: 5,
    createdBy: new mongoose.Types.ObjectId(),
  });

  await record.validate();
  assert.equal(record.rejected, 2);

  const legacyRecord = new Inspection({
    qc: new mongoose.Types.ObjectId(),
    inspector: new mongoose.Types.ObjectId(),
    inspection_date: "2026-08-27",
    requested_date: "2026-08-27",
    vendor_requested: 10,
    vendor_offered: 10,
    checked: 8,
    passed: 5,
    pending_after: 5,
    createdBy: new mongoose.Types.ObjectId(),
  });
  await legacyRecord.validate();
  assert.equal(legacyRecord.rejected, 0);

  record.rejected = 1.5;
  await assert.rejects(record.validate(), /rejected must be a whole number/);
  record.rejected = 4;
  await assert.rejects(record.validate(), /passed and rejected cannot exceed checked/);
  record.rejected = 2;

  record.rejected_images = Array.from({ length: 11 }, (_, index) => image(index));
  await assert.rejects(record.validate(), /rejected_images cannot exceed 10 images/);
});
