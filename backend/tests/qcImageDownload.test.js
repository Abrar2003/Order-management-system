const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const AdmZip = require("adm-zip");

const {
  __test__: {
    buildArchiveEntryName,
    createQcImagesArchiveFile,
    fetchQcImageContent,
    streamQcImagesArchive,
  },
} = require("../services/qcImageDownload.service");

const createTempZipPath = () =>
  path.join(os.tmpdir(), `qc-image-download-${Date.now()}-${Math.random()}.zip`);

test("streams QC image archives with unique names and failure manifest", async () => {
  const outputPath = createTempZipPath();
  const output = fs.createWriteStream(outputPath);

  try {
    const result = await streamQcImagesArchive({
      archiveLabel: "QC 123",
      outputStream: output,
      concurrency: 2,
      images: [
        { originalName: "same.jpg", key: "qc-images/first.jpg" },
        { originalName: "same.jpg", key: "qc-images/second.jpg" },
        { originalName: "missing.jpg", key: "qc-images/missing.jpg" },
      ],
      fetchImageContent: async (image) => {
        if (String(image.key).includes("missing")) {
          throw new Error("not found");
        }

        return {
          buffer: Buffer.from(`image:${image.key}`),
          contentType: "image/jpeg",
          size: 16,
        };
      },
    });

    assert.equal(result.downloadedCount, 2);
    assert.equal(result.failedCount, 1);
    assert.ok(result.archiveBytes > 0);

    const zip = new AdmZip(outputPath);
    const entryNames = zip
      .getEntries()
      .map((entry) => entry.entryName)
      .sort();

    assert.deepEqual(entryNames, [
      "_download-errors.txt",
      "same (2).jpg",
      "same.jpg",
    ]);
    assert.match(
      zip.readAsText("_download-errors.txt"),
      /missing\.jpg: not found/,
    );
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
});

test("creates a complete QC image archive file before download response", async () => {
  let archivePath = "";

  try {
    const result = await createQcImagesArchiveFile({
      archiveLabel: "QC file",
      concurrency: 1,
      images: [
        { originalName: "front.jpg", key: "qc-images/front.jpg" },
        { originalName: "side.jpg", key: "qc-images/side.jpg" },
      ],
      fetchImageContent: async (image) => ({
        buffer: Buffer.from(`image:${image.key}`),
        contentType: "image/jpeg",
        size: 16,
      }),
    });
    archivePath = result.archivePath;

    assert.ok(result.archiveSize > 22);
    assert.equal(fs.statSync(archivePath).size, result.archiveSize);

    const zip = new AdmZip(archivePath);
    assert.deepEqual(
      zip.getEntries().map((entry) => entry.entryName).sort(),
      ["front.jpg", "side.jpg"],
    );
    assert.equal(zip.readAsText("front.jpg"), "image:qc-images/front.jpg");
  } finally {
    if (archivePath) fs.rmSync(archivePath, { force: true });
  }
});

test("downloads a retained source image instead of its WebP preview", async () => {
  const sourceKey = "qc-images/qc/inspection/record/qc_images/image/source/original.jpg";
  const previewKey = "qc-images/qc/inspection/record/qc_images/image/preview/v1.webp";
  let fetchedKey = "";

  const result = await fetchQcImageContent(
    {
      key: previewKey,
      storage: { source_key: sourceKey },
    },
    {
      objectExistsFn: async (key) => key === sourceKey,
      getObjectBufferFn: async (key) => {
        fetchedKey = key;
        return { buffer: Buffer.from("original"), contentType: "image/jpeg", size: 8 };
      },
    },
  );

  assert.equal(fetchedKey, sourceKey);
  assert.equal(result.storageKey, sourceKey);
  assert.equal(
    buildArchiveEntryName({ originalName: "IMG_20260714_121734.jpg" }, 0, result.storageKey),
    "IMG_20260714_121734.jpg",
  );

  const fallback = await fetchQcImageContent(
    {
      key: previewKey,
      storage: { source_key: sourceKey },
      originalName: "IMG_20260714_121734.jpg",
    },
    {
      objectExistsFn: async () => false,
      getObjectBufferFn: async (key) => ({ buffer: Buffer.from(key), size: key.length }),
    },
  );

  assert.equal(fallback.storageKey, previewKey);
  assert.equal(
    buildArchiveEntryName(
      { originalName: "IMG_20260714_121734.jpg" },
      0,
      fallback.storageKey,
    ),
    "IMG_20260714_121734.webp",
  );
});

test("does not create a download file when every selected QC image fails", async () => {
  await assert.rejects(
    createQcImagesArchiveFile({
      archiveLabel: "QC missing",
      concurrency: 1,
      images: [
        { originalName: "missing.jpg", key: "qc-images/missing.jpg" },
      ],
      fetchImageContent: async () => {
        throw new Error("missing object");
      },
    }),
    /could not be loaded from storage/,
  );
});
