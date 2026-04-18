import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  MAX_QC_IMAGE_UPLOAD_COUNT,
  QC_IMAGE_BATCH_SIZE,
  getQcImageFileSignature,
  isSupportedQcImageFile,
  normalizeQcImageBatchSummary,
  splitFilesIntoBatches,
  uploadQcImageBatch,
} from "../services/qcImages.service";

const createInitialState = () => ({
  isUploading: false,
  selectedFiles: [],
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

const normalizeFileName = (value) => normalizeText(value).toLowerCase();

const normalizeFileBaseName = (value) =>
  normalizeFileName(value).replace(/\.[^.]+$/, "");

const isAbortError = (error) =>
  error?.code === "ERR_CANCELED" || axios.isCancel?.(error) === true;

const isRetryableUploadError = (error) => {
  if (isAbortError(error)) return false;

  const status = Number(error?.response?.status || 0);
  if (!error?.response) return true;
  if (status >= 500) return true;

  const errorCode = normalizeText(error?.code).toUpperCase();
  if (errorCode === "ECONNABORTED") return true;

  const message = normalizeText(error?.message).toLowerCase();
  return message.includes("network") || message.includes("timeout");
};

const waitWithSignal = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Upload cancelled"));
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (abortHandler) {
        signal?.removeEventListener("abort", abortHandler);
      }
      resolve();
    }, ms);

    const abortHandler = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortHandler);
      reject(new Error("Upload cancelled"));
    };

    signal?.addEventListener("abort", abortHandler, { once: true });
  });

const mergeUniqueFiles = (files = []) =>
  Array.from(
    new Map(
      (Array.isArray(files) ? files : [])
        .filter(Boolean)
        .map((file) => [getQcImageFileSignature(file), file]),
    ).values(),
  );

const createPendingBatchStatuses = (files = [], batchSize = QC_IMAGE_BATCH_SIZE) =>
  splitFilesIntoBatches(files, batchSize).map((batchFiles, index) => ({
    batchId: `batch-${index + 1}`,
    batchNumber: index + 1,
    fileCount: batchFiles.length,
    fileNames: batchFiles.map((file) => normalizeText(file?.name)).filter(Boolean),
    files: batchFiles,
    status: "pending",
    progressPercent: 0,
    uploadedCount: 0,
    duplicateCount: 0,
    failedCount: 0,
    failures: [],
    skippedDuplicates: [],
    attempts: 0,
    message: "",
    errorMessage: "",
    retryFiles: [],
  }));

const computeOverallProgress = (batchStatuses = []) => {
  if (!Array.isArray(batchStatuses) || batchStatuses.length === 0) {
    return 0;
  }

  const totalProgress = batchStatuses.reduce(
    (sum, batchStatus) => sum + Math.max(0, Math.min(100, Number(batchStatus?.progressPercent || 0))),
    0,
  );

  return Math.max(0, Math.min(100, Math.round(totalProgress / batchStatuses.length)));
};

const mapFailuresToFiles = (batchFiles = [], failures = []) => {
  const remainingFiles = [...(Array.isArray(batchFiles) ? batchFiles : [])];
  const matchedFiles = [];

  (Array.isArray(failures) ? failures : []).forEach((failure) => {
    const failureName = normalizeFileName(failure?.originalName);
    const failureBaseName = normalizeFileBaseName(failure?.originalName);

    let matchIndex = remainingFiles.findIndex(
      (file) => normalizeFileName(file?.name) === failureName,
    );

    if (matchIndex < 0 && failureBaseName) {
      matchIndex = remainingFiles.findIndex(
        (file) => normalizeFileBaseName(file?.name) === failureBaseName,
      );
    }

    if (matchIndex >= 0) {
      matchedFiles.push(remainingFiles[matchIndex]);
      remainingFiles.splice(matchIndex, 1);
    }
  });

  return matchedFiles;
};

