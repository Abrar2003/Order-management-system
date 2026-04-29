const Item = require("../models/item.model");
const Order = require("../models/order.model");
const {
  BOX_ENTRY_TYPES,
  BOX_PACKAGING_MODES,
  detectBoxPackagingMode,
} = require("../helpers/boxMeasurement");
const { normalizeOrderStatus } = require("../helpers/orderStatus");

const CBM_PRECISION = 6;
const CBM_UNIT_DIVISOR = 1000000;
const DEFAULT_BATCH_SIZE = 500;

const PO_CBM_ELIGIBLE_STATUSES = Object.freeze([
  "Under Inspection",
  "Inspection Done",
  "Partial Shipped",
  "Shipped",
]);

const normalizeText = (value) => String(value ?? "").trim();
const normalizeLookupKey = (value) => normalizeText(value).toLowerCase();
const escapeRegex = (value = "") =>
  String(value)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const toPositiveNumber = (value, fallback = 0) => {
  const parsed = toSafeNumber(value, fallback);
  return parsed > 0 ? parsed : fallback;
};

const roundCbm = (value, precision = CBM_PRECISION) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Number(parsed.toFixed(precision));
};

const hasCompletePositiveLbh = (entry = {}) =>
  toPositiveNumber(entry?.L, 0) > 0 &&
  toPositiveNumber(entry?.B, 0) > 0 &&
  toPositiveNumber(entry?.H, 0) > 0;

const dimensionToCbm = (entry = {}) => {
  if (!hasCompletePositiveLbh(entry)) return 0;
  return (
    (toPositiveNumber(entry?.L, 0) *
      toPositiveNumber(entry?.B, 0) *
      toPositiveNumber(entry?.H, 0)) /
    CBM_UNIT_DIVISOR
  );
};

const normalizeEntryMarker = (value) => normalizeText(value).toLowerCase();

const getEntryType = (entry = {}) => {
  const boxType = normalizeEntryMarker(entry?.box_type);
  const remark = normalizeEntryMarker(entry?.remark || entry?.type);

  if (boxType === BOX_ENTRY_TYPES.MASTER || remark === BOX_ENTRY_TYPES.MASTER) {
    return BOX_ENTRY_TYPES.MASTER;
  }
  if (boxType === BOX_ENTRY_TYPES.INNER || remark === BOX_ENTRY_TYPES.INNER) {
    return BOX_ENTRY_TYPES.INNER;
  }
  return BOX_ENTRY_TYPES.INDIVIDUAL;
};

const findCartonEntry = (entries = [], entryType = "") =>
  (Array.isArray(entries) ? entries : []).find(
    (entry) => getEntryType(entry) === entryType,
  ) || null;

const getValidNormalBoxEntries = (entries = []) =>
  (Array.isArray(entries) ? entries : []).filter((entry) => {
    const entryType = getEntryType(entry);
    return entryType === BOX_ENTRY_TYPES.INDIVIDUAL && hasCompletePositiveLbh(entry);
  });

const getLegacyInspectedBoxEntries = ({
  inspectedBoxLbh = null,
  inspectedBoxTopLbh = null,
  inspectedBoxBottomLbh = null,
} = {}) => {
  const legacyEntries = [];
  if (hasCompletePositiveLbh(inspectedBoxTopLbh)) {
    legacyEntries.push(inspectedBoxTopLbh);
  }
  if (hasCompletePositiveLbh(inspectedBoxBottomLbh)) {
    legacyEntries.push(inspectedBoxBottomLbh);
  }
  if (legacyEntries.length > 0) return legacyEntries;
  return hasCompletePositiveLbh(inspectedBoxLbh) ? [inspectedBoxLbh] : [];
};

