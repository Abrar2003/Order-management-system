const fs = require("fs/promises");
const path = require("path");
const { Worker } = require("bullmq");

const Order = require("../models/order.model");
const Item = require("../models/item.model");
const { getRedisConnectionOptions, isRedisJobsEnabled } = require("../config/redis");
const {
  QUEUE_NAMES,
  getQueues,
} = require("../queues");
const JOB_NAMES = require("../queues/jobNames");
const {
  applyTotalPoCbmToOrder,
  backfillTotalPoCbmForOrders,
} = require("../services/orderCbm.service");
const {
  syncOrderGroup,
  purgeOmsEventsForConfiguredBrandCalendars,
} = require("../services/gcalSync");
const { convertExcelToPdf } = require("../services/convertXlsxToPDF.service");
const {
  isConfigured: isWasabiConfigured,
  createStorageKey,
  uploadBuffer,
  deleteObject,
} = require("../services/wasabiStorage.service");
const {
  invalidateOrderCaches,
  invalidateItemCaches,
} = require("../services/cacheInvalidation.service");

const ACTIVE_ORDER_MATCH = {
  $and: [{ archived: { $ne: true } }, { status: { $ne: "Cancelled" } }],
};

let workers = [];
const workerLogAt = new Map();

const normalizeText = (value) => String(value ?? "").trim();

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const logThrottled = (key, level, message, payload = {}, intervalMs = 60000) => {
  const now = Date.now();
  const previous = Number(workerLogAt.get(key) || 0);
  if (previous && now - previous < intervalMs) return;
  workerLogAt.set(key, now);

  const logger = console[level] || console.log;
  logger(message, payload);
};

const sanitizeBaseFilename = (value = "", fallback = "file") => {
  const safeValue = normalizeText(value)
    .replace(/\.[^.]+$/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return safeValue || fallback;
};

const buildPisPdfOriginalName = ({
  spreadsheetOriginalName = "",
  itemCode = "",
  itemId = "",
} = {}) => {
  const fallbackName = sanitizeBaseFilename(itemCode || itemId || "item-pis", "item-pis");
  const spreadsheetBaseName = sanitizeBaseFilename(
    path.parse(path.basename(spreadsheetOriginalName || fallbackName)).name,
    fallbackName,
  );

  return `${spreadsheetBaseName}.pdf`;
};

const buildStoredWasabiFile = (file = {}) => ({
  key: normalizeText(file?.key),
  originalName: normalizeText(file?.originalName),
  contentType: normalizeText(file?.contentType),
  size: Number(file?.size || 0),
  link: normalizeText(file?.url || file?.link),
  public_id: normalizeText(file?.public_id || file?.key),
});

const safeDeleteFile = async (filePath = "") => {
  const normalizedPath = normalizeText(filePath);
  if (!normalizedPath) return;
  await fs.rm(normalizedPath, { force: true }).catch(() => {});
};

const withTimeout = (promise, timeoutMs, label = "operation") =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

const processSingleOrderCbmRecalc = async (job) => {
  const orderId = normalizeText(job.data?.orderId);
  if (!orderId) {
    throw new Error("orderId is required");
  }

  const order = await Order.findById(orderId);
  if (!order) {
    return { skipped: true, reason: "order_not_found", orderId };
  }

  const result = await applyTotalPoCbmToOrder(order);
  if (result.changed) {
    await order.save();
  }
  await invalidateOrderCaches();

  return {
    orderId,
    changed: Boolean(result.changed),
    total_po_cbm: order.total_po_cbm,
    reason: result.reason,
  };
};

const processAllOrderCbmRecalc = async (job) => {
  await job.updateProgress(5);
  const summary = await backfillTotalPoCbmForOrders({
    batchSize: parsePositiveInt(job.data?.batchSize, 500),
    dryRun: Boolean(job.data?.dryRun),
  });
  await job.updateProgress(95);
  await invalidateOrderCaches();
  await job.updateProgress(100);
  return summary;
};

const processCalendarGroupSync = async (job) => {
  const group = {
    order_id: normalizeText(job.data?.order_id),
    brand: normalizeText(job.data?.brand),
    vendor: normalizeText(job.data?.vendor),
  };

  if (!group.order_id || !group.brand || !group.vendor) {
    throw new Error("order_id, brand, and vendor are required");
  }

  const result = await syncOrderGroup(group);
  await invalidateOrderCaches();
  return { group, result };
};

const processCalendarResync = async (job) => {
  const brand = normalizeText(job.data?.brand);
  const batchSize = Math.min(20, parsePositiveInt(job.data?.batchSize, 5));
  const timeoutMs = Math.min(1200000, parsePositiveInt(job.data?.timeoutMs, 300000));
  const activeMatch = brand
    ? { ...ACTIVE_ORDER_MATCH, brand }
    : ACTIVE_ORDER_MATCH;

  let purge = null;
  if (!brand) {
    purge = await withTimeout(
      purgeOmsEventsForConfiguredBrandCalendars(),
      timeoutMs,
      "purge existing OMS calendar events",
    );
  }

  await Order.updateMany(activeMatch, {
    $set: {
      "gcal.calendarId": null,
      "gcal.eventId": null,
      "gcal.lastSyncedAt": null,
      "gcal.lastSyncError": null,
    },
  });

  const groups = await Order.aggregate([
    { $match: activeMatch },
    {
      $group: {
        _id: { order_id: "$order_id", brand: "$brand", vendor: "$vendor" },
      },
    },
    {
      $project: {
        _id: 0,
        order_id: "$_id.order_id",
        brand: "$_id.brand",
        vendor: "$_id.vendor",
      },
    },
    { $sort: { order_id: 1, brand: 1, vendor: 1 } },
  ]);

  const results = [];
  let processed = 0;
  let successCount = 0;
  let failureCount = 0;

  for (let index = 0; index < groups.length; index += batchSize) {
    const batch = groups.slice(index, index + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (group) => {
        try {
          const result = await withTimeout(
            syncOrderGroup(group),
            timeoutMs,
            `calendar resync ${group.order_id}/${group.brand}/${group.vendor}`,
          );
          successCount += 1;
          return { group, ok: true, result };
        } catch (error) {
          failureCount += 1;
          const errorMessage = error?.message || String(error);
          await Order.updateMany(
            { ...group, ...ACTIVE_ORDER_MATCH },
            {
              $set: {
                "gcal.lastSyncedAt": new Date(),
                "gcal.lastSyncError": errorMessage,
              },
            },
          );
          return { group, ok: false, error: errorMessage };
        }
      }),
    );

    processed += batch.length;
    results.push(...batchResults);
    await job.updateProgress(Math.round((processed / Math.max(groups.length, 1)) * 100));
  }

  await invalidateOrderCaches();

  return {
    brand: brand || null,
    purge,
    groups: groups.length,
    processed,
    successCount,
    failureCount,
    batchSize,
    timeoutMs,
    results,
  };
};

