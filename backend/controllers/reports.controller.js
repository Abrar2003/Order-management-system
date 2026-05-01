const mongoose = require("mongoose");

const Inspection = require("../models/inspection.model");
const QC = require("../models/qc.model");
const Item = require("../models/item.model");
const {
  buildNormalizedInspectionSizeState,
  compareInspectionSizeSnapshot,
  normalizeNumber,
} = require("../helpers/inspectionSizeSnapshot");

const normalizeText = (value) => String(value ?? "").trim();

const toISODateString = (value) => {
  if (!value) return "";

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return value.toISOString().slice(0, 10);
  }

  const rawValue = normalizeText(value);
  if (!rawValue) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    return rawValue;
  }

  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(rawValue)) {
    const [day, month, year] = rawValue.split(/[/-]/).map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
  }

  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
};

const parseIsoDateToUtcDate = (value) => {
  const isoDate = toISODateString(value);
  if (!isoDate) return null;
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const addUtcDays = (date, days = 0) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + Number(days || 0));
  return nextDate;
};

const REPORT_TIMELINE_DAYS = Object.freeze({
  "1m": 30,
  "3m": 90,
  "6m": 180,
});

const parseCustomDaysInput = (value, fallback = 30) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 3650);
};

const resolveTimelineRange = ({ timeline = "1m", customDays = "" } = {}) => {
  const normalizedTimeline = normalizeText(timeline).toLowerCase();
  const timelineKey = Object.prototype.hasOwnProperty.call(
    REPORT_TIMELINE_DAYS,
    normalizedTimeline,
  )
    ? normalizedTimeline
    : normalizedTimeline === "custom"
      ? "custom"
      : "1m";

  const days =
    timelineKey === "custom"
      ? parseCustomDaysInput(customDays, 30)
      : REPORT_TIMELINE_DAYS[timelineKey];

  const todayUtc = parseIsoDateToUtcDate(new Date());
  if (!todayUtc) return null;

  const fromDateUtc = addUtcDays(todayUtc, -(Math.max(1, days) - 1));
  const toDateExclusiveUtc = addUtcDays(todayUtc, 1);
  const toDateInclusiveUtc = addUtcDays(toDateExclusiveUtc, -1);

  if (!fromDateUtc || !toDateExclusiveUtc || !toDateInclusiveUtc) {
    return null;
  }

  return {
    timeline: timelineKey,
    days,
    from_date_iso: toISODateString(fromDateUtc),
    to_date_iso: toISODateString(toDateInclusiveUtc),
    from_date_utc: fromDateUtc,
    to_date_exclusive_utc: toDateExclusiveUtc,
  };
};

const resolveExplicitDateRange = ({ fromDate = "", toDate = "" } = {}) => {
  const normalizedFrom = toISODateString(fromDate);
  const normalizedTo = toISODateString(toDate);

  if (!normalizedFrom && !normalizedTo) {
    return null;
  }

  const fromDateIso = normalizedFrom || normalizedTo;
  const toDateIso = normalizedTo || normalizedFrom;
  const fromDateUtc = parseIsoDateToUtcDate(fromDateIso);
  const toDateInclusiveUtc = parseIsoDateToUtcDate(toDateIso);

  if (!fromDateUtc || !toDateInclusiveUtc) return null;
  if (fromDateUtc.getTime() > toDateInclusiveUtc.getTime()) return null;

  const toDateExclusiveUtc = addUtcDays(toDateInclusiveUtc, 1);
  if (!toDateExclusiveUtc) return null;

  return {
    timeline: "custom",
    days: null,
    from_date_iso: fromDateIso,
    to_date_iso: toDateIso,
    from_date_utc: fromDateUtc,
    to_date_exclusive_utc: toDateExclusiveUtc,
  };
};

const resolveReportRange = ({
  fromDate = "",
  toDate = "",
  timeline = "1m",
  customDays = "",
} = {}) => {
  const explicitRange = resolveExplicitDateRange({ fromDate, toDate });
  if (explicitRange) return explicitRange;
  return resolveTimelineRange({ timeline, customDays });
};

const normalizeOptionalFilter = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return "";
  }
  return normalized;
};

const escapeRegex = (value = "") =>
  String(value)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const normalizeLookupKey = (value) => normalizeText(value).toLowerCase();

const normalizeBooleanFilter = (value, fallback = false) => {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return fallback;
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
};

const normalizeInspectionStatusFilter = (value) => {
  const normalized = normalizeOptionalFilter(value).toLowerCase();
  if (!normalized) return "";

  const statusMap = {
    pending: "pending",
    "inspection done": "Inspection Done",
    inspection_done: "Inspection Done",
    done: "Inspection Done",
    "goods not ready": "goods not ready",
    goods_not_ready: "goods not ready",
    rejected: "rejected",
    transfered: "transfered",
    transferred: "transfered",
  };

  return statusMap[normalized] || "";
};

const QC_REPORT_MISMATCH_ITEM_SELECT = [
  "code",
  "inspected_item_sizes",
  "inspected_box_sizes",
  "inspected_box_mode",
  "inspected_item_LBH",
  "inspected_item_top_LBH",
  "inspected_item_bottom_LBH",
  "inspected_box_LBH",
  "inspected_box_top_LBH",
  "inspected_box_bottom_LBH",
  "inspected_top_LBH",
  "inspected_bottom_LBH",
  "inspected_weight",
].join(" ");

const buildScalarValueExpression = (fieldPath, fallbackValue = "") => ({
  $let: {
    vars: {
      sourceValue: { $ifNull: [fieldPath, fallbackValue] },
    },
    in: {
      $cond: [
        { $isArray: "$$sourceValue" },
        {
          $ifNull: [
            { $arrayElemAt: ["$$sourceValue", 0] },
            fallbackValue,
          ],
        },
        "$$sourceValue",
      ],
    },
  },
});

