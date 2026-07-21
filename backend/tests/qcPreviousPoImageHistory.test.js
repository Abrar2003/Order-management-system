const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: { selectPreviousPoImageHistory },
} = require("../controllers/qc.controller");

const referenceTime = Date.parse("2026-07-21T00:00:00.000Z");

const qcRecord = (id, orderId, lastInspectedDate, images = {}) => ({
  _id: id,
  order: orderId,
  order_meta: { order_id: orderId },
  last_inspected_date: lastInspectedDate,
  ...images,
});

const inspectionRecord = (id, qc, inspectionDate, images = {}) => ({
  _id: id,
  qc,
  inspection_date: inspectionDate,
  ...images,
});

const selectHistory = (qcRecords, inspectionRecords) =>
  selectPreviousPoImageHistory({
    qcRecords,
    inspectionRecords,
    referenceTime,
  });

test("prefers every recent Inspection-model image owner over QC-model images", () => {
  const qcRecords = [
    qcRecord("qc-1", "po-1", "2026-07-01", {
      qc_images: [{ key: "qc-record.webp" }],
    }),
    qcRecord("qc-2", "po-2", "2026-06-01"),
  ];
  const history = selectHistory(qcRecords, [
    inspectionRecord("inspection-1", "qc-1", "2026-06-20", {
      qc_images: [{ key: "inspection.webp" }],
    }),
    inspectionRecord("inspection-2", "qc-2", "2026-06-10", {
      rejected_image: { key: "rejected.webp" },
    }),
  ]);

  assert.deepEqual(
    history.map((entry) => entry.inspection_record?._id),
    ["inspection-1", "inspection-2"],
  );
  assert.ok(history.every((entry) => entry.history_source === "inspection"));
});

test("uses recent QC-model images only when recent inspections have no images", () => {
  const history = selectHistory(
    [
      qcRecord("qc-1", "po-1", "2026-07-01", {
        hardware_inspection: [{ key: "hardware.webp" }],
      }),
      qcRecord("qc-2", "po-2", "2026-06-01", {
        rejected_image: { key: "rejected.webp" },
      }),
    ],
    [inspectionRecord("inspection-empty", "qc-1", "2026-06-20")],
  );

  assert.deepEqual(
    history.map((entry) => entry.qc_record?._id),
    ["qc-1", "qc-2"],
  );
  assert.ok(history.every((entry) => entry.history_source === "qc"));
});

test("falls back to all image-bearing inspections from the latest older PO", () => {
  const qcRecords = [
    qcRecord("qc-1", "po-latest", "2026-04-20"),
    qcRecord("qc-2", "po-older", "2026-03-20"),
  ];
  const history = selectHistory(qcRecords, [
    inspectionRecord("inspection-1", "qc-1", "2026-04-20", {
      qc_images: [{ key: "latest-1.webp" }],
    }),
    inspectionRecord("inspection-2", "qc-1", "2026-04-10", {
      rejected_image: { key: "latest-2.webp" },
    }),
    inspectionRecord("inspection-3", "qc-2", "2026-03-20", {
      qc_images: [{ key: "older.webp" }],
    }),
  ]);

  assert.deepEqual(
    history.map((entry) => entry.inspection_record?._id),
    ["inspection-1", "inspection-2"],
  );
});

test("falls back to QC-model images from the latest older PO", () => {
  const history = selectHistory(
    [
      qcRecord("qc-1", "po-latest", "2026-04-20", {
        qc_images: [{ key: "latest.webp" }],
      }),
      qcRecord("qc-2", "po-older", "2026-03-20", {
        qc_images: [{ key: "older.webp" }],
      }),
    ],
    [],
  );

  assert.deepEqual(history.map((entry) => entry.qc_record?._id), ["qc-1"]);
  assert.equal(history[0]?.history_source, "qc");
});

test("includes the 60-day cutoff, excludes later records, and returns empty without images", () => {
  const cutoffRecord = inspectionRecord("cutoff", "qc-1", "", {
    createdAt: new Date(referenceTime - 60 * 24 * 60 * 60 * 1000),
    goods_not_ready_images: [{ key: "cutoff.webp" }],
  });
  const laterRecord = inspectionRecord("later", "qc-1", "2026-07-22", {
    qc_images: [{ key: "later.webp" }],
  });

  assert.deepEqual(
    selectHistory(
      [qcRecord("qc-1", "po-1", "2026-05-01")],
      [cutoffRecord, laterRecord],
    ).map((entry) => entry.inspection_record?._id),
    ["cutoff"],
  );
  assert.deepEqual(
    selectHistory([qcRecord("qc-empty", "po-empty", "2026-07-01")], []),
    [],
  );
});
