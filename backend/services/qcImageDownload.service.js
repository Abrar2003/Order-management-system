const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const axios = require("axios");
const archiver = require("archiver");
const { getObjectBuffer } = require("./wasabiStorage.service");

const ZIP_COMPRESSION_LEVEL = Math.max(
  0,
  Math.min(9, Number(process.env.QC_IMAGE_DOWNLOAD_ZIP_LEVEL || 0) || 0),
);
const DOWNLOAD_CONCURRENCY = Math.max(
  1,
  Number(process.env.QC_IMAGE_DOWNLOAD_CONCURRENCY || 24) || 24,
);

const normalizeText = (value) => String(value ?? "").trim();

const sanitizeFileBaseName = (value = "", fallback = "qc-image") => {
  const normalized = normalizeText(value)
    .replace(/\.[^.]+$/u, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/^-+|-+$/gu, "")
    .trim();

  return normalized || fallback;
};

const sanitizeFileExtension = (value = "", fallback = ".jpg") => {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return fallback;

  const withLeadingDot = normalized.startsWith(".")
    ? normalized
    : `.${normalized}`;
  const safeExtension = withLeadingDot.replace(/[^.a-z0-9]/gu, "");

  if (!safeExtension || safeExtension === ".") {
    return fallback;
  }

  return safeExtension.slice(0, 10);
};

const buildArchiveEntryName = (image = {}, index = 0) => {
  const originalName = normalizeText(image?.originalName);
  const storageKeyName = path.basename(normalizeText(image?.key || ""));
  const candidateName =
    originalName || storageKeyName || `qc-image-${index + 1}.jpg`;
  const candidateExtension =
    path.extname(candidateName) || path.extname(storageKeyName) || ".jpg";

  return `${sanitizeFileBaseName(candidateName, `qc-image-${index + 1}`)}${sanitizeFileExtension(candidateExtension)}`;
};

const ensureUniqueArchiveEntryName = (fileName = "", usedNames = new Set()) => {
  const extension = path.extname(fileName);
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  let nextName = fileName;
  let duplicateIndex = 2;

  while (usedNames.has(nextName.toLowerCase())) {
    nextName = `${baseName} (${duplicateIndex})${extension}`;
    duplicateIndex += 1;
  }

  usedNames.add(nextName.toLowerCase());
  return nextName;
};

const buildArchiveFileName = (archiveLabel = "") => {
  const safeLabel = sanitizeFileBaseName(archiveLabel, "qc-images")
    .toLowerCase()
    .replace(/\s+/gu, "-")
    .slice(0, 80);
  const dateStamp = new Date().toISOString().slice(0, 10);

  return `${safeLabel || "qc-images"}-${dateStamp}.zip`;
};

const createTempArchivePath = (archiveLabel = "") => {
  const safeLabel = sanitizeFileBaseName(archiveLabel, "qc-images")
    .toLowerCase()
    .replace(/\s+/gu, "-")
    .slice(0, 40);
  const suffix = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  return path.join(os.tmpdir(), `${safeLabel || "qc-images"}-${suffix}.zip`);
};

const mapWithConcurrencyLimit = async (
  items = [],
  concurrencyLimit = 1,
  mapper = async (item) => item,
) => {
  const safeItems = Array.isArray(items) ? items : [];
  const safeConcurrencyLimit = Math.max(1, Number(concurrencyLimit) || 1);
  const results = new Array(safeItems.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(safeConcurrencyLimit, safeItems.length) },
    () =>
      (async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;

          if (currentIndex >= safeItems.length) {
            return;
          }

          results[currentIndex] = await mapper(
            safeItems[currentIndex],
            currentIndex,
          );
        }
      })(),
  );

  await Promise.all(workers);
  return results;
};

const getLegacyUrlBuffer = async (url = "") => {
  const normalizedUrl = normalizeText(url);
  if (!normalizedUrl) {
    throw new Error("Legacy QC image URL is missing");
  }

  const response = await axios.get(normalizedUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
  });

  return {
    buffer: Buffer.from(response.data),
    contentType: normalizeText(response?.headers?.["content-type"] || ""),
    size: Number(response?.data?.byteLength || 0),
  };
};

const fetchQcImageContent = async (image = {}) => {
  const storageKey = normalizeText(image?.key || "");
  if (storageKey) {
    return getObjectBuffer(storageKey);
  }

  const legacyUrl = normalizeText(image?.url || image?.link || "");
  if (legacyUrl) {
    return getLegacyUrlBuffer(legacyUrl);
  }

  throw new Error("QC image storage reference is missing");
};

