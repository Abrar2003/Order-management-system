import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  MAX_QC_IMAGE_UPLOAD_FILES_PER_REQUEST,
  QC_IMAGE_BATCH_SIZE,
  QC_IMAGE_DIRECT_UPLOAD_CONCURRENCY,
  completeQcImageUploadSession,
  createQcImageUploadSession,
  getQcImageFileSignature,
  isSupportedQcImageFile,
  refreshQcImageUploadSession,
  splitFilesIntoBatches,
  uploadFileToPresignedWasabiUrl,
} from "../services/qcImages.service";
import {
  compressBrowserQcImage,
} from "../services/browserImageCompression.service";

const RETRY_DELAYS_MS = [2000, 5000, 10000];
const ACTIVE_FILE_STATUSES = new Set([
  "compressing",
  "creating-upload-session",
  "uploading",
  "uploaded",
  "confirming",
  "retrying",
]);

const createInitialState = () => ({
  isUploading: false,
  selectedFiles: [],
  fileStatuses: [],
  batchStatuses: [],
  currentBatchIndex: 0,
  totalBatches: 0,
  progressPercent: 0,
  uploadedCount: 0,
  duplicateCount: 0,
  failedCount: 0,
  failedFiles: [],
  optimizedCount: 0,
  bytesSaved: 0,
  selectionMessage: "",
  summary: null,
});

const normalizeText = (value) => String(value ?? "").trim();

const isAbortError = (error) =>
  error?.code === "ERR_CANCELED" || axios.isCancel?.(error) === true;

const isRetryableUploadError = (error) => {
  if (isAbortError(error)) return false;

  const status = Number(error?.response?.status || 0);
  if (!error?.response) return true;
  if (status === 403 && isExpiredPresignedUrlError(error)) return true;
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;

  const errorCode = normalizeText(error?.code).toUpperCase();
  if (errorCode === "ECONNABORTED") return true;

  const message = normalizeText(error?.message).toLowerCase();
  return message.includes("network") || message.includes("timeout");
};

const isExpiredPresignedUrlError = (error) => {
  const status = Number(error?.response?.status || 0);
  const message = normalizeText(
    error?.response?.data?.message ||
      error?.response?.data ||
      error?.message,
  ).toLowerCase();

  return (
    status === 403 &&
    (
      message.includes("expired") ||
      message.includes("signature") ||
      message.includes("request has expired") ||
      message.includes("accessdenied")
    )
  );
};

const waitWithSignal = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Upload cancelled"));
      return;
    }

    let abortHandler = null;
    const timeoutId = window.setTimeout(() => {
      if (abortHandler) {
        signal?.removeEventListener("abort", abortHandler);
      }
      resolve();
    }, ms);

    abortHandler = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortHandler);
      reject(new Error("Upload cancelled"));
    };

    signal?.addEventListener("abort", abortHandler, { once: true });
  });

const createIdempotencyKey = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return [
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 12),
    Math.random().toString(36).slice(2, 12),
  ].join("-");
};

const mergeUniqueFiles = (files = []) =>
  Array.from(
    new Map(
      (Array.isArray(files) ? files : [])
        .filter(Boolean)
        .map((file) => [getQcImageFileSignature(file), file]),
    ).values(),
  );

const createLocalPreviewUrl = (file) => {
  if (
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    !(file instanceof Blob)
  ) {
    return "";
  }

  return URL.createObjectURL(file);
};

const revokeLocalPreviewUrl = (url = "") => {
  if (
    typeof URL !== "undefined" &&
    typeof URL.revokeObjectURL === "function" &&
    normalizeText(url).startsWith("blob:")
  ) {
    URL.revokeObjectURL(url);
  }
};

const revokeRemovedPreviewUrls = (previousStatuses = [], nextStatuses = []) => {
  const retainedUrls = new Set(
    (Array.isArray(nextStatuses) ? nextStatuses : [])
      .map((entry) => normalizeText(entry.previewUrl))
      .filter(Boolean),
  );

  (Array.isArray(previousStatuses) ? previousStatuses : []).forEach((entry) => {
    const previewUrl = normalizeText(entry?.previewUrl);
    if (previewUrl && !retainedUrls.has(previewUrl)) {
      revokeLocalPreviewUrl(previewUrl);
    }
  });
};

