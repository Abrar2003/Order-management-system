import api from "../api/axios";

export const MAX_QC_IMAGE_UPLOAD_COUNT = 100;
export const QC_IMAGE_BATCH_SIZE = 10;
export const SUPPORTED_QC_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"];
export const SUPPORTED_QC_IMAGE_MIME_TYPES = ["image/jpeg", "image/png"];

const normalizeText = (value) => String(value ?? "").trim();

const normalizeFileName = (value) => normalizeText(value).toLowerCase();

export const getQcImageFileSignature = (file) =>
  [
    normalizeFileName(file?.name),
    Number(file?.size || 0),
    Number(file?.lastModified || 0),
    normalizeText(file?.type).toLowerCase(),
  ].join("__");

export const splitFilesIntoBatches = (files = [], batchSize = QC_IMAGE_BATCH_SIZE) => {
  const safeFiles = Array.isArray(files) ? files.filter(Boolean) : [];
  const safeBatchSize = Math.max(1, Number(batchSize) || QC_IMAGE_BATCH_SIZE);
  const batches = [];

  for (let index = 0; index < safeFiles.length; index += safeBatchSize) {
    batches.push(safeFiles.slice(index, index + safeBatchSize));
  }

  return batches;
};

export const isSupportedQcImageFile = (file) => {
  const normalizedName = normalizeFileName(file?.name);
  const normalizedType = normalizeText(file?.type).toLowerCase();

  const hasAllowedExtension = SUPPORTED_QC_IMAGE_EXTENSIONS.some((extension) =>
    normalizedName.endsWith(extension),
  );
  const hasAllowedMimeType =
    !normalizedType || SUPPORTED_QC_IMAGE_MIME_TYPES.includes(normalizedType);

  return hasAllowedExtension && hasAllowedMimeType;
};

export const normalizeQcImageBatchSummary = (responseData = {}) => {
  const data = responseData?.data || {};

  return {
    message: normalizeText(responseData?.message || "QC image batch processed."),
    qcId: normalizeText(data?.qc_id),
    uploadedCount: Math.max(0, Number(data?.uploaded_count || 0)),
    skippedDuplicateCount: Math.max(0, Number(data?.skipped_duplicate_count || 0)),
    skippedDuplicates: Array.isArray(data?.skipped_duplicates)
      ? data.skipped_duplicates
      : [],
    failedCount: Math.max(0, Number(data?.failed_count || 0)),
    failures: Array.isArray(data?.failures) ? data.failures : [],
    optimizedCount: Math.max(0, Number(data?.optimized_count || 0)),
    bytesSaved: Math.max(0, Number(data?.bytes_saved || 0)),
    processedCount: Math.max(0, Number(data?.processed_count || 0)),
    totalRequestedCount: Math.max(0, Number(data?.total_requested_count || 0)),
  };
};

export const uploadQcImageBatch = async ({
  qcId,
  files = [],
  uploadMode = "bulk",
  comment = "",
  signal,
  onUploadProgress,
} = {}) => {
  const formData = new FormData();
  formData.append("upload_mode", normalizeText(uploadMode || "bulk").toLowerCase());

  if (normalizeText(uploadMode).toLowerCase() === "single" && normalizeText(comment)) {
    formData.append("comment", normalizeText(comment));
  }

  (Array.isArray(files) ? files : []).forEach((file) => {
    formData.append("files", file);
  });

  return api.post(`/qc/${encodeURIComponent(qcId)}/images`, formData, {
    signal,
    onUploadProgress,
  });
};

export const downloadSelectedQcImages = async ({
  qcId,
  imageIds = [],
  imageKeys = [],
} = {}) => {
  if (!normalizeText(qcId)) {
    throw new Error("QC id is required");
  }

  return api.post(
    `/qc/${encodeURIComponent(qcId)}/images/download`,
    {
      image_ids: Array.isArray(imageIds) ? imageIds : [],
      image_keys: Array.isArray(imageKeys) ? imageKeys : [],
    },
    {
      responseType: "blob",
    },
  );
};
