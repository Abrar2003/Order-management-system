const assert = require("node:assert/strict");
const test = require("node:test");

const {
  OPERATION_CONFIG,
  addIntentImagesToInspection,
  canManageIntent,
  resolveOperationConfig,
} = require("../services/qcImageUploadIntent.service");

const image = (id, comment = "Rejected finish") => ({
  _id: id,
  key: `qc-images/${id}/source/image.jpg`,
  comment,
  processing: { status: "queued" },
});

test("QC image upload intents retain the existing evidence limits", () => {
  assert.equal(resolveOperationConfig("rejection").maxImages, 10);
  assert.equal(resolveOperationConfig("goods_not_ready").imageType, "goods_not_ready_images");
  assert.equal(OPERATION_CONFIG.reject_all.maxImages, 1);
  assert.throws(() => resolveOperationConfig("other"), /Invalid QC image upload operation/);
});

test("a ready rejection intent appends evidence without replacing legacy evidence", () => {
  const inspection = { rejected_images: [image("stored")] };
  const intent = {
    operation: "rejection",
    image_type: "rejected_images",
    images: [image("new-1"), image("new-2")],
  };

  addIntentImagesToInspection({ intent, inspection });

  assert.deepEqual(
    inspection.rejected_images.map((entry) => entry._id),
    ["stored", "new-1", "new-2"],
  );
});

test("reject-all intents replace the new rejection-image array and remain owner protected", () => {
  const inspection = { rejected_images: [image("old-array")] };
  const intent = {
    operation: "reject_all",
    image_type: "rejected_images",
    images: [image("reject-all")],
    created_by: { user: "owner-1" },
  };

  addIntentImagesToInspection({ intent, inspection, replace: true });

  assert.deepEqual(inspection.rejected_images.map((entry) => entry._id), ["reject-all"]);
  assert.equal(canManageIntent(intent, { id: "owner-1", role: "QC" }), true);
  assert.equal(canManageIntent(intent, { id: "owner-2", role: "QC" }), false);
  assert.equal(canManageIntent(intent, { id: "owner-2", role: "Admin" }), true);
});