const createFileStatuses = (files = [], batchSize = QC_IMAGE_DIRECT_UPLOAD_CONCURRENCY, previousStatuses = []) => {
  const previousBySignature = new Map(
    (Array.isArray(previousStatuses) ? previousStatuses : []).map((entry) => [
      entry.fileSignature,
      entry,
    ]),
  );

  return mergeUniqueFiles(files).map((file, index) => {
    const fileSignature = getQcImageFileSignature(file);
    const previous = previousBySignature.get(fileSignature);

    return {
      fileId: previous?.fileId || createIdempotencyKey(),
      idempotencyKey: previous?.idempotencyKey || createIdempotencyKey(),
      fileSignature,
      file,
      fileName: normalizeText(file?.name) || `QC image ${index + 1}`,
      fileSize: Number(file?.size || 0),
      previewUrl: previous?.previewUrl || createLocalPreviewUrl(file),
      batchNumber: Math.floor(index / Math.max(1, Number(batchSize) || QC_IMAGE_DIRECT_UPLOAD_CONCURRENCY)) + 1,
      status: "queued",
      progressPercent: 0,
      attempts: 0,
      uploadedCount: 0,
      duplicateCount: 0,
      optimizedCount: 0,
      bytesSaved: 0,
      message: "",
      errorMessage: "",
      failure: null,
    };
  });
};

const statusRank = (status = "") => {
  if (ACTIVE_FILE_STATUSES.has(status)) return 3;
  if (status === "failed") return 2;
  if (status === "queued") return 1;
  return 0;
};

const buildBatchStatuses = (fileStatuses = [], batchSize = QC_IMAGE_BATCH_SIZE) => {
  const batches = splitFilesIntoBatches(fileStatuses, batchSize);

  return batches.map((files, index) => {
    const active = files.some((file) => ACTIVE_FILE_STATUSES.has(file.status));
    const failedCount = files.filter((file) => file.status === "failed").length;
    const queuedCount = files.filter((file) => file.status === "queued").length;
    const uploadedCount = files.filter((file) => file.status === "completed").length;
    const duplicateCount = files.reduce((sum, file) => sum + Number(file.duplicateCount || 0), 0);
    const progressPercent = files.length > 0
      ? Math.round(
        files.reduce((sum, file) => sum + Math.max(0, Math.min(100, Number(file.progressPercent || 0))), 0)
        / files.length,
      )
      : 0;
    let status = "pending";
    if (active) {
      status = files.some((file) => file.status === "retrying") ? "retrying" : "uploading";
    } else if (failedCount > 0 && uploadedCount > 0) {
      status = "partial";
    } else if (failedCount > 0) {
      status = "failed";
    } else if (queuedCount === 0 && files.length > 0) {
      status = "success";
    }

    return {
      batchId: `batch-${index + 1}`,
      batchNumber: index + 1,
      fileCount: files.length,
      fileNames: files.map((file) => file.fileName),
      files,
      status,
      progressPercent,
      uploadedCount,
      duplicateCount,
      failedCount,
      failures: files.map((file) => file.failure).filter(Boolean),
      skippedDuplicates: [],
      attempts: Math.max(0, ...files.map((file) => Number(file.attempts || 0))),
      message: "",
      errorMessage: files.find((file) => file.errorMessage)?.errorMessage || "",
      retryFiles: files.filter((file) => file.status === "failed").map((file) => file.file),
    };
  });
};

const summarizeFileStatuses = (fileStatuses = []) => {
  const uploadedStatuses = fileStatuses.filter((file) => file.status === "completed");
  const failedStatuses = fileStatuses.filter((file) => file.status === "failed");
  const uploadedCount = uploadedStatuses.reduce((sum, file) => sum + Number(file.uploadedCount || 0), 0);
  const duplicateCount = uploadedStatuses.reduce((sum, file) => sum + Number(file.duplicateCount || 0), 0);
  const optimizedCount = uploadedStatuses.reduce((sum, file) => sum + Number(file.optimizedCount || 0), 0);
  const bytesSaved = uploadedStatuses.reduce((sum, file) => sum + Number(file.bytesSaved || 0), 0);

  return {
    uploadedCount,
    duplicateCount,
    failedCount: failedStatuses.length,
    failedFiles: failedStatuses.map((file) => ({
      originalName: file.fileName,
      reason: file.errorMessage || file.failure?.reason || "Upload failed",
      idempotencyKey: file.idempotencyKey,
    })),
    optimizedCount,
    bytesSaved,
  };
};

