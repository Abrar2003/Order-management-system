const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const {
  buildQcThumbnailStorageKey,
  generateQcImageThumbnail,
} = require("../services/imageThumbnailService");

const createPngBuffer = ({ width, height }) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#9b7f5f",
    },
  })
    .png()
    .toBuffer();

test("buildQcThumbnailStorageKey creates a deterministic adjacent thumbnail key", () => {
  assert.equal(
    buildQcThumbnailStorageKey("qc-images/inspection-id/image-id.jpg"),
    "qc-images/inspection-id/thumbnails/image-id.webp",
  );
  assert.equal(
    buildQcThumbnailStorageKey("qc-images/source-file.webp"),
    "qc-images/thumbnails/source-file.webp",
  );
});

test("generateQcImageThumbnail resizes inside 480px without enlarging", async () => {
  const largeSource = await createPngBuffer({ width: 960, height: 640 });
  const largeThumbnail = await generateQcImageThumbnail({
    sourceBuffer: largeSource,
  });
  const largeMetadata = await sharp(largeThumbnail.buffer).metadata();

  assert.equal(largeThumbnail.contentType, "image/webp");
  assert.ok(largeMetadata.width <= 480);
  assert.ok(largeMetadata.height <= 480);

  const smallSource = await createPngBuffer({ width: 120, height: 90 });
  const smallThumbnail = await generateQcImageThumbnail({
    sourceBuffer: smallSource,
  });
  const smallMetadata = await sharp(smallThumbnail.buffer).metadata();

  assert.equal(smallMetadata.width, 120);
  assert.equal(smallMetadata.height, 90);
});
