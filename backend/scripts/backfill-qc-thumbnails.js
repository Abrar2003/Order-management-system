const path = require("path");
const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const QC = require("../models/qc.model");
const {
  getObjectBuffer,
  getObjectUrl,
  isConfigured: isWasabiConfigured,
  objectExists,
  uploadBuffer,
} = require("../services/wasabiStorage.service");
const {
  QC_THUMBNAIL_CACHE_CONTROL,
  buildQcThumbnailStorageKey,
  generateQcImageThumbnail,
} = require("../services/imageThumbnailService");

const IMAGE_FIELDS = Object.freeze(["qc_images", "hardware_inspection", "goods_not_ready_images"]);
const IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_QUERY_MAX_TIME_MS = 60000;
const DEFAULT_HEARTBEAT_MS = 30000;
const DEFAULT_STORAGE_TIMEOUT_MS = 90000;
const MAX_STORAGE_ATTEMPTS = 3;

let shutdownRequested = false;

const normalizeText = (value) => String(value ?? "").trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

process.on("SIGINT", () => {
  if (!shutdownRequested) {
    console.warn("SIGINT received. Finishing in-flight thumbnail work, then exiting.");
  }
  shutdownRequested = true;
});

const getArgValue = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  return arg ? normalizeText(arg.slice(prefix.length)) : fallback;
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

const parsePositiveIntegerArg = (name, fallback, { allowZero = false } = {}) => {
  const rawValue = getArgValue(name, "");
  if (!rawValue) return fallback;

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < (allowZero ? 0 : 1)) {
    return fallback;
  }

  return parsed;
};