const computeOverallProgress = (fileStatuses = []) => {
  if (!Array.isArray(fileStatuses) || fileStatuses.length === 0) return 0;

  const hasActiveStatus = fileStatuses.some((file) => ACTIVE_FILE_STATUSES.has(file.status));
  const averageProgress =
    fileStatuses.reduce(
      (sum, file) => sum + Math.max(0, Math.min(100, Number(file.progressPercent || 0))),
      0,
    ) / fileStatuses.length;

  return Math.max(
    0,
    Math.min(
      hasActiveStatus ? 99 : 100,
      hasActiveStatus ? Math.floor(averageProgress) : Math.round(averageProgress),
    ),
  );
};

const hasActiveFileStatuses = (fileStatuses = []) =>
  (Array.isArray(fileStatuses) ? fileStatuses : []).some((file) =>
    ACTIVE_FILE_STATUSES.has(file.status),
  );

const createSummaryMessage = ({
  totalSelectedCount = 0,
  uploadedCount = 0,
  duplicateCount = 0,
  failedCount = 0,
} = {}) => {
  if (uploadedCount > 0 || duplicateCount > 0) {
    let message = `${uploadedCount + duplicateCount} of ${totalSelectedCount} image${totalSelectedCount === 1 ? "" : "s"} confirmed uploaded`;
    if (duplicateCount > 0) {
      message += `. ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} skipped`;
    }
    if (failedCount > 0) {
      message += `. ${failedCount} file${failedCount === 1 ? "" : "s"} still need attention`;
    }
    return `${message}.`;
  }

  if (failedCount > 0) {
    return `${failedCount} file${failedCount === 1 ? "" : "s"} still failed.`;
  }

  return "No QC images have been uploaded yet.";
};

