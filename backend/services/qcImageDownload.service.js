const path = require("path");
const axios = require("axios");
const AdmZip = require("adm-zip");
const { getObjectBuffer } = require("./wasabiStorage.service");

const DOWNLOAD_CONCURRENCY = 6;

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

const buildQcImagesArchive = async ({
  images = [],
  archiveLabel = "",
} = {}) => {
  const safeImages = Array.isArray(images) ? images.filter(Boolean) : [];
  if (safeImages.length === 0) {
    throw new Error("Select at least one QC image to download");
  }

  const preparedEntries = await mapWithConcurrencyLimit(
    safeImages,
    DOWNLOAD_CONCURRENCY,
    async (image, index) => {
      const archiveEntryName = buildArchiveEntryName(image, index);

      try {
        const objectData = await fetchQcImageContent(image);
        return {
          ok: true,
          archiveEntryName,
          buffer: objectData.buffer,
        };
      } catch (error) {
        return {
          ok: false,
          archiveEntryName,
          error: error?.message || "Failed to load image from storage",
        };
      }
    },
  );

  const zip = new AdmZip();
  const usedNames = new Set();
  const failures = [];
  let downloadedCount = 0;

  preparedEntries.forEach((entry) => {
    const uniqueArchiveEntryName = ensureUniqueArchiveEntryName(
      entry.archiveEntryName,
      usedNames,
    );

    if (!entry.ok) {
      failures.push(`${uniqueArchiveEntryName}: ${entry.error}`);
      return;
    }

    zip.addFile(uniqueArchiveEntryName, entry.buffer);
    downloadedCount += 1;
  });

  if (downloadedCount === 0) {
    throw new Error(
      failures[0] || "Failed to prepare QC image download archive",
    );
  }

  if (failures.length > 0) {
    zip.addFile(
      "_download-errors.txt",
      Buffer.from(
        [
          "Some selected QC images could not be added to this archive.",
          "",
          ...failures,
        ].join("\n"),
        "utf8",
      ),
    );
  }

  return {
    archiveBuffer: zip.toBuffer(),
    archiveFileName: buildArchiveFileName(archiveLabel),
    downloadedCount,
    failedCount: failures.length,
  };
};

module.exports = {
  buildQcImagesArchive,
};