const calculateNormalModeTotalPoCbm = ({
  orderQuantity = 0,
  inspectedBoxSizes = [],
  inspectedBoxLbh = null,
  inspectedBoxTopLbh = null,
  inspectedBoxBottomLbh = null,
} = {}) => {
  const quantity = toPositiveNumber(orderQuantity, 0);
  if (quantity <= 0) return 0;

  const validSizeEntries = getValidNormalBoxEntries(inspectedBoxSizes);
  const entries =
    validSizeEntries.length > 0
      ? validSizeEntries
      : getLegacyInspectedBoxEntries({
          inspectedBoxLbh,
          inspectedBoxTopLbh,
          inspectedBoxBottomLbh,
        });

  const perUnitCbm = entries.reduce(
    (sum, entry) => sum + dimensionToCbm(entry),
    0,
  );

  return roundCbm(perUnitCbm * quantity);
};

const calculateCartonModeTotalPoCbm = ({
  orderQuantity = 0,
  inspectedBoxSizes = [],
} = {}) => {
  const quantity = toPositiveNumber(orderQuantity, 0);
  if (quantity <= 0) return 0;

  const innerEntry = findCartonEntry(inspectedBoxSizes, BOX_ENTRY_TYPES.INNER);
  const masterEntry = findCartonEntry(inspectedBoxSizes, BOX_ENTRY_TYPES.MASTER);
  const itemCountInInner = toPositiveNumber(innerEntry?.item_count_in_inner, 0);
  const boxCountInMaster = toPositiveNumber(masterEntry?.box_count_in_master, 0);
  const masterBoxCbm = dimensionToCbm(masterEntry);

  if (itemCountInInner <= 0 || boxCountInMaster <= 0 || masterBoxCbm <= 0) {
    return 0;
  }

  // Formula requested for PO CBM. It intentionally uses the master carton CBM
  // and count metadata rather than summing inner + master carton dimensions.
  return roundCbm(
    (quantity / (itemCountInInner * boxCountInMaster)) * masterBoxCbm,
  );
};

const calculateTotalPoCbm = ({
  orderQuantity = 0,
  inspectedBoxSizes = [],
  inspectedBoxMode = BOX_PACKAGING_MODES.INDIVIDUAL,
  inspectedBoxLbh = null,
  inspectedBoxTopLbh = null,
  inspectedBoxBottomLbh = null,
} = {}) => {
  const entries = Array.isArray(inspectedBoxSizes) ? inspectedBoxSizes : [];
  const resolvedMode = detectBoxPackagingMode(inspectedBoxMode, entries);

  if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
    return calculateCartonModeTotalPoCbm({
      orderQuantity,
      inspectedBoxSizes: entries,
    });
  }

  return calculateNormalModeTotalPoCbm({
    orderQuantity,
    inspectedBoxSizes: entries,
    inspectedBoxLbh,
    inspectedBoxTopLbh,
    inspectedBoxBottomLbh,
  });
};

const getOrderItemCode = (order = {}) =>
  normalizeText(order?.item?.item_code ?? order?.item_code ?? "");

const isOrderEligibleForPoCbm = (order = {}) => {
  if (!order || typeof order !== "object") return false;
  if (order.archived === true) return false;
  const rawStatus = normalizeText(order?.status).toLowerCase();
  if (rawStatus === "cancelled") return false;
  const normalizedStatus = normalizeOrderStatus(order?.status);

  if (normalizedStatus === "") {
    return Boolean(order?.qc_record);
  }
  if (normalizedStatus === "Pending") {
    return Boolean(order?.qc_record);
  }
  return PO_CBM_ELIGIBLE_STATUSES.includes(normalizedStatus);
};

const calculateOrderTotalPoCbm = ({ order = null, item = null } = {}) => {
  if (!order || !item) return 0;

  return calculateTotalPoCbm({
    orderQuantity: order?.quantity,
    inspectedBoxSizes: item?.inspected_box_sizes,
    inspectedBoxMode: item?.inspected_box_mode,
    inspectedBoxLbh: item?.inspected_box_LBH,
    inspectedBoxTopLbh: item?.inspected_box_top_LBH || item?.inspected_top_LBH,
    inspectedBoxBottomLbh:
      item?.inspected_box_bottom_LBH || item?.inspected_bottom_LBH,
  });
};