const processPisFile = async (job) => {
  const itemId = normalizeText(job.data?.itemId);
  const itemCode = normalizeText(job.data?.itemCode);
  const tempFilePath = normalizeText(job.data?.tempFilePath);
  const originalName = normalizeText(job.data?.originalName) || "item-pis.xlsx";
  const previousStorageKey = normalizeText(job.data?.previousStorageKey);

  if (!itemId || !tempFilePath) {
    throw new Error("itemId and tempFilePath are required");
  }
  if (!isWasabiConfigured()) {
    throw new Error("Wasabi storage is not configured");
  }

  let convertedFile = null;
  let uploadResult = null;

  try {
    await job.updateProgress(10);
    convertedFile = await convertExcelToPdf({
      inputFilePath: tempFilePath,
      originalName,
    });

    await job.updateProgress(60);
    const pdfOriginalName = buildPisPdfOriginalName({
      spreadsheetOriginalName: originalName,
      itemCode,
      itemId,
    });

    uploadResult = await uploadBuffer({
      buffer: convertedFile.pdfBuffer,
      key: createStorageKey({
        folder: "item-pis",
        originalName: pdfOriginalName,
        extension: ".pdf",
      }),
      originalName: pdfOriginalName,
      contentType: "application/pdf",
    });

    await job.updateProgress(80);
    const item = await Item.findById(itemId);
    if (!item) {
      await deleteObject(uploadResult.key).catch(() => {});
      return { skipped: true, reason: "item_not_found", itemId };
    }

    item.pis_file = buildStoredWasabiFile({
      ...uploadResult,
      originalName: pdfOriginalName,
      contentType: "application/pdf",
    });
    await item.save();

    if (previousStorageKey && previousStorageKey !== uploadResult.key) {
      await deleteObject(previousStorageKey).catch((error) => {
        console.warn("[worker] previous PIS PDF cleanup failed", {
          itemId,
          message: error?.message || String(error),
        });
      });
    }

    await invalidateItemCaches();
    await job.updateProgress(100);

    return {
      item_id: String(item._id),
      originalName: item.pis_file.originalName,
      contentType: item.pis_file.contentType,
      size: item.pis_file.size,
    };
  } finally {
    if (convertedFile?.cleanup) {
      await convertedFile.cleanup().catch(() => {});
    }
    await safeDeleteFile(tempFilePath);
  }
};