const createArchiveWriteCompletion = (archive, outputStream) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let outputFinished = false;

    const cleanup = () => {
      archive.off("error", handleError);
      outputStream.off("error", handleError);
      outputStream.off("finish", handleFinish);
      outputStream.off("close", handleClose);
    };

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };

    function handleError(error) {
      settle(reject, error);
    }

    function handleFinish() {
      outputFinished = true;
      settle(resolve);
    }

    function handleClose() {
      if (!outputFinished) {
        settle(
          reject,
          new Error("QC image download stream closed before completion"),
        );
      }
    }

    archive.on("error", handleError);
    outputStream.on("error", handleError);
    outputStream.on("finish", handleFinish);
    outputStream.on("close", handleClose);
  });

const streamQcImagesArchive = async ({
  images = [],
  archiveLabel = "",
  outputStream = null,
  fetchImageContent = fetchQcImageContent,
  concurrency = DOWNLOAD_CONCURRENCY,
} = {}) => {
  const safeImages = Array.isArray(images) ? images.filter(Boolean) : [];
  if (safeImages.length === 0) {
    throw new Error("Select at least one QC image to download");
  }

  if (!outputStream || typeof outputStream.write !== "function") {
    throw new Error("A writable archive output stream is required");
  }

  const archive = archiver("zip", {
    store: ZIP_COMPRESSION_LEVEL === 0,
    zlib: { level: ZIP_COMPRESSION_LEVEL },
  });
  const usedNames = new Set();
  const archiveEntryNames = safeImages.map((image, index) =>
    ensureUniqueArchiveEntryName(buildArchiveEntryName(image, index), usedNames),
  );
  const failures = [];
  let downloadedCount = 0;
  const safeConcurrency = Math.max(1, Number(concurrency) || DOWNLOAD_CONCURRENCY);
  const archiveWriteCompletion = createArchiveWriteCompletion(
    archive,
    outputStream,
  );

  archive.pipe(outputStream);

  await mapWithConcurrencyLimit(
    safeImages,
    safeConcurrency,
    async (image, index) => {
      const uniqueArchiveEntryName = archiveEntryNames[index];

      try {
        const objectData = await fetchImageContent(image);
        archive.append(objectData.buffer, {
          name: uniqueArchiveEntryName,
          store: true,
        });
        downloadedCount += 1;
      } catch (error) {
        failures.push(
          `${uniqueArchiveEntryName}: ${error?.message || "Failed to load image from storage"}`,
        );
      }
    },
  );

  if (failures.length > 0) {
    archive.append(
      Buffer.from(
        [
          downloadedCount === 0
            ? "The selected QC images could not be added to this archive."
            : "Some selected QC images could not be added to this archive.",
          "",
          ...failures,
        ].join("\n"),
        "utf8",
      ),
      {
        name: "_download-errors.txt",
        store: true,
      },
    );
  }

  await archive.finalize();
  await archiveWriteCompletion;

  return {
    archiveFileName: buildArchiveFileName(archiveLabel),
    downloadedCount,
    failedCount: failures.length,
    archiveBytes: archive.pointer(),
  };
};

const createQcImagesArchiveFile = async ({
  images = [],
  archiveLabel = "",
  fetchImageContent = fetchQcImageContent,
  concurrency = DOWNLOAD_CONCURRENCY,
} = {}) => {
  const archivePath = createTempArchivePath(archiveLabel);
  const outputStream = fs.createWriteStream(archivePath);

  try {
    const result = await streamQcImagesArchive({
      images,
      archiveLabel,
      outputStream,
      fetchImageContent,
      concurrency,
    });
    if (Number(result?.downloadedCount || 0) <= 0) {
      throw new Error("Selected QC images could not be loaded from storage");
    }

    const stats = await fsp.stat(archivePath);
    const archiveSize = Number(stats?.size || 0);

    if (archiveSize < 22) {
      throw new Error("Generated QC image archive is empty or incomplete");
    }

    return {
      ...result,
      archivePath,
      archiveSize,
    };
  } catch (error) {
    outputStream.destroy();
    await fsp.rm(archivePath, { force: true }).catch(() => {});
    throw error;
  }
};

module.exports = {
  buildArchiveFileName,
  createQcImagesArchiveFile,
  streamQcImagesArchive,
  __test__: {
    buildArchiveEntryName,
    createQcImagesArchiveFile,
    ensureUniqueArchiveEntryName,
    streamQcImagesArchive,
  },
};