const buildStringDateToDateExpression = (fieldPath) => ({
  $let: {
    vars: {
      rawDate: {
        $trim: {
          input: {
            $convert: {
              input: buildScalarValueExpression(fieldPath, ""),
              to: "string",
              onError: "",
              onNull: "",
            },
          },
        },
      },
    },
    in: {
      $switch: {
        branches: [
          {
            case: {
              $regexMatch: {
                input: "$$rawDate",
                regex: /^\d{4}-\d{2}-\d{2}$/,
              },
            },
            then: {
              $dateFromString: {
                dateString: "$$rawDate",
                format: "%Y-%m-%d",
                onError: null,
                onNull: null,
              },
            },
          },
          {
            case: {
              $regexMatch: {
                input: "$$rawDate",
                regex: /^\d{2}\/\d{2}\/\d{4}$/,
              },
            },
            then: {
              $dateFromString: {
                dateString: "$$rawDate",
                format: "%d/%m/%Y",
                onError: null,
                onNull: null,
              },
            },
          },
          {
            case: {
              $regexMatch: {
                input: "$$rawDate",
                regex: /^\d{2}-\d{2}-\d{4}$/,
              },
            },
            then: {
              $dateFromString: {
                dateString: "$$rawDate",
                format: "%d-%m-%Y",
                onError: null,
                onNull: null,
              },
            },
          },
        ],
        default: {
          $convert: {
            input: "$$rawDate",
            to: "date",
            onError: null,
            onNull: null,
          },
        },
      },
    },
  },
});

const inspectionDateToDateExpression =
  buildStringDateToDateExpression("$inspection_date");
const requestDateToDateExpression =
  buildStringDateToDateExpression("$requested_date");

const buildTrimmedStringExpression = (fieldPath) => ({
  $trim: {
    input: {
      $convert: {
        input: buildScalarValueExpression(fieldPath, ""),
        to: "string",
        onError: "",
        onNull: "",
      },
    },
  },
});

const buildNumericValueExpression = (valueExpression) => ({
  $convert: {
    input: { $ifNull: [valueExpression, 0] },
    to: "double",
    onError: 0,
    onNull: 0,
  },
});

const buildNumericExpression = (fieldPath) => buildNumericValueExpression(fieldPath);

const buildLbhCbmExpression = ({
  lengthExpression,
  breadthExpression,
  heightExpression,
}) => ({
  $let: {
    vars: {
      length: buildNumericValueExpression(lengthExpression),
      breadth: buildNumericValueExpression(breadthExpression),
      height: buildNumericValueExpression(heightExpression),
    },
    in: {
      $cond: [
        {
          $and: [
            { $gt: ["$$length", 0] },
            { $gt: ["$$breadth", 0] },
            { $gt: ["$$height", 0] },
          ],
        },
        {
          $divide: [
            {
              $multiply: [
                "$$length",
                "$$breadth",
                "$$height",
              ],
            },
            1000000,
          ],
        },
        0,
      ],
    },
  },
});

const buildLbhCbmExpressionFromPath = (fieldPath) =>
  buildLbhCbmExpression({
    lengthExpression: `${fieldPath}.L`,
    breadthExpression: `${fieldPath}.B`,
    heightExpression: `${fieldPath}.H`,
  });

const buildSizeEntriesCbmTotalExpression = (fieldPath) => ({
  $reduce: {
    input: {
      $cond: [
        { $isArray: fieldPath },
        fieldPath,
        [],
      ],
    },
    initialValue: 0,
    in: {
      $add: [
        "$$value",
        buildLbhCbmExpression({
          lengthExpression: "$$this.L",
          breadthExpression: "$$this.B",
          heightExpression: "$$this.H",
        }),
      ],
    },
  },
});

const buildFirstPositiveExpression = (expressions = []) =>
  expressions.reduceRight(
    (fallbackExpression, expression) => ({
      $cond: [
        { $gt: [expression, 0] },
        expression,
        fallbackExpression,
      ],
    }),
    0,
  );

const buildNormalizedDateOutputExpression = (parsedDateExpression, rawFieldPath) => ({
  $let: {
    vars: {
      parsedDate: parsedDateExpression,
      rawDate: buildTrimmedStringExpression(rawFieldPath),
    },
    in: {
      $cond: [
        { $ne: ["$$parsedDate", null] },
        {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$$parsedDate",
            timezone: "UTC",
          },
        },
        "$$rawDate",
      ],
    },
  },
});