const processWasabiUpload = async (job) => {
  const filePath = normalizeText(job.data?.filePath);
  const folder = normalizeText(job.data?.folder) || "uploads";
  const originalName = normalizeText(job.data?.originalName) || path.basename(filePath);
  const contentType = normalizeText(job.data?.contentType) || "application/octet-stream";
  const shouldCleanup = Boolean(job.data?.cleanup);

  if (!filePath) throw new Error("filePath is required");
  if (!isWasabiConfigured()) throw new Error("Wasabi storage is not configured");

  const buffer = await fs.readFile(filePath);
  const uploadResult = await uploadBuffer({
    buffer,
    key: createStorageKey({ folder, originalName }),
    originalName,
    contentType,
  });
  if (shouldCleanup) await safeDeleteFile(filePath);

  return {
    originalName: uploadResult.originalName,
    contentType: uploadResult.contentType,
    size: uploadResult.size,
  };
};

const processCbmQueue = async (job) => {
  if (job.name === JOB_NAMES.RECALCULATE_ORDER_CBM) {
    return processSingleOrderCbmRecalc(job);
  }
  if (job.name === JOB_NAMES.RECALCULATE_ALL_ORDER_CBM) {
    return processAllOrderCbmRecalc(job);
  }
  throw new Error(`Unsupported CBM job: ${job.name}`);
};

const processCalendarQueue = async (job) => {
  if (job.name === JOB_NAMES.SYNC_ORDER_GROUP_CALENDAR) {
    return processCalendarGroupSync(job);
  }
  if (job.name === JOB_NAMES.RESYNC_BRAND_CALENDAR) {
    return processCalendarResync(job);
  }
  throw new Error(`Unsupported calendar job: ${job.name}`);
};

const processFileQueue = async (job) => {
  if (
    job.name === JOB_NAMES.PROCESS_PIS_FILE ||
    job.name === JOB_NAMES.CONVERT_PIS_TO_PDF
  ) {
    return processPisFile(job);
  }
  if (job.name === JOB_NAMES.UPLOAD_TO_WASABI) {
    return processWasabiUpload(job);
  }
  throw new Error(`Unsupported file job: ${job.name}`);
};

const processOrderImportQueue = async (job) => ({
  skipped: true,
  jobName: job.name,
  reason: "Order import remains synchronous unless an endpoint enqueues this job",
});

const processImageQueue = async (job) => ({
  skipped: true,
  jobName: job.name,
  reason: "QC image upload already optimizes images inline; background post-processing is not required",
});

const createWorker = (queueName, processor, concurrency) => {
  const worker = new Worker(queueName, processor, {
    connection: getRedisConnectionOptions({
      forBullMq: true,
      connectionName: `oms-worker-${queueName}`,
    }),
    concurrency,
  });

  worker.on("completed", (job) => {
    console.info("[worker] job completed", {
      queue: queueName,
      jobId: job.id,
      jobName: job.name,
    });
  });

  worker.on("failed", (job, error) => {
    console.warn("[worker] job failed", {
      queue: queueName,
      jobId: job?.id,
      jobName: job?.name,
      message: error?.message || String(error),
    });
  });

  worker.on("error", (error) => {
    logThrottled(`${queueName}:worker-error`, "warn", "[worker] worker error", {
      queue: queueName,
      message: error?.message || String(error),
    });
  });

  return worker;
};

const startWorkers = () => {
  if (!isRedisJobsEnabled()) {
    console.info("[worker] REDIS_JOBS_ENABLED is false; no BullMQ workers started");
    return [];
  }

  getQueues();

  workers = [
    createWorker(
      QUEUE_NAMES.orderImportQueue,
      processOrderImportQueue,
      parsePositiveInt(process.env.ORDER_IMPORT_WORKER_CONCURRENCY, 1),
    ),
    createWorker(
      QUEUE_NAMES.fileProcessingQueue,
      processFileQueue,
      parsePositiveInt(process.env.FILE_WORKER_CONCURRENCY, 1),
    ),
    createWorker(
      QUEUE_NAMES.calendarSyncQueue,
      processCalendarQueue,
      parsePositiveInt(process.env.CALENDAR_WORKER_CONCURRENCY, 1),
    ),
    createWorker(
      QUEUE_NAMES.cbmRecalcQueue,
      processCbmQueue,
      parsePositiveInt(process.env.CBM_WORKER_CONCURRENCY, 2),
    ),
    createWorker(
      QUEUE_NAMES.imageProcessingQueue,
      processImageQueue,
      parsePositiveInt(process.env.IMAGE_WORKER_CONCURRENCY, 1),
    ),
  ];

  console.info("[worker] BullMQ workers started", {
    queues: Object.values(QUEUE_NAMES),
  });

  return workers;
};

const closeWorkers = async () => {
  const activeWorkers = workers;
  workers = [];
  await Promise.allSettled(activeWorkers.map((worker) => worker.close()));
};

module.exports = {
  startWorkers,
  closeWorkers,
};