const createSummaryMessage = ({
  totalSelectedCount = 0,
  uploadedCount = 0,
  duplicateCount = 0,
  failedCount = 0,
} = {}) => {
  if (uploadedCount > 0) {
    let message = `${uploadedCount} of ${totalSelectedCount} image${totalSelectedCount === 1 ? "" : "s"} uploaded successfully`;
    if (duplicateCount > 0) {
      message += `. ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} skipped`;
    }
    if (failedCount > 0) {
      message += `. ${failedCount} file${failedCount === 1 ? "" : "s"} still need attention`;
    }
    return `${message}.`;
  }

  if (duplicateCount > 0 && failedCount === 0) {
    return "All selected images were duplicates and were skipped.";
  }

  if (failedCount > 0) {
    return `${failedCount} file${failedCount === 1 ? "" : "s"} still failed after batching.`;
  }

  return "No QC image batches have been uploaded yet.";
};

export const useBulkQcImageUpload = ({
  qcId = "",
  batchSize = QC_IMAGE_BATCH_SIZE,
  maxFiles = MAX_QC_IMAGE_UPLOAD_COUNT,
} = {}) => {
  const [state, setState] = useState(createInitialState);
  const stateRef = useRef(state);
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef(null);
  const uploadInFlightRef = useRef(false);

  const updateState = useCallback((updater) => {
    if (!isMountedRef.current) return;

    setState((previousState) => {
      const nextState =
        typeof updater === "function"
          ? updater(previousState)
          : { ...previousState, ...updater };
      stateRef.current = nextState;
      return nextState;
    });
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => () => {
    isMountedRef.current = false;
    uploadInFlightRef.current = false;
    abortControllerRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    uploadInFlightRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    updateState(createInitialState());
  }, [updateState]);

  const selectFiles = useCallback((rawFiles = [], { uploadMode = "bulk" } = {}) => {
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

    if (validFiles.length > maxFiles) {
      validFiles = validFiles.slice(0, maxFiles);
      messages.push(`Only the first ${maxFiles} images were kept.`);
    }

    const pendingBatchStatuses = createPendingBatchStatuses(validFiles, batchSize);

    updateState((previousState) => ({
      ...previousState,
      selectedFiles: validFiles,
      batchStatuses: pendingBatchStatuses,
      currentBatchIndex: validFiles.length > 0 ? 1 : 0,
      totalBatches: pendingBatchStatuses.length,
      progressPercent: 0,
      uploadedCount: 0,
      duplicateCount: 0,
      failedCount: 0,
      failedFiles: [],
      optimizedCount: 0,
      bytesSaved: 0,
      summary: null,
      selectionMessage:
        messages.join(" ")
        || (validFiles.length > 0
          ? `${validFiles.length} image${validFiles.length === 1 ? "" : "s"} ready to upload in ${pendingBatchStatuses.length} batch${pendingBatchStatuses.length === 1 ? "" : "es"}.`
          : "No valid QC images selected."),
    }));

    return {
      files: validFiles,
      invalidFiles,
      message: messages.join(" "),
    };
  }, [batchSize, maxFiles, updateState]);

  const setBatchStatus = useCallback((batchIndex, updater) => {
    updateState((previousState) => {
      const nextBatchStatuses = previousState.batchStatuses.map((batchStatus, index) => {
        if (index !== batchIndex) return batchStatus;
        return typeof updater === "function" ? updater(batchStatus) : { ...batchStatus, ...updater };
      });

      return {
        ...previousState,
        batchStatuses: nextBatchStatuses,
        progressPercent: computeOverallProgress(nextBatchStatuses),
      };
    });
  }, [updateState]);

  const uploadBatchWithRetry = useCallback(async ({
    batchFiles,
    uploadMode,
    comment,
    signal,
    onUploadProgress,
  }) => {
    let attempts = 0;

    while (attempts < 2) {
      attempts += 1;
      try {
        const response = await uploadQcImageBatch({
          qcId,
          files: batchFiles,
          uploadMode,
          comment,
          signal,
          onUploadProgress,
        });

        return { response, attempts };
      } catch (error) {
        if (isAbortError(error) || !isRetryableUploadError(error) || attempts >= 2) {
          throw Object.assign(error, { attempts });
        }

        await waitWithSignal(800 * attempts, signal);
      }
    }

    throw new Error("QC image batch upload failed");
  }, [qcId]);

  const startUpload = useCallback(async ({
    uploadMode = "bulk",
    comment = "",
    files = null,
  } = {}) => {
    if (stateRef.current.isUploading || uploadInFlightRef.current) return null;

    const normalizedUploadMode = normalizeText(uploadMode).toLowerCase() || "bulk";
    const filesToUpload = mergeUniqueFiles(
      Array.isArray(files) ? files : stateRef.current.selectedFiles,
    );

    if (!normalizeText(qcId)) {
      updateState((previousState) => ({
        ...previousState,
        selectionMessage: "QC record id is missing for image upload.",
      }));
      return null;
    }

    if (filesToUpload.length === 0) {
      updateState((previousState) => ({
        ...previousState,
        selectionMessage: "Select at least one QC image before uploading.",
      }));
      return null;
    }

    if (normalizedUploadMode === "single" && filesToUpload.length !== 1) {
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

    const pendingBatchStatuses = createPendingBatchStatuses(filesToUpload, batchSize);
    const failedFilesMap = new Map();
    let uploadedCount = stateRef.current.summary?.uploadedCount || 0;
    let duplicateCount = stateRef.current.summary?.duplicateCount || 0;
    let optimizedCount = stateRef.current.summary?.optimizedCount || 0;
    let bytesSaved = stateRef.current.summary?.bytesSaved || 0;

    updateState((previousState) => ({
      ...previousState,
      isUploading: true,
      selectedFiles:
        previousState.selectedFiles.length > 0
          ? previousState.selectedFiles
          : filesToUpload,
      batchStatuses: pendingBatchStatuses,
      currentBatchIndex: pendingBatchStatuses.length > 0 ? 1 : 0,
      totalBatches: pendingBatchStatuses.length,
      progressPercent: 0,
      failedCount: 0,
      failedFiles: [],
      selectionMessage: "",
      summary: previousState.summary
        ? {
          ...previousState.summary,
          failedCount: 0,
          failedFiles: [],
        }
        : null,
    }));

    try {
      for (let batchIndex = 0; batchIndex < pendingBatchStatuses.length; batchIndex += 1) {
        const batchStatus = pendingBatchStatuses[batchIndex];
        const batchFiles = batchStatus.files;

        updateState((previousState) => ({
          ...previousState,
          currentBatchIndex: batchIndex + 1,
        }));

        setBatchStatus(batchIndex, (currentBatchStatus) => ({
          ...currentBatchStatus,
          status: "uploading",
          attempts: currentBatchStatus.attempts + 1,
          progressPercent: Math.max(3, currentBatchStatus.progressPercent || 0),
          errorMessage: "",
          message: "",
        }));

        try {
          const { response, attempts } = await uploadBatchWithRetry({
            batchFiles,
            uploadMode: normalizedUploadMode,
            comment,
            signal: abortController.signal,
            onUploadProgress: (progressEvent) => {
              if (abortController.signal.aborted) return;

              const total = Number(progressEvent?.total || 0);
              const loaded = Number(progressEvent?.loaded || 0);
              const percent = total > 0
                ? Math.round((loaded / total) * 100)
                : Math.min(95, Math.max(10, loaded > 0 ? 25 : 10));

              setBatchStatus(batchIndex, (currentBatchStatus) => ({
                ...currentBatchStatus,
                progressPercent: Math.max(
                  currentBatchStatus.status === "uploading" ? 3 : 0,
                  Math.min(percent, 95),
                ),
              }));
            },
          });

          const normalizedSummary = normalizeQcImageBatchSummary(response?.data);
          const retryFiles = normalizedSummary.failedCount > 0
            ? (mapFailuresToFiles(batchFiles, normalizedSummary.failures).length > 0
              ? mapFailuresToFiles(batchFiles, normalizedSummary.failures)
              : batchFiles)
            : [];

          uploadedCount += normalizedSummary.uploadedCount;
          duplicateCount += normalizedSummary.skippedDuplicateCount;
          optimizedCount += normalizedSummary.optimizedCount;
          bytesSaved += normalizedSummary.bytesSaved;

          retryFiles.forEach((file, index) => {
            const failureEntry =
              normalizedSummary.failures[index]
              || normalizedSummary.failures.find(
                (failure) =>
                  normalizeFileName(failure?.originalName) === normalizeFileName(file?.name),
              )
              || {
                originalName: normalizeText(file?.name),
                reason: "Batch reported a failed file.",
              };
            failedFilesMap.set(getQcImageFileSignature(file), failureEntry);
          });

          batchFiles.forEach((file) => {
            if (!retryFiles.some(
              (retryFile) => getQcImageFileSignature(retryFile) === getQcImageFileSignature(file),
            )) {
              failedFilesMap.delete(getQcImageFileSignature(file));
            }
          });

          setBatchStatus(batchIndex, (currentBatchStatus) => ({
            ...currentBatchStatus,
            status: normalizedSummary.failedCount > 0 ? "partial" : "success",
            attempts,
            progressPercent: 100,
            uploadedCount: normalizedSummary.uploadedCount,
            duplicateCount: normalizedSummary.skippedDuplicateCount,
            failedCount: normalizedSummary.failedCount,
            failures: normalizedSummary.failures,
            skippedDuplicates: normalizedSummary.skippedDuplicates,
            retryFiles,
            message: normalizedSummary.message,
            errorMessage: "",
          }));
        } catch (error) {
          if (isAbortError(error) || abortController.signal.aborted) {
            return null;
          }

          const attempts = Math.max(1, Number(error?.attempts || 1));
          const fallbackFailures = batchFiles.map((file) => ({
            originalName: normalizeText(file?.name) || "unknown-file",
            reason:
              error?.response?.data?.message
              || error?.message
              || "Batch request failed before the server returned a summary.",
            stage: "request",
          }));

          batchFiles.forEach((file, index) => {
            failedFilesMap.set(
              getQcImageFileSignature(file),
              fallbackFailures[index],
            );
          });

          setBatchStatus(batchIndex, (currentBatchStatus) => ({
            ...currentBatchStatus,
            status: "failed",
            attempts,
            progressPercent: 100,
            uploadedCount: 0,
            duplicateCount: 0,
            failedCount: batchFiles.length,
            failures: fallbackFailures,
            skippedDuplicates: [],
            retryFiles: batchFiles,
            message: "",
            errorMessage:
              error?.response?.data?.message
              || error?.message
              || "Batch upload failed.",
          }));
        }
      }
    } finally {
      const batchStatuses = stateRef.current.batchStatuses;
      const failedFiles = Array.from(failedFilesMap.values());
      const summary = {
        totalSelectedCount:
          stateRef.current.summary?.totalSelectedCount
          || stateRef.current.selectedFiles.length
          || filesToUpload.length,
        uploadedCount,
        duplicateCount,
        failedCount: failedFiles.length,
        failedFiles,
        optimizedCount,
        bytesSaved,
        currentBatchIndex: stateRef.current.currentBatchIndex,
        totalBatches: stateRef.current.totalBatches,
        batchStatuses,
        message: createSummaryMessage({
          totalSelectedCount:
            stateRef.current.summary?.totalSelectedCount
            || stateRef.current.selectedFiles.length
            || filesToUpload.length,
          uploadedCount,
          duplicateCount,
          failedCount: failedFiles.length,
        }),
      };

      abortControllerRef.current = null;
      uploadInFlightRef.current = false;

      updateState((previousState) => ({
        ...previousState,
        isUploading: false,
        progressPercent: computeOverallProgress(previousState.batchStatuses),
        uploadedCount,
        duplicateCount,
        failedCount: failedFiles.length,
        failedFiles,
        optimizedCount,
        bytesSaved,
        summary,
      }));
    }

    return {
      uploadedCount,
      duplicateCount,
      failedCount: failedFilesMap.size,
      failedFiles: Array.from(failedFilesMap.values()),
      optimizedCount,
      bytesSaved,
    };
  }, [batchSize, qcId, setBatchStatus, updateState, uploadBatchWithRetry]);

  const retryFailedFiles = useCallback(async ({ uploadMode = "bulk", comment = "" } = {}) => {
    const retryFiles = mergeUniqueFiles(
      stateRef.current.batchStatuses.flatMap((batchStatus) => batchStatus.retryFiles || []),
    );

    if (retryFiles.length === 0) {
      updateState((previousState) => ({
        ...previousState,
        selectionMessage: "There are no failed QC image batches to retry.",
      }));
      return null;
    }

    return startUpload({
      uploadMode,
      comment,
      files: retryFiles,
    });
  }, [startUpload, updateState]);

  const canRetryFailedFiles = useMemo(
    () =>
      state.batchStatuses.some(
        (batchStatus) => Array.isArray(batchStatus.retryFiles) && batchStatus.retryFiles.length > 0,
      ),
    [state.batchStatuses],
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