const findItemForOrder = async (order = null, { session = null } = {}) => {
  const itemCode = getOrderItemCode(order);
  if (!itemCode) return null;

  const query = Item.findOne({
    code: { $regex: `^${escapeRegex(itemCode)}$`, $options: "i" },
  }).select(
    "code inspected_box_sizes inspected_box_mode inspected_box_LBH inspected_box_top_LBH inspected_box_bottom_LBH inspected_top_LBH inspected_bottom_LBH",
  );

  if (session) query.session(session);
  return query;
};

const applyTotalPoCbmToOrder = async (
  orderDoc,
  { item = null, session = null } = {},
) => {
  if (!orderDoc) {
    return { value: 0, changed: false, reason: "missing_order" };
  }

  const previousValue = roundCbm(orderDoc.total_po_cbm || 0);
  if (!isOrderEligibleForPoCbm(orderDoc)) {
    orderDoc.total_po_cbm = 0;
    return {
      value: 0,
      changed: previousValue !== 0,
      reason: "ineligible_order",
    };
  }

  const itemDoc = item || (await findItemForOrder(orderDoc, { session }));
  const nextValue = calculateOrderTotalPoCbm({
    order: orderDoc,
    item: itemDoc,
  });

  orderDoc.total_po_cbm = nextValue;
  return {
    value: nextValue,
    changed: previousValue !== nextValue,
    reason: itemDoc ? "calculated" : "missing_item",
  };
};

const buildEligibleOrderMatch = (extraMatch = {}) => ({
  archived: { $ne: true },
  status: { $ne: "Cancelled" },
  $and: [
    {
      $or: [
        { status: { $in: PO_CBM_ELIGIBLE_STATUSES } },
        { qc_record: { $exists: true, $ne: null } },
      ],
    },
  ],
  ...extraMatch,
});

const flushBulkUpdates = async (bulkOps = []) => {
  if (!Array.isArray(bulkOps) || bulkOps.length === 0) return null;
  return Order.bulkWrite(bulkOps, { ordered: false });
};

const syncTotalPoCbmForItem = async (
  itemOrCode,
  { batchSize = DEFAULT_BATCH_SIZE } = {},
) => {
  const item =
    itemOrCode && typeof itemOrCode === "object"
      ? itemOrCode
      : await Item.findOne({
          code: {
            $regex: `^${escapeRegex(normalizeText(itemOrCode))}$`,
            $options: "i",
          },
        }).lean();
  const itemCode = normalizeText(item?.code || itemOrCode);

  const summary = {
    item_code: itemCode,
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  if (!itemCode) return summary;

  const itemCodeVariants = [
    ...new Set([itemCode, itemCode.toUpperCase(), itemCode.toLowerCase()]),
  ];
  const cursor = Order.find(
    buildEligibleOrderMatch({ "item.item_code": { $in: itemCodeVariants } }),
  )
    .select("_id item quantity status qc_record archived total_po_cbm")
    .lean()
    .cursor();

  let bulkOps = [];
  for await (const order of cursor) {
    summary.processed += 1;
    const nextValue = item
      ? calculateOrderTotalPoCbm({ order, item })
      : 0;
    const currentValue = roundCbm(order?.total_po_cbm || 0);

    if (currentValue === nextValue) {
      summary.skipped += 1;
      continue;
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: order._id },
        update: { $set: { total_po_cbm: nextValue } },
      },
    });
    summary.updated += 1;

    if (bulkOps.length >= batchSize) {
      await flushBulkUpdates(bulkOps);
      bulkOps = [];
    }
  }

  if (bulkOps.length > 0) {
    await flushBulkUpdates(bulkOps);
  }

  return summary;
};

const findItemsByCodes = async (codes = []) => {
  const uniqueCodes = [
    ...new Set(
      (Array.isArray(codes) ? codes : [])
        .map(normalizeText)
        .filter(Boolean)
        .flatMap((code) => [code, code.toUpperCase(), code.toLowerCase()]),
    ),
  ];

  if (uniqueCodes.length === 0) return new Map();

  const items = await Item.find({ code: { $in: uniqueCodes } })
    .select(
      "code inspected_box_sizes inspected_box_mode inspected_box_LBH inspected_box_top_LBH inspected_box_bottom_LBH inspected_top_LBH inspected_bottom_LBH",
    )
    .lean();

  return items.reduce((accumulator, item) => {
    const key = normalizeLookupKey(item?.code);
    if (key && !accumulator.has(key)) {
      accumulator.set(key, item);
    }
    return accumulator;
  }, new Map());
};

