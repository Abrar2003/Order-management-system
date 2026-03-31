const mongoose = require("mongoose");

const Inspection = require("../models/inspection.model");
const QC = require("../models/qc.model");
const Item = require("../models/item.model");

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
