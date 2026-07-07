const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: {
    buildDuplicateUploadSessionResponse,
    findImageByHash,
    normalizeImageContentHash,
  },
} = require("../services/qcImageDirectUpload.service");

const VALID_HASH = "a".repeat(64);

test("normalizes only valid sha256 QC image content hashes", () => {
  assert.equal(normalizeImageContentHash(VALID_HASH.toUpperCase()), VALID_HASH);
  assert.equal(normalizeImageContentHash(` ${VALID_HASH} `), VALID_HASH);
  assert.equal(normalizeImageContentHash("not-a-sha"), "");
  assert.equal(normalizeImageContentHash("b".repeat(63)), "");
});

test("finds QC images by stored content hash", () => {
  const qc = {
    qc_images: [
      { _id: "first", hash: "1".repeat(64) },
      { _id: "second", hash: VALID_HASH },
    ],
  };

  assert.equal(findImageByHash(qc, "qc_images", VALID_HASH)?._id, "second");
  assert.equal(findImageByHash(qc, "hardware_inspection", VALID_HASH), null);
  assert.equal(findImageByHash(qc, "qc_images", "invalid"), null);
});

test("builds a duplicate direct-upload response without an upload URL", () => {
  const response = buildDuplicateUploadSessionResponse({
    qc: { _id: "qc-1" },
    imageField: "qc_images",
    contentHash: VALID_HASH,
    image: {
      _id: "image-1",
      key: "qc-images/preview.webp",
      hash: VALID_HASH,
      contentType: "image/webp",
      processing: { status: "ready" },
    },
  });

  assert.equal(response.duplicate, true);
  assert.equal(response.already_completed, true);
  assert.equal(response.upload_url, "");
  assert.equal(response.content_hash, VALID_HASH);
  assert.equal(response.existing_image_id, "image-1");
});