const parseDateArg = (name) => {
  const rawValue = getArgValue(name, "");
  if (!rawValue) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    throw new Error(`--${name} must be in YYYY-MM-DD format`);
  }

  const parsed = new Date(`${rawValue}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`--${name} is not a valid date`);
  }

  return parsed;
};

const parseOptions = () => {
  const retryFailed = hasFlag("retry-failed");
  return {
    dryRun: hasFlag("dry-run"),
    limit: parsePositiveIntegerArg("limit", 0, { allowZero: true }),
    concurrency: parsePositiveIntegerArg("concurrency", DEFAULT_CONCURRENCY),
    batchSize: parsePositiveIntegerArg("batch-size", DEFAULT_BATCH_SIZE),
    onlyMissing: hasFlag("only-missing") || !retryFailed,
    retryFailed,
    inspectionId: getArgValue("inspection-id", ""),
    fromDate: parseDateArg("from-date"),
    verbose: hasFlag("verbose"),
    delayMs: parsePositiveIntegerArg("delay-ms", 0, { allowZero: true }),
    batchDelayMs: parsePositiveIntegerArg("batch-delay-ms", 0, { allowZero: true }),
    queryMaxTimeMs: parsePositiveIntegerArg("query-max-time-ms", DEFAULT_QUERY_MAX_TIME_MS, { allowZero: true }),
    heartbeatMs: parsePositiveIntegerArg("heartbeat-ms", DEFAULT_HEARTBEAT_MS, { allowZero: true }),
    storageTimeoutMs: parsePositiveIntegerArg("storage-timeout-ms", DEFAULT_STORAGE_TIMEOUT_MS, { allowZero: true }),
  };
};

const buildMissingThumbnailPredicate = (retryFailed = false) => {
  const missingOrEmpty = (field) => [
    { [field]: { $exists: false } },
    { [field]: null },
    { [field]: "" },
  ];

  const predicates = [
    ...missingOrEmpty("thumbnail_key"),
    ...missingOrEmpty("thumbnail_url"),
  ];

  if (retryFailed) {
    predicates.push({ thumbnail_status: "failed" });
  }

  return {
    key: { $exists: true, $ne: "" },
    $or: predicates,
  };
};

const buildQcQuery = (options) => {
  const candidatePredicate = buildMissingThumbnailPredicate(options.retryFailed);
  const andConditions = [
    {
      $or: IMAGE_FIELDS.map((field) => ({
        [field]: { $elemMatch: candidatePredicate },
      })),
    },
  ];

  if (options.inspectionId) {
    if (!mongoose.Types.ObjectId.isValid(options.inspectionId)) {
      throw new Error("--inspection-id must be a valid Mongo ObjectId");
    }

    const objectId = new mongoose.Types.ObjectId(options.inspectionId);
    andConditions.push({
      $or: [
        { _id: objectId },
        { inspection_record: objectId },
      ],
    });
  }

  if (options.fromDate) {
    andConditions.push({
      $or: [
        { "qc_images.uploadedAt": { $gte: options.fromDate } },
        { "hardware_inspection.uploadedAt": { $gte: options.fromDate } },
        { "goods_not_ready_images.uploadedAt": { $gte: options.fromDate } },
        { createdAt: { $gte: options.fromDate } },
      ],
    });
  }

  return andConditions.length === 1 ? andConditions[0] : { $and: andConditions };
};

const isImageRecord = (image = {}) => {
  const sourceKey = normalizeText(image?.key || image?.public_id || "");
  if (!sourceKey) return false;

  const contentType = normalizeLower(image?.contentType);
  const extension = path.posix.extname(
    normalizeLower(sourceKey || image?.originalName || ""),
  );

  return IMAGE_CONTENT_TYPES.has(contentType) || IMAGE_EXTENSIONS.has(extension);
};

const isThumbnailCandidate = (image = {}, options = {}) => {
  if (!isImageRecord(image)) return false;

  const status = normalizeLower(image?.thumbnail_status);
  const thumbnailKey = normalizeText(image?.thumbnail_key);
  const thumbnailUrl = normalizeText(image?.thumbnail_url);

  if (status === "failed" && !options.retryFailed) {
    return false;
  }

  if (options.retryFailed && status === "failed") {
    return true;
  }

  return !thumbnailKey || !thumbnailUrl;
};

const toConciseError = (error) =>
  normalizeText(error?.message || String(error)).replace(/\s+/g, " ").slice(0, 300);

const getDownloadedBuffer = (payload) => {
  if (Buffer.isBuffer(payload)) {
    return payload;
  }

  if (Buffer.isBuffer(payload?.buffer)) {
    return payload.buffer;
  }

  if (payload?.buffer instanceof ArrayBuffer) {
    return Buffer.from(payload.buffer);
  }

  if (ArrayBuffer.isView(payload?.buffer)) {
    return Buffer.from(
      payload.buffer.buffer,
      payload.buffer.byteOffset,
      payload.buffer.byteLength,
    );
  }

  return null;
};

const withTimeout = async (operation, timeoutMs, label = "operation") => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return operation();
  }

  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  });

  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const withStorageRetry = async (operation, label = "storage operation", options = {}) => {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_STORAGE_ATTEMPTS; attempt += 1) {
    try {
      return await withTimeout(
        () => operation(attempt),
        options.storageTimeoutMs,
        label,
      );
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_STORAGE_ATTEMPTS) break;
      const delayMs = 500 * (2 ** (attempt - 1));
      console.warn(`${label} failed; retrying in ${delayMs}ms`, {
        attempt,
        error: toConciseError(error),
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
};

const buildImageUpdateFilter = (ref) => {
  const imageId = normalizeText(ref?.image?._id);
  const sourceKey = normalizeText(ref?.image?.key || ref?.image?.public_id || "");

  if (mongoose.Types.ObjectId.isValid(imageId)) {
    const objectId = new mongoose.Types.ObjectId(imageId);
    return {
      filter: {
        _id: ref.qcId,
        [`${ref.field}._id`]: objectId,
      },
      options: {
        arrayFilters: [{ "image._id": objectId }],
      },
    };
  }

  return {
    filter: {
      _id: ref.qcId,
      [`${ref.field}.key`]: sourceKey,
    },
    options: {
      arrayFilters: [{ "image.key": sourceKey }],
    },
  };
};

const updateThumbnailSuccess = async (ref, metadata, { incrementAttempts = false } = {}) => {
  const { filter, options } = buildImageUpdateFilter(ref);
  const update = {
    $set: {
      [`${ref.field}.$[image].thumbnail_key`]: metadata.thumbnail_key,
      [`${ref.field}.$[image].thumbnail_url`]: metadata.thumbnail_url,
      [`${ref.field}.$[image].thumbnail_generated_at`]: metadata.thumbnail_generated_at,
      [`${ref.field}.$[image].thumbnail_status`]: "completed",
      [`${ref.field}.$[image].thumbnail_error`]: "",
    },
  };

  if (incrementAttempts) {
    update.$inc = {
      [`${ref.field}.$[image].thumbnail_attempts`]: 1,
    };
  }

  return QC.updateOne(filter, update, options);
};

const updateThumbnailFailure = async (ref, error) => {
  const { filter, options } = buildImageUpdateFilter(ref);
  return QC.updateOne(
    filter,
    {
      $set: {
        [`${ref.field}.$[image].thumbnail_status`]: "failed",
        [`${ref.field}.$[image].thumbnail_error`]: toConciseError(error),
      },
      $inc: {
        [`${ref.field}.$[image].thumbnail_attempts`]: 1,
      },
    },
    options,
  );
};

const logVerbose = (options, message, payload = {}) => {
  if (!options.verbose) return;
  console.log(message, payload);
};

const elapsedSeconds = (startedAt) => ((Date.now() - startedAt) / 1000).toFixed(1);

const withHeartbeat = async (operation, options, label, getPayload = () => ({})) => {
  const startedAt = Date.now();
  let timer = null;

  if (options.heartbeatMs > 0) {
    timer = setInterval(() => {
      console.log("[heartbeat]", {
        operation: label,
        elapsed_seconds: elapsedSeconds(startedAt),
        ...getPayload(),
      });
    }, options.heartbeatMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  try {
    return await operation();
  } finally {
    if (timer) {
      clearInterval(timer);
    }
  }
};

const processImageRef = async (ref, options, stats) => {
  const sourceKey = normalizeText(ref?.image?.key || ref?.image?.public_id || "");
  const thumbnailKey =
    normalizeText(ref?.image?.thumbnail_key) ||
    buildQcThumbnailStorageKey(sourceKey);

  try {
    const thumbnailAlreadyExists = await withStorageRetry(
      () => objectExists(thumbnailKey),
      "thumbnail HEAD",
      options,
    );

    if (thumbnailAlreadyExists) {
      const metadata = {
        thumbnail_key: thumbnailKey,
        thumbnail_url: getObjectUrl(thumbnailKey),
        thumbnail_generated_at: ref?.image?.thumbnail_generated_at || new Date(),
      };

      if (!options.dryRun) {
        await updateThumbnailSuccess(ref, metadata);
      }

      stats.alreadyExisted += 1;
      logVerbose(options, "[thumbnail-exists]", {
        qc_id: String(ref.qcId),
        field: ref.field,
        source_key: sourceKey,
        thumbnail_key: thumbnailKey,
        dry_run: options.dryRun,
      });
      return;
    }

    if (options.dryRun) {
      logVerbose(options, "[dry-run-would-generate]", {
        qc_id: String(ref.qcId),
        field: ref.field,
        source_key: sourceKey,
        thumbnail_key: thumbnailKey,
      });
      return;
    }

    const sourceObject = await withStorageRetry(
      () => getObjectBuffer(sourceKey),
      "source image download",
      options,
    );
    const thumbnail = await generateQcImageThumbnail({
      sourceBuffer: getDownloadedBuffer(sourceObject),
    });

    await withStorageRetry(
      () =>
        uploadBuffer({
          buffer: thumbnail.buffer,
          key: thumbnailKey,
          originalName: path.posix.basename(thumbnailKey),
          contentType: thumbnail.contentType,
          cacheControl: QC_THUMBNAIL_CACHE_CONTROL,
        }),
      "thumbnail upload",
      options,
    );

    await updateThumbnailSuccess(
      ref,
      {
        thumbnail_key: thumbnailKey,
        thumbnail_url: getObjectUrl(thumbnailKey),
        thumbnail_generated_at: new Date(),
      },
      { incrementAttempts: true },
    );

    stats.generated += 1;
    logVerbose(options, "[generated]", {
      qc_id: String(ref.qcId),
      field: ref.field,
      source_key: sourceKey,
      thumbnail_key: thumbnailKey,
      thumbnail_size: thumbnail.size,
      thumbnail_width: thumbnail.width,
      thumbnail_height: thumbnail.height,
    });
  } catch (error) {
    stats.failed += 1;
    if (!options.dryRun) {
      await updateThumbnailFailure(ref, error).catch((updateError) => {
        console.error("[failure-update-failed]", {
          qc_id: String(ref.qcId),
          field: ref.field,
          source_key: sourceKey,
          error: toConciseError(updateError),
        });
      });
    }

    console.error("[failed]", {
      qc_id: String(ref.qcId),
      field: ref.field,
      source_key: sourceKey,
      error: toConciseError(error),
    });
  } finally {
    if (options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }
};

const processBatch = async (batch, options, stats) => {
  if (batch.length === 0) return;

  const batchNumber = stats.batchesProcessed + 1;
  const startedAt = Date.now();
  let nextIndex = 0;
  const workerCount = Math.min(options.concurrency, batch.length);

  console.log("[batch-start]", {
    batch: batchNumber,
    images: batch.length,
    concurrency: workerCount,
    generated: stats.generated,
    already_existed: stats.alreadyExisted,
    failed: stats.failed,
  });

  const workers = Array.from({ length: workerCount }, async () => {
    while (!shutdownRequested) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= batch.length) return;
      await processImageRef(batch[currentIndex], options, stats);
    }
  });

  await withHeartbeat(
    () => Promise.all(workers),
    options,
    "thumbnail_batch",
    () => ({
      batch: batchNumber,
      images: batch.length,
      next_index: Math.min(nextIndex, batch.length),
      generated: stats.generated,
      already_existed: stats.alreadyExisted,
      failed: stats.failed,
    }),
  );
  stats.batchesProcessed += 1;

  console.log("[batch-complete]", {
    batch: batchNumber,
    images: batch.length,
    elapsed_seconds: elapsedSeconds(startedAt),
    generated: stats.generated,
    already_existed: stats.alreadyExisted,
    failed: stats.failed,
  });

  if (options.batchDelayMs > 0 && !shutdownRequested) {
    await sleep(options.batchDelayMs);
  }
};

const collectCandidatesFromDoc = (doc, options, stats) => {
  const candidates = [];

  for (const field of IMAGE_FIELDS) {
    const images = Array.isArray(doc?.[field]) ? doc[field] : [];
    for (const image of images) {
      stats.scanned += 1;

      if (!isImageRecord(image)) {
        stats.skipped += 1;
        continue;
      }

      if (!isThumbnailCandidate(image, options)) {
        stats.skipped += 1;
        continue;
      }

      candidates.push({
        qcId: doc._id,
        field,
        image,
      });
    }
  }

  return candidates;
};

const printStats = (stats) => {
  const elapsedMs = Date.now() - stats.startedAt;
  const elapsedSeconds = (elapsedMs / 1000).toFixed(1);

  console.log("QC thumbnail backfill complete.");
  console.log(`docs: ${stats.docs}`);
  console.log(`pages: ${stats.pages}`);
  console.log(`scanned: ${stats.scanned}`);
  console.log(`eligible: ${stats.eligible}`);
  console.log(`skipped: ${stats.skipped}`);
  console.log(`batches: ${stats.batchesProcessed}`);
  console.log(`generated: ${stats.generated}`);
  console.log(`already-existed: ${stats.alreadyExisted}`);
  console.log(`failed: ${stats.failed}`);
  console.log(`elapsed time: ${elapsedSeconds}s`);
};

const withPaginationAfterId = (baseQuery, lastSeenId) => {
  if (!lastSeenId) {
    return baseQuery;
  }

  return {
    $and: [
      baseQuery,
      { _id: { $gt: lastSeenId } },
    ],
  };
};

const main = async () => {
  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
  });

  const options = parseOptions();
  if (!isWasabiConfigured()) {
    throw new Error("Wasabi storage is not configured");
  }

  await connectDB();

  const stats = {
    startedAt: Date.now(),
    docs: 0,
    pages: 0,
    scanned: 0,
    eligible: 0,
    skipped: 0,
    batchesProcessed: 0,
    generated: 0,
    alreadyExisted: 0,
    failed: 0,
  };
  const query = buildQcQuery(options);
  let batch = [];
  let reachedLimit = false;
  let lastSeenId = null;

  console.log("QC thumbnail backfill starting.", {
    dry_run: options.dryRun,
    limit: options.limit || "none",
    concurrency: options.concurrency,
    batch_size: options.batchSize,
    only_missing: options.onlyMissing,
    retry_failed: options.retryFailed,
    inspection_id: options.inspectionId || "",
    from_date: options.fromDate ? options.fromDate.toISOString().slice(0, 10) : "",
    query_max_time_ms: options.queryMaxTimeMs || "none",
    heartbeat_ms: options.heartbeatMs || "off",
    storage_timeout_ms: options.storageTimeoutMs || "none",
  });

  while (!shutdownRequested && !reachedLimit) {
    const page = stats.pages + 1;
    const pageStartedAt = Date.now();
    let pageQuery = QC.find(withPaginationAfterId(query, lastSeenId))
      .select("_id qc_images hardware_inspection goods_not_ready_images inspection_record createdAt")
      .sort({ _id: 1 })
      .limit(options.batchSize);

    if (options.queryMaxTimeMs > 0) {
      pageQuery = pageQuery.maxTimeMS(options.queryMaxTimeMs);
    }

    const docs = await withHeartbeat(
      () => pageQuery.lean(),
      options,
      "qc_page_query",
      () => ({
        page,
        last_seen_id: lastSeenId ? String(lastSeenId) : "",
      }),
    );

    stats.pages += 1;
    stats.docs += docs.length;

    console.log("[page]", {
      page,
      docs: docs.length,
      queued_images: batch.length,
      scanned_images: stats.scanned,
      eligible: stats.eligible,
      generated: stats.generated,
      already_existed: stats.alreadyExisted,
      failed: stats.failed,
      elapsed_seconds: elapsedSeconds(pageStartedAt),
    });

    if (docs.length === 0) {
      break;
    }

    for (const doc of docs) {
      lastSeenId = doc._id;
      if (shutdownRequested) break;

      const candidates = collectCandidatesFromDoc(doc, options, stats);
      for (const candidate of candidates) {
        if (options.limit > 0 && stats.eligible >= options.limit) {
          reachedLimit = true;
          break;
        }

        stats.eligible += 1;
        batch.push(candidate);

        if (batch.length >= options.batchSize) {
          await processBatch(batch, options, stats);
          batch = [];
        }

        if (shutdownRequested) break;
      }

      if (reachedLimit) break;
    }

    if (docs.length < options.batchSize) {
      break;
    }
  }

  if (batch.length > 0) {
    await processBatch(batch, options, stats);
  }

  printStats(stats);
  if (shutdownRequested) {
    process.exitCode = 130;
  }
};

main()
  .catch((error) => {
    console.error("QC thumbnail backfill failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