const buildItemCbmPerUnitExpression = () => ({
  $let: {
    vars: {
      inspectedBoxSizesCbm: buildSizeEntriesCbmTotalExpression(
        "$item_doc.inspected_box_sizes",
      ),
      inspectedItemSizesCbm: buildSizeEntriesCbmTotalExpression(
        "$item_doc.inspected_item_sizes",
      ),
      inspectedBoxTopCbm: buildLbhCbmExpressionFromPath(
        "$item_doc.inspected_box_top_LBH",
      ),
      inspectedTopCbm: buildLbhCbmExpressionFromPath(
        "$item_doc.inspected_top_LBH",
      ),
      inspectedItemTopCbm: buildLbhCbmExpressionFromPath(
        "$item_doc.inspected_item_top_LBH",
      ),
      inspectedBoxBottomCbm: buildLbhCbmExpressionFromPath(
        "$item_doc.inspected_box_bottom_LBH",
      ),
      inspectedBottomCbm: buildLbhCbmExpressionFromPath(
        "$item_doc.inspected_bottom_LBH",
      ),
      inspectedItemBottomCbm: buildLbhCbmExpressionFromPath(
        "$item_doc.inspected_item_bottom_LBH",
      ),
      inspectedBoxSingleCbm: buildLbhCbmExpressionFromPath(
        "$item_doc.inspected_box_LBH",
      ),
      inspectedItemSingleCbm: buildLbhCbmExpressionFromPath(
        "$item_doc.inspected_item_LBH",
      ),
      itemCalculatedInspected: buildNumericExpression(
        "$item_doc.cbm.calculated_inspected_total",
      ),
      itemInspected: buildNumericExpression("$item_doc.cbm.inspected_total"),
      itemCalculatedPis: buildNumericExpression(
        "$item_doc.cbm.calculated_pis_total",
      ),
      itemTotal: buildNumericExpression("$item_doc.cbm.total"),
    },
    in: {
      $let: {
        vars: {
          inspectedSizeEntriesCbm: buildFirstPositiveExpression([
            "$$inspectedBoxSizesCbm",
            "$$inspectedItemSizesCbm",
          ]),
          resolvedInspectedTopCbm: buildFirstPositiveExpression([
            "$$inspectedBoxTopCbm",
            "$$inspectedTopCbm",
            "$$inspectedItemTopCbm",
          ]),
          resolvedInspectedBottomCbm: buildFirstPositiveExpression([
            "$$inspectedBoxBottomCbm",
            "$$inspectedBottomCbm",
            "$$inspectedItemBottomCbm",
          ]),
          resolvedInspectedSingleCbm: buildFirstPositiveExpression([
            "$$inspectedBoxSingleCbm",
            "$$inspectedItemSingleCbm",
          ]),
        },
        in: {
          $max: [
            0,
            {
              $cond: [
                { $gt: ["$$inspectedSizeEntriesCbm", 0] },
                "$$inspectedSizeEntriesCbm",
                {
                  $cond: [
                    {
                      $and: [
                        { $gt: ["$$resolvedInspectedTopCbm", 0] },
                        { $gt: ["$$resolvedInspectedBottomCbm", 0] },
                      ],
                    },
                    {
                      $add: [
                        "$$resolvedInspectedTopCbm",
                        "$$resolvedInspectedBottomCbm",
                      ],
                    },
                    {
                      $cond: [
                        { $gt: ["$$resolvedInspectedSingleCbm", 0] },
                        "$$resolvedInspectedSingleCbm",
                        {
                          $cond: [
                            { $gt: ["$$itemCalculatedInspected", 0] },
                            "$$itemCalculatedInspected",
                            {
                              $cond: [
                                { $gt: ["$$itemInspected", 0] },
                                "$$itemInspected",
                                {
                                  $cond: [
                                    { $gt: ["$$itemCalculatedPis", 0] },
                                    "$$itemCalculatedPis",
                                    "$$itemTotal",
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  },
});

const buildInitialInspectionMatch = ({
  reportRange,
  inspectorObjectId = null,
} = {}) => {
  const baseMatch = {
    $or: [
      {
        inspection_date: {
          $gte: reportRange.from_date_iso,
          $lte: reportRange.to_date_iso,
        },
      },
      {
        createdAt: {
          $gte: reportRange.from_date_utc,
          $lt: reportRange.to_date_exclusive_utc,
        },
      },
    ],
  };

  if (inspectorObjectId) {
    baseMatch.inspector = inspectorObjectId;
  }

  return baseMatch;
};

const buildDateNormalizationStages = ({ reportRange, inspectorObjectId = null } = {}) => [
  {
    $match: buildInitialInspectionMatch({ reportRange, inspectorObjectId }),
  },
  {
    $addFields: {
      inspection_date_value: {
        $ifNull: [inspectionDateToDateExpression, "$createdAt"],
      },
      requested_date_value: {
        $ifNull: [requestDateToDateExpression, "$createdAt"],
      },
    },
  },
  {
    $match: {
      inspection_date_value: {
        $gte: reportRange.from_date_utc,
        $lt: reportRange.to_date_exclusive_utc,
      },
    },
  },
];

const buildQcLookupStages = ({ selectedVendor = "" } = {}) => [
  {
    $lookup: {
      from: QC.collection.name,
      let: {
        qc_id: "$qc",
      },
      pipeline: [
        {
          $match: {
            $expr: {
              $eq: ["$_id", "$$qc_id"],
            },
          },
        },
        ...(selectedVendor
          ? [{ $match: { "order_meta.vendor": selectedVendor } }]
          : []),
        {
          $project: {
            order_meta: 1,
            item: 1,
          },
        },
      ],
      as: "qc_doc",
    },
  },
  {
    $unwind: {
      path: "$qc_doc",
      preserveNullAndEmptyArrays: false,
    },
  },
  {
    $addFields: {
      vendor_value: buildTrimmedStringExpression("$qc_doc.order_meta.vendor"),
      brand_value: buildTrimmedStringExpression("$qc_doc.order_meta.brand"),
      order_id_value: buildTrimmedStringExpression("$qc_doc.order_meta.order_id"),
      item_code_value: buildTrimmedStringExpression("$qc_doc.item.item_code"),
    },
  },
];

const buildUserLookupStages = () => [
  {
    $lookup: {
      from: "users",
      localField: "inspector",
      foreignField: "_id",
      as: "inspector_user",
    },
  },
  {
    $addFields: {
      inspector_user: { $arrayElemAt: ["$inspector_user", 0] },
      inspector_id_value: buildTrimmedStringExpression("$inspector"),
      inspector_name_value: {
        $let: {
          vars: {
            normalizedName: buildTrimmedStringExpression("$inspector_user.name"),
          },
          in: {
            $cond: [
              { $ne: ["$$normalizedName", ""] },
              "$$normalizedName",
              "Unassigned",
            ],
          },
        },
      },
    },
  },
];

const buildQcReportMismatchPipeline = ({
  reportRange,
  inspectorObjectId = null,
  brand = "",
  vendor = "",
  status = "",
  orderId = "",
  itemCode = "",
} = {}) => {
  const pipeline = [
    ...buildDateNormalizationStages({ reportRange, inspectorObjectId }),
    ...buildQcLookupStages(),
    ...buildUserLookupStages(),
  ];

  const match = {};
  if (brand) match.brand_value = brand;
  if (vendor) match.vendor_value = vendor;
  if (status) match.status = status;
  if (orderId) {
    match.order_id_value = { $regex: escapeRegex(orderId), $options: "i" };
  }
  if (itemCode) {
    match.item_code_value = { $regex: escapeRegex(itemCode), $options: "i" };
  }

  if (Object.keys(match).length > 0) {
    pipeline.push({ $match: match });
  }

  pipeline.push(
    {
      $project: {
        _id: 1,
        qc_id: "$qc",
        inspector_id: "$inspector_id_value",
        inspector_name: "$inspector_name_value",
        brand: "$brand_value",
        vendor: "$vendor_value",
        order_id: "$order_id_value",
        item_code: "$item_code_value",
        item_description: buildTrimmedStringExpression("$qc_doc.item.description"),
        requested_date: buildNormalizedDateOutputExpression(
          "$requested_date_value",
          "$requested_date",
        ),
        inspection_date: buildNormalizedDateOutputExpression(
          "$inspection_date_value",
          "$inspection_date",
        ),
        inspection_date_value: 1,
        status: 1,
        checked: {
          $round: [buildNumericExpression("$checked"), 3],
        },
        passed: {
          $round: [buildNumericExpression("$passed"), 3],
        },
        pending_after: {
          $round: [buildNumericExpression("$pending_after"), 3],
        },
        inspected_item_sizes: 1,
        inspected_box_sizes: 1,
        inspected_box_mode: 1,
        createdAt: 1,
      },
    },
    {
      $sort: {
        inspection_date_value: -1,
        createdAt: -1,
        _id: -1,
      },
    },
  );

  return pipeline;
};

const buildItemLookupStages = () => [
  {
    $lookup: {
      from: Item.collection.name,
      let: {
        item_code: "$item_code_value",
      },
      pipeline: [
        {
          $match: {
            $expr: {
              $eq: ["$code", "$$item_code"],
            },
          },
        },
        {
          $project: {
            cbm: 1,
            inspected_item_sizes: 1,
            inspected_box_sizes: 1,
            inspected_box_top_LBH: 1,
            inspected_top_LBH: 1,
            inspected_item_top_LBH: 1,
            inspected_box_bottom_LBH: 1,
            inspected_bottom_LBH: 1,
            inspected_item_bottom_LBH: 1,
            inspected_box_LBH: 1,
            inspected_item_LBH: 1,
          },
        },
      ],
      as: "item_doc",
    },
  },
  {
    $addFields: {
      item_doc: { $arrayElemAt: ["$item_doc", 0] },
    },
  },
  {
    $addFields: {
      item_cbm_per_unit: buildItemCbmPerUnitExpression(),
    },
  },
];

const buildSortedVendorOptionsFacet = ({ selectedInspectorId = "" } = {}) => {
  const stages = [];

  if (selectedInspectorId) {
    stages.push({
      $match: { inspector: new mongoose.Types.ObjectId(selectedInspectorId) },
    });
  }

  stages.push(
    { $match: { vendor_value: { $ne: "" } } },
    { $group: { _id: "$vendor_value" } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, value: "$_id" } },
  );

  return stages;
};

const buildSortedInspectorOptionsFacet = ({ selectedVendor = "" } = {}) => {
  const stages = [];

  if (selectedVendor) {
    stages.push({ $match: { vendor_value: selectedVendor } });
  }

  return [
    ...stages,
    ...buildUserLookupStages(),
    { $match: { inspector_id_value: { $ne: "" } } },
    {
      $group: {
        _id: {
          inspector_id: "$inspector_id_value",
          inspector_name: "$inspector_name_value",
        },
      },
    },
    {
      $project: {
        _id: 0,
        _id_value: "$_id.inspector_id",
        name: "$_id.inspector_name",
      },
    },
    {
      $sort: {
        name: 1,
        _id_value: 1,
      },
    },
    {
      $project: {
        _id: "$_id_value",
        name: 1,
      },
    },
  ];
};

exports.getVendorWiseQaSummary = async (req, res) => {
  try {
    const selectedVendor = normalizeOptionalFilter(req.query.vendor);
    if (!selectedVendor) {
      return res.status(400).json({ message: "vendor is required" });
    }

    const reportRange = resolveReportRange({
      fromDate: req.query.from_date ?? req.query.fromDate,
      toDate: req.query.to_date ?? req.query.toDate,
      timeline: req.query.timeline,
      customDays: req.query.custom_days ?? req.query.customDays,
    });
    if (!reportRange) {
      return res.status(400).json({ message: "Invalid date filters" });
    }

    const pipeline = [
      ...buildDateNormalizationStages({ reportRange }),
      ...buildQcLookupStages({ selectedVendor }),
      {
        $facet: {
          vendor_options: buildSortedVendorOptionsFacet(),
          inspectors: [
            { $match: { vendor_value: selectedVendor } },
            ...buildUserLookupStages(),
            ...buildItemLookupStages(),
            {
              $addFields: {
                passed_quantity_value: buildNumericExpression("$passed"),
              },
            },
            {
              $group: {
                _id: {
                  inspector_id: "$inspector_id_value",
                  inspector_name: "$inspector_name_value",
                },
                inspection_count: { $sum: 1 },
                inspected_quantity: { $sum: "$passed_quantity_value" },
                inspected_cbm: {
                  $sum: {
                    $multiply: ["$item_cbm_per_unit", "$passed_quantity_value"],
                  },
                },
              },
            },
            {
              $project: {
                _id: 0,
                inspector_id: "$_id.inspector_id",
                inspector_name: "$_id.inspector_name",
                inspection_count: 1,
                inspected_quantity: {
                  $round: ["$inspected_quantity", 3],
                },
                inspected_cbm: {
                  $round: ["$inspected_cbm", 3],
                },
              },
            },
            {
              $sort: {
                inspector_name: 1,
                inspector_id: 1,
              },
            },
          ],
        },
      },
    ];

    const [aggregationResult = {}] = await Inspection.aggregate(pipeline)
      .allowDiskUse(true);

    const inspectors = Array.isArray(aggregationResult.inspectors)
      ? aggregationResult.inspectors
      : [];
    const vendorOptions = Array.isArray(aggregationResult.vendor_options)
      ? aggregationResult.vendor_options.map((entry) => entry?.value).filter(Boolean)
      : [];

    const totals = inspectors.reduce(
      (accumulator, entry) => {
        accumulator.inspection_count += Number(entry?.inspection_count || 0);
        accumulator.inspected_quantity += Number(entry?.inspected_quantity || 0);
        accumulator.inspected_cbm += Number(entry?.inspected_cbm || 0);
        return accumulator;
      },
      {
        inspection_count: 0,
        inspected_quantity: 0,
        inspected_cbm: 0,
      },
    );

    return res.status(200).json({
      filters: {
        timeline: reportRange.timeline,
        custom_days:
          reportRange.timeline === "custom" ? reportRange.days : null,
        from_date: reportRange.from_date_iso,
        to_date: reportRange.to_date_iso,
        vendor: selectedVendor,
        vendor_options: vendorOptions,
      },
      summary: {
        inspectors_count: inspectors.length,
        inspection_count: totals.inspection_count,
        inspected_quantity: Number(totals.inspected_quantity.toFixed(3)),
        inspected_cbm: Number(totals.inspected_cbm.toFixed(3)),
      },
      inspectors,
    });
  } catch (error) {
    console.error("Vendor Wise QA Summary Error:", error);
    return res.status(500).json({
      message: error?.message || "Failed to fetch vendor wise QA summary",
    });
  }
};

exports.getVendorWiseQaDetailed = async (req, res) => {
  try {
    const selectedVendor = normalizeOptionalFilter(req.query.vendor);
    const selectedInspector = normalizeOptionalFilter(
      req.query.inspector ?? req.query.inspector_id ?? req.query.inspectorId,
    );

    if (selectedInspector && !mongoose.Types.ObjectId.isValid(selectedInspector)) {
      return res.status(400).json({ message: "Invalid inspector filter" });
    }

    const reportRange = resolveReportRange({
      fromDate: req.query.from_date ?? req.query.fromDate,
      toDate: req.query.to_date ?? req.query.toDate,
      timeline: req.query.timeline,
      customDays: req.query.custom_days ?? req.query.customDays,
    });
    if (!reportRange) {
      return res.status(400).json({ message: "Invalid date filters" });
    }

    const dataFacetMatch = [];
    if (selectedVendor) {
      dataFacetMatch.push({ $match: { vendor_value: selectedVendor } });
    }
    if (selectedInspector) {
      dataFacetMatch.push({
        $match: { inspector: new mongoose.Types.ObjectId(selectedInspector) },
      });
    }

    const pipeline = [
      ...buildDateNormalizationStages({ reportRange }),
      ...buildQcLookupStages({ selectedVendor }),
      {
        $facet: {
          vendor_options: buildSortedVendorOptionsFacet({
            selectedInspectorId: selectedInspector,
          }),
          inspector_options: buildSortedInspectorOptionsFacet({
            selectedVendor,
          }),
          vendors: [
            ...dataFacetMatch,
            ...buildUserLookupStages(),
            ...buildItemLookupStages(),
            {
              $project: {
                _id: 0,
                vendor: "$vendor_value",
                brand: "$brand_value",
                inspector_id: "$inspector_id_value",
                inspector_name: "$inspector_name_value",
                request_date: buildNormalizedDateOutputExpression(
                  "$requested_date_value",
                  "$requested_date",
                ),
                inspection_date: buildNormalizedDateOutputExpression(
                  "$inspection_date_value",
                  "$inspection_date",
                ),
                order_id: "$order_id_value",
                item_code: "$item_code_value",
                requested_quantity: {
                  $round: [buildNumericExpression("$vendor_requested"), 3],
                },
                passed_quantity: {
                  $round: [buildNumericExpression("$passed"), 3],
                },
                item_cbm: {
                  $round: ["$item_cbm_per_unit", 3],
                },
                packed_cbm: {
                  $round: [
                    {
                      $multiply: [
                        "$item_cbm_per_unit",
                        buildNumericExpression("$passed"),
                      ],
                    },
                    3,
                  ],
                },
                inspection_sort_date: "$inspection_date_value",
              },
            },
            {
              $sort: {
                vendor: 1,
                brand: 1,
                inspector_name: 1,
                inspection_sort_date: -1,
                order_id: 1,
                item_code: 1,
              },
            },
            {
              $group: {
                _id: {
                  vendor: "$vendor",
                  brand: "$brand",
                },
                total_inspections: { $sum: 1 },
                total_requested_quantity: { $sum: "$requested_quantity" },
                total_passed_quantity: { $sum: "$passed_quantity" },
                total_cbm: { $sum: "$packed_cbm" },
                rows: {
                  $push: {
                    inspector_id: "$inspector_id",
                    inspector_name: "$inspector_name",
                    request_date: "$request_date",
                    inspection_date: "$inspection_date",
                    order_id: "$order_id",
                    item_code: "$item_code",
                    requested_quantity: "$requested_quantity",
                    passed_quantity: "$passed_quantity",
                    item_cbm: "$item_cbm",
                    packed_cbm: "$packed_cbm",
                  },
                },
              },
            },
            {
              $project: {
                _id: 0,
                vendor: "$_id.vendor",
                brand: "$_id.brand",
                totals: {
                  total_inspections: "$total_inspections",
                  total_requested_quantity: {
                    $round: ["$total_requested_quantity", 3],
                  },
                  total_passed_quantity: {
                    $round: ["$total_passed_quantity", 3],
                  },
                  total_cbm: {
                    $round: ["$total_cbm", 3],
                  },
                },
                rows: 1,
              },
            },
            {
              $sort: {
                vendor: 1,
                brand: 1,
              },
            },
            {
              $group: {
                _id: "$vendor",
                brand_tables: {
                  $push: {
                    brand: "$brand",
                    totals: "$totals",
                    rows: "$rows",
                  },
                },
              },
            },
            {
              $project: {
                _id: 0,
                vendor: "$_id",
                brand_tables: 1,
              },
            },
            {
              $sort: {
                vendor: 1,
              },
            },
          ],
        },
      },
    ];

    const [aggregationResult = {}] = await Inspection.aggregate(pipeline)
      .allowDiskUse(true);

    const vendors = Array.isArray(aggregationResult.vendors)
      ? aggregationResult.vendors
      : [];
    const vendorOptions = Array.isArray(aggregationResult.vendor_options)
      ? aggregationResult.vendor_options.map((entry) => entry?.value).filter(Boolean)
      : [];
    const inspectorOptions = Array.isArray(aggregationResult.inspector_options)
      ? aggregationResult.inspector_options
      : [];

    const overallSummary = vendors.reduce(
      (accumulator, vendorEntry) => {
        accumulator.vendors_count += 1;
        const brandTables = Array.isArray(vendorEntry?.brand_tables)
          ? vendorEntry.brand_tables
          : [];
        accumulator.brand_tables_count += brandTables.length;

        for (const table of brandTables) {
          accumulator.total_inspections += Number(
            table?.totals?.total_inspections || 0,
          );
          accumulator.total_passed_quantity += Number(
            table?.totals?.total_passed_quantity || 0,
          );
          accumulator.total_cbm += Number(table?.totals?.total_cbm || 0);
        }

        return accumulator;
      },
      {
        vendors_count: 0,
        brand_tables_count: 0,
        total_inspections: 0,
        total_passed_quantity: 0,
        total_cbm: 0,
      },
    );

    return res.status(200).json({
      filters: {
        timeline: reportRange.timeline,
        custom_days:
          reportRange.timeline === "custom" ? reportRange.days : null,
        from_date: reportRange.from_date_iso,
        to_date: reportRange.to_date_iso,
        vendor: selectedVendor,
        inspector: selectedInspector,
        vendor_options: vendorOptions,
        inspector_options: inspectorOptions,
      },
      summary: {
        vendors_count: overallSummary.vendors_count,
        brand_tables_count: overallSummary.brand_tables_count,
        total_inspections: overallSummary.total_inspections,
        total_passed_quantity: Number(
          overallSummary.total_passed_quantity.toFixed(3),
        ),
        total_cbm: Number(overallSummary.total_cbm.toFixed(3)),
      },
      vendors,
    });
  } catch (error) {
    console.error("Vendor Wise QA Detailed Error:", error);
    return res.status(500).json({
      message: error?.message || "Failed to fetch vendor wise QA detailed report",
    });
  }
};

exports.getQcReportMismatch = async (req, res) => {
  try {
    const brand = normalizeOptionalFilter(req.query.brand);
    const vendor = normalizeOptionalFilter(req.query.vendor);
    const inspector = normalizeOptionalFilter(
      req.query.inspector ?? req.query.inspector_id ?? req.query.inspectorId,
    );
    const status = normalizeInspectionStatusFilter(req.query.status);
    const orderId = normalizeOptionalFilter(
      req.query.order_id ?? req.query.orderId ?? req.query.po,
    );
    const itemCode = normalizeOptionalFilter(
      req.query.item_code ?? req.query.itemCode,
    );
    const mismatchOnly = normalizeBooleanFilter(
      req.query.mismatch_only ?? req.query.mismatchOnly,
      false,
    );
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));

    const reportRange = resolveReportRange({
      fromDate: req.query.from ?? req.query.from_date ?? req.query.fromDate,
      toDate: req.query.to ?? req.query.to_date ?? req.query.toDate,
      timeline: req.query.timeline,
      customDays: req.query.custom_days ?? req.query.customDays,
    });
    if (!reportRange) {
      return res.status(400).json({ message: "Invalid report filters" });
    }

    if (inspector && !mongoose.Types.ObjectId.isValid(inspector)) {
      return res.status(400).json({ message: "Invalid inspector filter" });
    }

    const normalizedRole = normalizeText(req.user?.role).toLowerCase();
    const isQcUser = normalizedRole === "qc";
    const currentUserId = normalizeText(req.user?._id || req.user?.id || "");

    let effectiveInspectorFilter = inspector;
    if (isQcUser) {
      if (!currentUserId || !mongoose.Types.ObjectId.isValid(currentUserId)) {
        return res.status(403).json({
          message: "QC visibility could not be resolved for this user",
        });
      }
      if (inspector && inspector !== currentUserId) {
        return res.status(403).json({
          message: "QC can only view their own inspection mismatch records",
        });
      }
      effectiveInspectorFilter = currentUserId;
    }

    const inspectorObjectId =
      effectiveInspectorFilter && mongoose.Types.ObjectId.isValid(effectiveInspectorFilter)
        ? new mongoose.Types.ObjectId(effectiveInspectorFilter)
        : null;

    const inspections = await Inspection.aggregate(
      buildQcReportMismatchPipeline({
        reportRange,
        inspectorObjectId,
        brand,
        vendor,
        status,
        orderId,
        itemCode,
      }),
    ).allowDiskUse(true);

    const uniqueItemCodes = [
      ...new Set(
        (Array.isArray(inspections) ? inspections : [])
          .map((entry) => normalizeText(entry?.item_code || ""))
          .filter(Boolean),
      ),
    ];

    const itemDocs = uniqueItemCodes.length > 0
      ? await Item.find({
          $or: uniqueItemCodes.map((code) => ({
            code: {
              $regex: `^${escapeRegex(code)}$`,
              $options: "i",
            },
          })),
        })
          .select(QC_REPORT_MISMATCH_ITEM_SELECT)
          .lean()
      : [];

    const itemDocByCode = new Map(
      (Array.isArray(itemDocs) ? itemDocs : []).map((itemDoc) => [
        normalizeLookupKey(itemDoc?.code),
        itemDoc,
      ]),
    );

    const inspectionRows = (Array.isArray(inspections) ? inspections : []).map((inspection) => {
      const currentItemDoc =
        itemDocByCode.get(normalizeLookupKey(inspection?.item_code)) || {};
      const mismatch = compareInspectionSizeSnapshot(inspection, currentItemDoc);

      return {
        id: String(inspection?._id || ""),
        inspection_id: String(inspection?._id || ""),
        qc_id: String(inspection?.qc_id || ""),
        order_id: normalizeText(inspection?.order_id) || "N/A",
        brand: normalizeText(inspection?.brand) || "N/A",
        vendor: normalizeText(inspection?.vendor) || "N/A",
        item_code: normalizeText(inspection?.item_code) || "N/A",
        item_description: normalizeText(inspection?.item_description) || "N/A",
        inspector_id: normalizeText(inspection?.inspector_id),
        inspector_name: normalizeText(inspection?.inspector_name) || "Unassigned",
        requested_date: normalizeText(inspection?.requested_date),
        inspection_date: normalizeText(inspection?.inspection_date),
        inspection_date_value: inspection?.inspection_date_value || null,
        status: normalizeText(inspection?.status),
        checked: normalizeNumber(inspection?.checked),
        passed: normalizeNumber(inspection?.passed),
        pending_after: normalizeNumber(inspection?.pending_after),
        current_qc_inspected_item_sizes:
          mismatch.current_snapshot.inspected_item_sizes,
        inspection_inspected_item_sizes:
          mismatch.inspection_snapshot.inspected_item_sizes,
        current_qc_inspected_box_sizes:
          mismatch.current_snapshot.inspected_box_sizes,
        inspection_inspected_box_sizes:
          mismatch.inspection_snapshot.inspected_box_sizes,
        current_qc_inspected_box_mode:
          mismatch.current_snapshot.inspected_box_mode,
        inspection_inspected_box_mode:
          mismatch.inspection_snapshot.inspected_box_mode,
        mismatch_summary: {
          has_mismatch: mismatch.has_mismatch,
          mismatch_count: mismatch.mismatch_count,
          item_size_mismatch_count: mismatch.item_size_mismatches.length,
          box_size_mismatch_count: mismatch.box_size_mismatches.length,
          box_mode_mismatch_count: mismatch.box_mode_mismatch ? 1 : 0,
        },
        item_size_mismatches: mismatch.item_size_mismatches,
        box_size_mismatches: mismatch.box_size_mismatches,
        box_mode_mismatch: mismatch.box_mode_mismatch,
      };
    });

    const summary = inspectionRows.reduce(
      (accumulator, row) => {
        accumulator.total_inspections += 1;
        if (row?.mismatch_summary?.has_mismatch) {
          accumulator.mismatch_inspections += 1;
        } else {
          accumulator.clean_inspections += 1;
        }
        accumulator.item_size_mismatch_count += Number(
          row?.mismatch_summary?.item_size_mismatch_count || 0,
        );
        accumulator.box_size_mismatch_count += Number(
          row?.mismatch_summary?.box_size_mismatch_count || 0,
        );
        accumulator.box_mode_mismatch_count += Number(
          row?.mismatch_summary?.box_mode_mismatch_count || 0,
        );
        return accumulator;
      },
      {
        total_inspections: 0,
        mismatch_inspections: 0,
        clean_inspections: 0,
        item_size_mismatch_count: 0,
        box_size_mismatch_count: 0,
        box_mode_mismatch_count: 0,
      },
    );

    const groupedRowsMap = new Map();
    inspectionRows.forEach((row) => {
      const groupKey =
        normalizeText(row?.qc_id) ||
        `${normalizeLookupKey(row?.order_id)}::${normalizeLookupKey(row?.item_code)}`;
      const currentEntry = groupedRowsMap.get(groupKey);

      if (!currentEntry) {
        const currentItemDoc =
          itemDocByCode.get(normalizeLookupKey(row?.item_code)) || {};
        const normalizedCurrentSnapshot =
          buildNormalizedInspectionSizeState(currentItemDoc);
        const currentSnapshot = {
          inspected_item_sizes: Array.isArray(row?.current_qc_inspected_item_sizes)
            ? row.current_qc_inspected_item_sizes
            : normalizedCurrentSnapshot.inspected_item_sizes,
          inspected_box_sizes: Array.isArray(row?.current_qc_inspected_box_sizes)
            ? row.current_qc_inspected_box_sizes
            : normalizedCurrentSnapshot.inspected_box_sizes,
          inspected_box_mode:
            row?.current_qc_inspected_box_mode ||
            normalizedCurrentSnapshot.inspected_box_mode,
        };

        groupedRowsMap.set(groupKey, {
          id: normalizeText(row?.qc_id) || normalizeText(row?.inspection_id) || groupKey,
          qc_id: normalizeText(row?.qc_id),
          order_id: row?.order_id || "N/A",
          brand: row?.brand || "N/A",
          vendor: row?.vendor || "N/A",
          item_code: row?.item_code || "N/A",
          item_description: row?.item_description || "N/A",
          inspector_names: [],
          requested_date: row?.requested_date || "",
          inspection_date: row?.inspection_date || "",
          inspection_date_value: row?.inspection_date_value || null,
          status: row?.status || "",
          checked: 0,
          passed: 0,
          pending_after: row?.pending_after ?? 0,
          inspection_count: 0,
          current_qc_inspected_item_sizes: currentSnapshot.inspected_item_sizes,
          current_qc_inspected_box_sizes: currentSnapshot.inspected_box_sizes,
          current_qc_inspected_box_mode: currentSnapshot.inspected_box_mode,
          mismatch_summary: {
            has_mismatch: false,
            mismatch_count: 0,
            mismatch_inspection_count: 0,
            clean_inspection_count: 0,
            item_size_mismatch_count: 0,
            box_size_mismatch_count: 0,
            box_mode_mismatch_count: 0,
          },
          inspection_records: [],
        });
      }

      const group = groupedRowsMap.get(groupKey);
      group.inspection_count += 1;
      group.checked += Number(row?.checked || 0);
      group.passed += Number(row?.passed || 0);
      group.pending_after = row?.pending_after ?? group.pending_after;

      if (
        row?.inspection_date_value &&
        (!group.inspection_date_value ||
          new Date(row.inspection_date_value).getTime() >=
            new Date(group.inspection_date_value).getTime())
      ) {
        group.inspection_date_value = row.inspection_date_value;
        group.inspection_date = row?.inspection_date || group.inspection_date;
        group.requested_date = row?.requested_date || group.requested_date;
        group.status = row?.status || group.status;
      }

      if (row?.inspector_name && !group.inspector_names.includes(row.inspector_name)) {
        group.inspector_names.push(row.inspector_name);
      }

      const inspectionRecord = {
        inspection_id: row?.inspection_id || row?.id,
        requested_date: row?.requested_date || "",
        inspection_date: row?.inspection_date || "",
        inspection_date_value: row?.inspection_date_value || null,
        inspector_id: row?.inspector_id || "",
        inspector_name: row?.inspector_name || "Unassigned",
        status: row?.status || "",
        checked: Number(row?.checked || 0),
        passed: Number(row?.passed || 0),
        pending_after: Number(row?.pending_after || 0),
        inspection_snapshot: {
          inspected_item_sizes: Array.isArray(row?.inspection_inspected_item_sizes)
            ? row.inspection_inspected_item_sizes
            : [],
          inspected_box_sizes: Array.isArray(row?.inspection_inspected_box_sizes)
            ? row.inspection_inspected_box_sizes
            : [],
          inspected_box_mode: row?.inspection_inspected_box_mode || "",
        },
        mismatch_summary: {
          has_mismatch: Boolean(row?.mismatch_summary?.has_mismatch),
          mismatch_count: Number(row?.mismatch_summary?.mismatch_count || 0),
          item_size_mismatch_count: Number(
            row?.mismatch_summary?.item_size_mismatch_count || 0,
          ),
          box_size_mismatch_count: Number(
            row?.mismatch_summary?.box_size_mismatch_count || 0,
          ),
          box_mode_mismatch_count: Number(
            row?.mismatch_summary?.box_mode_mismatch_count || 0,
          ),
        },
        item_size_mismatches: Array.isArray(row?.item_size_mismatches)
          ? row.item_size_mismatches
          : [],
        box_size_mismatches: Array.isArray(row?.box_size_mismatches)
          ? row.box_size_mismatches
          : [],
        box_mode_mismatch: row?.box_mode_mismatch || null,
      };

      group.inspection_records.push(inspectionRecord);
      group.mismatch_summary.mismatch_count += inspectionRecord.mismatch_summary.mismatch_count;
      group.mismatch_summary.item_size_mismatch_count +=
        inspectionRecord.mismatch_summary.item_size_mismatch_count;
      group.mismatch_summary.box_size_mismatch_count +=
        inspectionRecord.mismatch_summary.box_size_mismatch_count;
      group.mismatch_summary.box_mode_mismatch_count +=
        inspectionRecord.mismatch_summary.box_mode_mismatch_count;

      if (inspectionRecord.mismatch_summary.has_mismatch) {
        group.mismatch_summary.has_mismatch = true;
        group.mismatch_summary.mismatch_inspection_count += 1;
      } else {
        group.mismatch_summary.clean_inspection_count += 1;
      }
    });

    const groupedRows = [...groupedRowsMap.values()]
      .map((group) => {
        const sortedInspectionRecords = [...group.inspection_records].sort((left, right) => {
          const leftTime = left?.inspection_date_value
            ? new Date(left.inspection_date_value).getTime()
            : 0;
          const rightTime = right?.inspection_date_value
            ? new Date(right.inspection_date_value).getTime()
            : 0;
          return leftTime - rightTime;
        }).map((inspectionRecord, index) => ({
          ...inspectionRecord,
          sheet_label: `Inspection ${index + 1}`,
        }));

        return {
          ...group,
          inspector_name: group.inspector_names.join(", ") || "Unassigned",
          inspection_records: sortedInspectionRecords,
        };
      })
      .sort((left, right) => {
        const leftTime = left?.inspection_date_value
          ? new Date(left.inspection_date_value).getTime()
          : 0;
        const rightTime = right?.inspection_date_value
          ? new Date(right.inspection_date_value).getTime()
          : 0;
        return rightTime - leftTime;
      });

    const filteredRows = mismatchOnly
      ? groupedRows.filter((row) => row?.mismatch_summary?.has_mismatch)
      : groupedRows;
    const total = filteredRows.length;
    const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const skip = (safePage - 1) * Math.max(1, limit);

    const sortedBrands = [...new Set(
      inspectionRows
        .map((row) => normalizeText(row?.brand))
        .filter(Boolean)
        .filter((value) => value !== "N/A"),
    )].sort((left, right) => left.localeCompare(right));
    const sortedVendors = [...new Set(
      inspectionRows
        .map((row) => normalizeText(row?.vendor))
        .filter(Boolean)
        .filter((value) => value !== "N/A"),
    )].sort((left, right) => left.localeCompare(right));
    const inspectorOptions = [...new Map(
      inspectionRows
        .map((row) => ({
          _id: normalizeText(row?.inspector_id),
          name: normalizeText(row?.inspector_name) || "Unassigned",
        }))
        .filter((option) => option._id)
        .map((option) => [option._id, option]),
    ).values()].sort((left, right) =>
      `${left.name} ${left._id}`.localeCompare(`${right.name} ${right._id}`),
    );

    return res.status(200).json({
      success: true,
      rows: filteredRows.slice(skip, skip + Math.max(1, limit)),
      summary,
      filters: {
        timeline: reportRange.timeline,
        custom_days:
          reportRange.timeline === "custom" ? reportRange.days : null,
        from_date: reportRange.from_date_iso,
        to_date: reportRange.to_date_iso,
        brand,
        vendor,
        inspector: effectiveInspectorFilter,
        status,
        order_id: orderId,
        item_code: itemCode,
        mismatch_only: mismatchOnly,
        brand_options: sortedBrands,
        vendor_options: sortedVendors,
        inspector_options: inspectorOptions,
      },
      pagination: {
        page: safePage,
        limit: Math.max(1, limit),
        total,
        totalPages,
      },
    });
  } catch (error) {
    console.error("QC Report Mismatch Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch QC report mismatch data",
    });
  }
};