const processBackfillBatch = async ({
  orders = [],
  dryRun = false,
  forceUpdate = false,
  requireCalculatedCbm = false,
} = {}) => {
  const summary = {
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    missing_items: 0,
    no_calculated_cbm: 0,
  };

  const itemMap = await findItemsByCodes(orders.map(getOrderItemCode));
  const bulkOps = [];

  for (const order of orders) {
    try {
      summary.processed += 1;
      const item = itemMap.get(normalizeLookupKey(getOrderItemCode(order))) || null;
      if (!item) {
        summary.missing_items += 1;
        if (requireCalculatedCbm) {
          summary.skipped += 1;
          continue;
        }
      }

      const nextValue = item
        ? calculateOrderTotalPoCbm({ order, item })
        : 0;
      const currentValue = roundCbm(order?.total_po_cbm || 0);

      if (requireCalculatedCbm && nextValue <= 0) {
        summary.no_calculated_cbm += 1;
        summary.skipped += 1;
        continue;
      }

      if (!forceUpdate && currentValue === nextValue) {
        summary.skipped += 1;
        continue;
      }

      summary.updated += 1;
      if (!dryRun) {
        bulkOps.push({
          updateOne: {
            filter: { _id: order._id },
            update: { $set: { total_po_cbm: nextValue } },
          },
        });
      }
    } catch (error) {
      summary.failed += 1;
      console.error("PO CBM backfill row failed:", {
        orderId: order?._id,
        order_id: order?.order_id,
        item_code: getOrderItemCode(order),
        error: error?.message || String(error),
      });
    }
  }

  if (bulkOps.length > 0) {
    await flushBulkUpdates(bulkOps);
  }

  return summary;
};

const addSummary = (target, source) => {
  for (const key of Object.keys(target)) {
    target[key] += Number(source?.[key] || 0);
  }
  return target;
};

const backfillTotalPoCbmForOrders = async ({
  batchSize = DEFAULT_BATCH_SIZE,
  dryRun = false,
  forceUpdate = false,
  requireCalculatedCbm = false,
  eligibleOnly = true,
} = {}) => {
  const safeBatchSize = Math.max(1, Number(batchSize) || DEFAULT_BATCH_SIZE);
  const summary = {
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    missing_items: 0,
    no_calculated_cbm: 0,
  };

  const orderMatch = eligibleOnly
    ? buildEligibleOrderMatch()
    : {
        archived: { $ne: true },
        status: { $ne: "Cancelled" },
      };

  const cursor = Order.find(orderMatch)
    .select("_id order_id item quantity status qc_record archived total_po_cbm")
    .lean()
    .cursor();

  let batch = [];
  for await (const order of cursor) {
    batch.push(order);
    if (batch.length >= safeBatchSize) {
      addSummary(
        summary,
        await processBackfillBatch({
          orders: batch,
          dryRun,
          forceUpdate,
          requireCalculatedCbm,
        }),
      );
      batch = [];
    }
  }

  if (batch.length > 0) {
    addSummary(
      summary,
      await processBackfillBatch({
        orders: batch,
        dryRun,
        forceUpdate,
        requireCalculatedCbm,
      }),
    );
  }

  return {
    ...summary,
    dry_run: Boolean(dryRun),
    force_update: Boolean(forceUpdate),
    require_calculated_cbm: Boolean(requireCalculatedCbm),
    eligible_only: Boolean(eligibleOnly),
    batch_size: safeBatchSize,
  };
};

module.exports = {
  PO_CBM_ELIGIBLE_STATUSES,
  applyTotalPoCbmToOrder,
  backfillTotalPoCbmForOrders,
  calculateOrderTotalPoCbm,
  calculateTotalPoCbm,
  dimensionToCbm,
  getValidNormalBoxEntries,
  isOrderEligibleForPoCbm,
  roundCbm,
  syncTotalPoCbmForItem,
};
