const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const sharp = require("sharp");

const {
  createPreviewDerivative,
  createThumbnailDerivative,
  getSharpImageRuntimeSupport,
} = require("../services/qcImageProcessing.service");

test("creates preview and thumbnail WebP derivatives without enlarging", async () => {
  const source = await sharp({
    create: {
      width: 120,
      height: 80,
      channels: 3,
      background: "#336699",
    },
  })
    .jpeg()
    .toBuffer();

  const preview = await createPreviewDerivative(source);
  const thumbnail = await createThumbnailDerivative(source);

  assert.equal(preview.contentType, "image/webp");
  assert.equal(thumbnail.contentType, "image/webp");
  assert.equal(preview.width, 120);
  assert.equal(preview.height, 80);
  assert.equal(thumbnail.width, 120);
  assert.equal(thumbnail.height, 80);
  assert.ok(preview.size > 0);
  assert.ok(thumbnail.size > 0);
});

test("reports Sharp runtime support for HEIC/AVIF/WebP processing", () => {
  const support = getSharpImageRuntimeSupport();

  assert.equal(typeof support.sharp, "string");
  assert.equal(typeof support.libvips, "string");
  assert.equal(typeof support.heifInput, "boolean");
  assert.equal(typeof support.avifInput, "boolean");
  assert.equal(typeof support.webpOutput, "boolean");
});

test("rejects corrupt QC image source buffers during derivative generation", async () => {
  await assert.rejects(
    () => createPreviewDerivative(Buffer.from("not a valid image")),
    /image|unsupported|corrupt|Input/i,
  );
});

test(
  "converts a real iPhone HEIC fixture when QC_HEIC_FIXTURE_PATH is provided",
  { skip: !process.env.QC_HEIC_FIXTURE_PATH },
  async () => {
    const input = await fs.readFile(process.env.QC_HEIC_FIXTURE_PATH);
    const preview = await createPreviewDerivative(input);
    const thumbnail = await createThumbnailDerivative(input);

    assert.equal(preview.contentType, "image/webp");
    assert.equal(thumbnail.contentType, "image/webp");
    assert.ok(preview.width > 0);
    assert.ok(preview.height > 0);
    assert.ok(thumbnail.width > 0);
    assert.ok(thumbnail.height > 0);
    assert.ok(preview.size > 0);
    assert.ok(thumbnail.size > 0);
  },
);