const mapWithConcurrencyLimit = async (items = [], concurrency = 1, mapper = async () => {}) => {
  const safeItems = Array.isArray(items) ? items : [];
  const safeConcurrency = Math.max(1, Number(concurrency) || 1);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(safeConcurrency, safeItems.length) }, async () => {
    while (nextIndex < safeItems.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await mapper(safeItems[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
};

export const useBulkQcImageUpload = ({
  qcId = "",
  batchSize = QC_IMAGE_DIRECT_UPLOAD_CONCURRENCY,
  maxFiles = MAX_QC_IMAGE_UPLOAD_FILES_PER_REQUEST,
} = {}) => {
  const [state, setState] = useState(createInitialState);
  const stateRef = useRef(state);
  const fileStatusesRef = useRef([]);
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef(null);
  const uploadInFlightRef = useRef(false);

  const recomputeState = useCallback((baseState, nextFileStatuses) => {
    const safeFileStatuses = Array.isArray(nextFileStatuses) ? nextFileStatuses : [];
    fileStatusesRef.current = safeFileStatuses;
    const counts = summarizeFileStatuses(safeFileStatuses);
    const batchStatuses = buildBatchStatuses(safeFileStatuses, QC_IMAGE_DIRECT_UPLOAD_CONCURRENCY);

    return {
      ...baseState,
      fileStatuses: safeFileStatuses,
      selectedFiles: safeFileStatuses.map((file) => file.file).filter(Boolean),
      batchStatuses,
      totalBatches: batchStatuses.length,
      progressPercent: computeOverallProgress(safeFileStatuses),
      uploadedCount: counts.uploadedCount,
      duplicateCount: counts.duplicateCount,
      failedCount: counts.failedCount,
      failedFiles: counts.failedFiles,
      optimizedCount: counts.optimizedCount,
      bytesSaved: counts.bytesSaved,
    };
  }, []);

  const updateState = useCallback((updater) => {
    if (!isMountedRef.current) return;

    setState((previousState) => {
      const nextState =
        typeof updater === "function"
          ? updater(previousState)
          : { ...previousState, ...updater };
      stateRef.current = nextState;
      fileStatusesRef.current = Array.isArray(nextState.fileStatuses)
        ? nextState.fileStatuses
        : fileStatusesRef.current;
      return nextState;
    });
  }, []);

  const updateFileStatus = useCallback((fileId, updater) => {
    const currentFileStatuses = Array.isArray(fileStatusesRef.current)
      ? fileStatusesRef.current
      : [];
    const nextFileStatuses = currentFileStatuses.map((fileStatus) => {
      if (fileStatus.fileId !== fileId) return fileStatus;
      return typeof updater === "function"
        ? updater(fileStatus)
        : { ...fileStatus, ...updater };
    });

    fileStatusesRef.current = nextFileStatuses;
    updateState((previousState) => {
      return recomputeState(previousState, nextFileStatuses);
    });
  }, [recomputeState, updateState]);

  useEffect(() => {
    stateRef.current = state;
    fileStatusesRef.current = state.fileStatuses;
  }, [state]);

  useEffect(() => () => {
    isMountedRef.current = false;
    uploadInFlightRef.current = false;
    abortControllerRef.current?.abort();
    revokeRemovedPreviewUrls(stateRef.current.fileStatuses, []);
  }, []);

  const reset = useCallback(() => {
    uploadInFlightRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    revokeRemovedPreviewUrls(stateRef.current.fileStatuses, []);
    fileStatusesRef.current = [];
    updateState(createInitialState());
  }, [updateState]);

  const selectFiles = useCallback((rawFiles = [], { uploadMode = "bulk", imageType = "qc_images" } = {}) => {
    const normalizedImageType = normalizeText(imageType).toLowerCase();
    const imageTypeLabel =
      normalizedImageType === "hardware_inspection"
        ? "hardware inspection image"
        : "QC image";
    const uniqueFiles = mergeUniqueFiles(rawFiles);
    const invalidFiles = uniqueFiles.filter((file) => !isSupportedQcImageFile(file));
    let validFiles = uniqueFiles.filter((file) => isSupportedQcImageFile(file));
    const messages = [];

    if (invalidFiles.length > 0) {
      messages.push(
        `${invalidFiles.length} unsupported file${invalidFiles.length === 1 ? "" : "s"} ignored.`,
      );
    }

    if (normalizeText(uploadMode).toLowerCase() === "single" && validFiles.length > 1) {
      validFiles = validFiles.slice(0, 1);
      messages.push("Single image mode keeps only the first valid image.");
    }

    if (maxFiles <= 0) {
      validFiles = [];
      messages.push(`${imageTypeLabel} upload limit reached for this QC record.`);
    }

    if (validFiles.length > maxFiles) {
      validFiles = validFiles.slice(0, maxFiles);
      messages.push(`Only the first ${maxFiles} images were kept.`);
    }

    const nextFileStatuses = createFileStatuses(
      validFiles,
      QC_IMAGE_DIRECT_UPLOAD_CONCURRENCY,
      stateRef.current.fileStatuses,
    );
    revokeRemovedPreviewUrls(stateRef.current.fileStatuses, nextFileStatuses);
    fileStatusesRef.current = nextFileStatuses;
    const nextBatchStatuses = buildBatchStatuses(nextFileStatuses, QC_IMAGE_DIRECT_UPLOAD_CONCURRENCY);

    updateState((previousState) => ({
      ...recomputeState(
        {
          ...previousState,
          isUploading: false,
          currentBatchIndex: nextBatchStatuses.length > 0 ? 1 : 0,
          selectionMessage:
            messages.join(" ")
            || (validFiles.length > 0
              ? `${validFiles.length} image${validFiles.length === 1 ? "" : "s"} ready to upload with up to ${QC_IMAGE_DIRECT_UPLOAD_CONCURRENCY} simultaneous direct uploads.`
              : `No valid ${imageTypeLabel}s selected.`),
          summary: null,
        },
        nextFileStatuses,
      ),
    }));

    return {
      files: validFiles,
      invalidFiles,
      message: messages.join(" "),
    };
  }, [maxFiles, recomputeState, updateState]);

  const uploadSingleFileWithRetry = useCallback(async ({
    fileStatus,
    uploadMode,
    imageType,
    comment,
    signal,
  }) => {
    const maxAttempts = 1 + RETRY_DELAYS_MS.length;
    let uploadFile = null;
    let uploadSession = null;
    let uploadSucceeded = false;
    let compressionResult = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const retrying = attempt > 1;
      updateFileStatus(fileStatus.fileId, (current) => ({
        ...current,
        status: retrying ? "retrying" : "compressing",
        attempts: attempt,
        progressPercent: retrying ? 0 : Math.max(3, current.progressPercent || 0),
        errorMessage: retrying
          ? `Retrying after ${Math.round(RETRY_DELAYS_MS[attempt - 2] / 1000)} seconds...`
          : "",
        message: "",
      }));

      try {
        if (!uploadFile) {
          compressionResult = await compressBrowserQcImage({ file: fileStatus.file });
          uploadFile = compressionResult.file || fileStatus.file;
          updateFileStatus(fileStatus.fileId, (current) => ({
            ...current,
            progressPercent: Math.max(current.progressPercent || 0, 8),
            optimizedCount: compressionResult.optimized ? 1 : 0,
            bytesSaved: compressionResult.bytesSaved || 0,
            message: compressionResult.optimized
              ? "Compressed in browser."
              : "",
          }));
        }

        if (!uploadSession) {
          updateFileStatus(fileStatus.fileId, (current) => ({
            ...current,
            status: "creating-upload-session",
            progressPercent: Math.max(current.progressPercent || 0, 12),
          }));
          const sessionResponse = await createQcImageUploadSession({
            qcId,
            file: uploadFile,
            idempotencyKey: fileStatus.idempotencyKey,
            uploadMode,
            imageType,
            comment,
            signal,
          });
          uploadSession = sessionResponse?.data?.data || {};
          if (uploadSession.already_completed) {
            updateFileStatus(fileStatus.fileId, (current) => ({
              ...current,
              status: "completed",
              progressPercent: 100,
              uploadedCount: 1,
              errorMessage: "",
              failure: null,
              message: "Upload already confirmed.",
            }));
            return { uploaded: true };
          }
        } else if (retrying && !uploadSucceeded) {
          const refreshResponse = await refreshQcImageUploadSession({
            uploadId: uploadSession.upload_id,
            signal,
          });
          uploadSession = refreshResponse?.data?.data || uploadSession;
        }

        if (!uploadSucceeded) {
          updateFileStatus(fileStatus.fileId, (current) => ({
            ...current,
            status: "uploading",
            progressPercent: Math.max(current.progressPercent || 0, 15),
          }));
          try {
            await uploadFileToPresignedWasabiUrl({
              uploadUrl: uploadSession.upload_url,
              file: uploadFile,
              headers: uploadSession.headers || {
                "Content-Type": uploadFile.type || "application/octet-stream",
              },
              signal,
              onUploadProgress: (progressEvent) => {
                if (signal?.aborted) return;

                const total = Number(progressEvent?.total || uploadFile?.size || 0);
                const loaded = Number(progressEvent?.loaded || 0);
                const percent = total > 0
                  ? 15 + Math.round((loaded / total) * 70)
                  : Math.min(85, Math.max(20, loaded > 0 ? 35 : 20));

                updateFileStatus(fileStatus.fileId, (current) => ({
                  ...current,
                  progressPercent: Math.max(15, Math.min(percent, 85)),
                }));
              },
            });
            uploadSucceeded = true;
            updateFileStatus(fileStatus.fileId, (current) => ({
              ...current,
              status: "uploaded",
              progressPercent: Math.max(current.progressPercent || 0, 88),
              message: "Uploaded to Wasabi. Confirming with OMS...",
            }));
          } catch (uploadError) {
            if (
              isExpiredPresignedUrlError(uploadError) &&
              uploadSession?.upload_id &&
              attempt <= maxAttempts
            ) {
              const refreshResponse = await refreshQcImageUploadSession({
                uploadId: uploadSession.upload_id,
                signal,
              });
              uploadSession = refreshResponse?.data?.data || uploadSession;
            }
            throw uploadError;
          }
        }

        updateFileStatus(fileStatus.fileId, (current) => ({
          ...current,
          status: "confirming",
          progressPercent: Math.max(current.progressPercent || 0, 90),
        }));
        await completeQcImageUploadSession({
          uploadId: uploadSession.upload_id,
          signal,
        });

        updateFileStatus(fileStatus.fileId, (current) => ({
          ...current,
          status: "completed",
          progressPercent: 100,
          uploadedCount: 1,
          duplicateCount: 0,
          optimizedCount: compressionResult?.optimized ? 1 : 0,
          bytesSaved: compressionResult?.bytesSaved || 0,
          errorMessage: "",
          failure: null,
          message: "Uploaded directly to Wasabi and confirmed.",
        }));
        return { uploaded: true };
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) {
          throw error;
        }

        const retryable = isRetryableUploadError(error);
        const retryIndex = attempt - 1;
        if (retryable && retryIndex < RETRY_DELAYS_MS.length) {
          const delayMs = RETRY_DELAYS_MS[retryIndex];
          updateFileStatus(fileStatus.fileId, (current) => ({
            ...current,
            status: "retrying",
            errorMessage:
              error?.response?.data?.message ||
              error?.message ||
              `Temporary upload failure. Retrying in ${Math.round(delayMs / 1000)} seconds.`,
          }));
          await waitWithSignal(delayMs, signal);
          continue;
        }

        const failure = {
          originalName: fileStatus.fileName,
          reason:
            error?.response?.data?.message ||
            error?.message ||
            "Upload failed",
          stage: "request",
        };
        updateFileStatus(fileStatus.fileId, (current) => ({
          ...current,
          status: "failed",
          progressPercent: 100,
          errorMessage: failure.reason,
          failure,
        }));
        return { uploaded: false, failed: true };
      }
    }

    return { uploaded: false, failed: true };
  }, [qcId, updateFileStatus]);

  const runUpload = useCallback(async ({
    uploadMode = "bulk",
    imageType = "qc_images",
    comment = "",
    fileStatusesToUpload = [],
  } = {}) => {
    if (stateRef.current.isUploading || uploadInFlightRef.current) return null;

    const normalizedUploadMode = normalizeText(uploadMode).toLowerCase() || "bulk";
    const normalizedImageType = normalizeText(imageType).toLowerCase() || "qc_images";
    const imageTypeLabel =
      normalizedImageType === "hardware_inspection"
        ? "hardware inspection image"
        : "QC image";
    const runnableFileStatuses = (Array.isArray(fileStatusesToUpload) ? fileStatusesToUpload : [])
      .filter((fileStatus) =>
        fileStatus?.file &&
        fileStatus.status !== "completed",
      )
      .sort((left, right) =>
        left.batchNumber - right.batchNumber ||
        statusRank(right.status) - statusRank(left.status),
      );

    if (!normalizeText(qcId)) {
      updateState((previousState) => ({
        ...previousState,
        selectionMessage: "QC record id is missing for image upload.",
      }));
      return null;
    }

    if (runnableFileStatuses.length === 0) {
      updateState((previousState) => ({
        ...previousState,
        selectionMessage: `Select at least one ${imageTypeLabel} before uploading.`,
      }));
      return null;
    }

    if (normalizedUploadMode === "single" && runnableFileStatuses.length !== 1) {
      updateState((previousState) => ({
        ...previousState,
        selectionMessage: "Single image mode requires exactly one image.",
      }));
      return null;
    }

    uploadInFlightRef.current = true;
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    updateState((previousState) => ({
      ...previousState,
      isUploading: true,
      selectionMessage: "",
      summary: null,
    }));

    try {
      const groups = splitFilesIntoBatches(
        runnableFileStatuses,
        QC_IMAGE_DIRECT_UPLOAD_CONCURRENCY,
      );
      updateState((previousState) => ({
        ...previousState,
        totalBatches: Math.max(previousState.totalBatches, groups.length),
      }));

      await mapWithConcurrencyLimit(
        runnableFileStatuses,
        QC_IMAGE_DIRECT_UPLOAD_CONCURRENCY,
        async (fileStatus, index) => {
          if (abortController.signal.aborted) return null;

          updateState((previousState) => ({
            ...previousState,
            currentBatchIndex: Math.min(
              groups.length,
              Math.floor(index / QC_IMAGE_DIRECT_UPLOAD_CONCURRENCY) + 1,
            ),
          }));

          return uploadSingleFileWithRetry({
            fileStatus,
            uploadMode: normalizedUploadMode,
            imageType: normalizedImageType,
            comment,
            signal: abortController.signal,
          });
        },
      );
    } finally {
      const latestStatuses = Array.isArray(fileStatusesRef.current)
        ? fileStatusesRef.current
        : stateRef.current.fileStatuses;
      const counts = summarizeFileStatuses(latestStatuses);
      const totalSelectedCount = latestStatuses.length;
      const summary = hasActiveFileStatuses(latestStatuses)
        ? null
        : {
            totalSelectedCount,
            ...counts,
            currentBatchIndex: stateRef.current.currentBatchIndex,
            totalBatches: stateRef.current.totalBatches,
            batchStatuses: stateRef.current.batchStatuses,
            message: createSummaryMessage({
              totalSelectedCount,
              uploadedCount: counts.uploadedCount,
              duplicateCount: counts.duplicateCount,
              failedCount: counts.failedCount,
            }),
          };

      abortControllerRef.current = null;
      uploadInFlightRef.current = false;

      updateState((previousState) => ({
        ...recomputeState(
          {
            ...previousState,
            isUploading: false,
            summary,
          },
          latestStatuses,
        ),
      }));
    }

    const counts = summarizeFileStatuses(fileStatusesRef.current);
    return counts;
  }, [qcId, recomputeState, updateState, uploadSingleFileWithRetry]);

  const startUpload = useCallback(async ({
    uploadMode = "bulk",
    imageType = "qc_images",
    comment = "",
    files = null,
  } = {}) => {
    let nextStatuses = stateRef.current.fileStatuses;

    if (Array.isArray(files)) {
      nextStatuses = createFileStatuses(
        files,
        QC_IMAGE_DIRECT_UPLOAD_CONCURRENCY,
        stateRef.current.fileStatuses,
      );
      revokeRemovedPreviewUrls(stateRef.current.fileStatuses, nextStatuses);
      fileStatusesRef.current = nextStatuses;
      updateState((previousState) =>
        recomputeState(
          {
            ...previousState,
            selectionMessage: "",
            summary: null,
          },
          nextStatuses,
        ),
      );
    }

    const uploadCandidates = nextStatuses.filter((fileStatus) =>
      fileStatus.status === "queued" || fileStatus.status === "failed",
    );

    return runUpload({
      uploadMode,
      imageType,
      comment,
      fileStatusesToUpload: uploadCandidates,
    });
  }, [recomputeState, runUpload, updateState]);

  const retryFailedFiles = useCallback(async ({ uploadMode = "bulk", imageType = "qc_images", comment = "" } = {}) => {
    const retryStatuses = stateRef.current.fileStatuses.filter((fileStatus) => fileStatus.status === "failed");

    if (retryStatuses.length === 0) {
      updateState((previousState) => ({
        ...previousState,
        selectionMessage: "There are no failed QC image uploads to retry.",
      }));
      return null;
    }

    return runUpload({
      uploadMode,
      imageType,
      comment,
      fileStatusesToUpload: retryStatuses,
    });
  }, [runUpload, updateState]);

  const canRetryFailedFiles = useMemo(
    () => state.fileStatuses.some((fileStatus) => fileStatus.status === "failed"),
    [state.fileStatuses],
  );

  const cancelUpload = useCallback(() => {
    uploadInFlightRef.current = false;
    abortControllerRef.current?.abort();
  }, []);

  return {
    state,
    canRetryFailedFiles,
    selectFiles,
    startUpload,
    retryFailedFiles,
    cancelUpload,
    reset,
  };
};

export default useBulkQcImageUpload;
