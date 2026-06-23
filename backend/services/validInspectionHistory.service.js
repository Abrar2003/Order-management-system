const mongoose = require("mongoose");
const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");

const MIN_DISTINCT_INSPECTION_POS = 3;

const normalizeText = (value) => String(value ?? "").trim();
const normalizeLookupKey = (value) => normalizeText(value).toLowerCase();

const hasInspector = (value) => {
  if (!value) return false;
  if (typeof value === "object") {
    return Boolean(normalizeText(value?._id || value?.id));
  }
  return Boolean(normalizeText(value));
};

const isValidInspectionHistoryRecord = ({
  itemCode,
  orderId,
  inspectionDate,
  inspector,
  source,
} = {}) =>
  Boolean(
    (!source || normalizeLookupKey(source) === "inspection_record") &&
    normalizeText(itemCode) &&
      normalizeText(orderId) &&
      normalizeText(inspectionDate) &&
      hasInspector(inspector),
  );

const buildValidInspectionPoLookup = (
  records = [],
  { minimumDistinctPos = MIN_DISTINCT_INSPECTION_POS } = {},
) => {
  const poSetsByItem = new Map();

  for (const record of Array.isArray(records) ? records : []) {
    if (
      !isValidInspectionHistoryRecord({
        itemCode: record?.item_code,
        orderId: record?.order_id,
        inspectionDate: record?.inspection_date,
        inspector: record?.inspector,
        source: record?.source,
      })
    ) {
      continue;
    }

    const itemKey = normalizeLookupKey(record.item_code);
    const poKey = normalizeLookupKey(record.order_id);
    const poSet = poSetsByItem.get(itemKey) || new Set();
    poSet.add(poKey);
    poSetsByItem.set(itemKey, poSet);
  }

  const result = new Map();
  for (const [itemKey, poSet] of poSetsByItem.entries()) {
    result.set(itemKey, {
      distinct_po_count: poSet.size,
      eligible: poSet.size >= Math.max(1, Number(minimumDistinctPos) || 1),
    });
  }

  return result;
};

const getValidInspectionPoLookup = async (
  itemCodes = [],
  options = {},
) => {
  const normalizedCodes = [
    ...new Set(
      (Array.isArray(itemCodes) ? itemCodes : [])
        .map((code) => normalizeText(code))
        .filter(Boolean),
    ),
  ];

  if (normalizedCodes.length === 0) return new Map();

  const qcRows = await QC.find({
    $or: normalizedCodes.map((code) => ({
      "item.item_code": {
        $regex: `^\\s*${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
        $options: "i",
      },
    })),
  })
    .select("_id order item.item_code")
    .populate("order", "order_id")
    .lean();

  const qcContextById = new Map(
    qcRows
      .map((qc) => [
        normalizeText(qc?._id),
        {
          item_code: normalizeText(qc?.item?.item_code),
          order_id: normalizeText(qc?.order?.order_id),
        },
      ])
      .filter(([qcId, context]) => qcId && context.item_code && context.order_id),
  );

  const qcIds = [...qcContextById.keys()]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (qcIds.length === 0) return new Map();

  const inspections = await Inspection.find({ qc: { $in: qcIds } })
    .select("qc inspection_date inspector")
    .lean();

  const records = inspections.map((inspection) => {
    const context = qcContextById.get(normalizeText(inspection?.qc)) || {};
    return {
      item_code: context.item_code,
      order_id: context.order_id,
      inspection_date: inspection?.inspection_date,
      inspector: inspection?.inspector,
      source: "inspection_record",
    };
  });

  return buildValidInspectionPoLookup(records, options);
};

module.exports = {
  MIN_DISTINCT_INSPECTION_POS,
  buildValidInspectionPoLookup,
  getValidInspectionPoLookup,
  isValidInspectionHistoryRecord,
  normalizeInspectionHistoryLookupKey: normalizeLookupKey,
};
