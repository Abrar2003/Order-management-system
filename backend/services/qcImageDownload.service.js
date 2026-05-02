const path = require("path");
const AdmZip = require("adm-zip");
const { getObjectBuffer } = require("./wasabiStorage.service");

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

const buildQcImagesArchive = async ({
  images = [],
  archiveLabel = "",
} = {}) => {
  const safeImages = Array.isArray(images) ? images.filter(Boolean) : [];
  if (safeImages.length === 0) {
    throw new Error("Select at least one QC image to download");
  }

  const zip = new AdmZip();
  const usedNames = new Set();
  const failures = [];
  let downloadedCount = 0;

  for (let index = 0; index < safeImages.length; index += 1) {
    const image = safeImages[index];
    const storageKey = normalizeText(image?.key || "");
    const archiveEntryName = ensureUniqueArchiveEntryName(
      buildArchiveEntryName(image, index),
      usedNames,
    );

    if (!storageKey) {
      failures.push(`${archiveEntryName}: storage key is missing`);
      continue;
    }

    try {
      const objectData = await getObjectBuffer(storageKey);
      zip.addFile(archiveEntryName, objectData.buffer);
      downloadedCount += 1;
    } catch (error) {
      failures.push(
        `${archiveEntryName}: ${error?.message || "Failed to load image from storage"}`,
      );
    }
  }

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
