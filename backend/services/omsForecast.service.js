const dateParser = require("../helpers/dateparsser");
const { deriveOrderProgress } = require("../helpers/orderStatus");
const {
  resolveOrderRowCbmSummaryWithStoredFallback,
  toRoundedCbmValue,
} = require("./shipmentCbmAllocation.service");
const { executeOmsCapability } = require("./omsCapabilityExecution.service");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CONTAINER_TARGET_CBM = 65;
const MIN_HISTORY_SAMPLES = 3;
const TRUNCATED_EVIDENCE_LIMITATION = "The bounded OMS evidence was truncated; some open orders or historical samples may be missing.";
const COMPLETED_ORDER_STATUSES = new Set([
  "inspection done",
  "partial shipped",
  "partially shipped",
  "shipped",
]);
const SOURCE_SCORES = Object.freeze({
  same_item_same_vendor: 30,
  same_item_all_vendors: 26,
  same_product_type_same_vendor: 21,
  vendor_wide: 16,
  oms_baseline: 10,
});

class OmsForecastValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OmsForecastValidationError";
    this.code = code;
  }
}

const cleanText = (value) => String(value ?? "").trim();
const key = (value) => cleanText(value).toLowerCase();
const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const isoDate = (value) => {
  const parsed = dateParser(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
};
const addDays = (value, days) => {
  const parsed = dateParser(value);
  if (!parsed || !Number.isFinite(Number(days))) return null;
  return new Date(parsed.getTime() + Math.max(0, Number(days)) * DAY_MS);
};
const laterDate = (...values) => {
  const dates = values.map(dateParser).filter(Boolean);
  return dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null;
};
const percentile = (sortedValues, percentage) => {
  if (!sortedValues.length) return null;
  const index = (sortedValues.length - 1) * percentage;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
};
const roundDays = (value) => value === null ? null : Number(value.toFixed(1));

// A valid sample is the elapsed calendar time from PO order date to the first
// successful inspection for that PO/item. Transferred, rejected and reworked
// records are not completion evidence. Completed/packed/shipped order states
// keep incomplete or abandoned inspections out of the baseline.
const normalizeHistoricalSamples = (rows = [], { now = new Date() } = {}) => {
  const latestAllowed = dateParser(now)?.getTime() || Date.now();
  const samplesByPoItem = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const orderDate = dateParser(row?.order_date);
    const inspectionDate = dateParser(row?.inspection_date);
    const inspectionStatus = key(row?.inspection_status || row?.status);
    const orderStatus = key(row?.order_status || row?.po_status);
    const passed = number(row?.passed ?? row?.qc_passed);
    const hasCompletedOrderEvidence =
      COMPLETED_ORDER_STATUSES.has(orderStatus) ||
      number(row?.packed_quantity) > 0 ||
      number(row?.shipped_quantity) > 0;
    const isCompletedInspection =
      /inspection done|completed|passed/.test(inspectionStatus) &&
      !/reject|transfer|rework/.test(inspectionStatus) &&
      passed > 0;

    if (!orderDate || !inspectionDate || !hasCompletedOrderEvidence || !isCompletedInspection) {
      continue;
    }

    const elapsedDays = Math.round((inspectionDate.getTime() - orderDate.getTime()) / DAY_MS);
    if (elapsedDays < 0 || elapsedDays > 730 || inspectionDate.getTime() > latestAllowed) {
      continue;
    }

    const sample = {
      days: elapsedDays,
      orderId: cleanText(row?.order_id || row?.po || row?._id),
      itemCode: cleanText(row?.item_code),
      vendor: cleanText(row?.vendor),
      brand: cleanText(row?.brand),
      productType: cleanText(row?.product_type || row?.type),
      inspectionDate,
    };
    const sampleKey = `${key(sample.orderId)}|${key(sample.itemCode)}`;
    const previous = samplesByPoItem.get(sampleKey);
    if (!previous || inspectionDate < previous.inspectionDate) {
      samplesByPoItem.set(sampleKey, sample);
    }
  }

  return [...samplesByPoItem.values()];
};

const calculateLeadTimeStatistics = (samples = [], { now = new Date() } = {}) => {
  const normalized = (Array.isArray(samples) ? samples : [])
    .map((sample) => typeof sample === "number" ? { days: sample } : sample)
    .filter((sample) => Number.isFinite(Number(sample?.days)) && Number(sample.days) >= 0);
  if (!normalized.length) return null;

  const originalValues = normalized.map((sample) => Number(sample.days)).sort((a, b) => a - b);
  const q1 = percentile(originalValues, 0.25);
  const q3 = percentile(originalValues, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const kept = normalized.filter((sample) => {
    if (normalized.length < 4) return true;
    if (iqr === 0) return sample.days === q1;
    return sample.days >= lowerFence && sample.days <= upperFence;
  });
  const values = kept.map((sample) => Number(sample.days)).sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const recentCutoff = (dateParser(now)?.getTime() || Date.now()) - 365 * DAY_MS;
  const recentValues = kept
    .filter((sample) => sample.inspectionDate && dateParser(sample.inspectionDate)?.getTime() >= recentCutoff)
    .map((sample) => Number(sample.days))
    .sort((a, b) => a - b);
  const median = percentile(values, 0.5);
  const recentMedian = recentValues.length ? percentile(recentValues, 0.5) : null;

  return {
    sampleCount: values.length,
    originalSampleCount: originalValues.length,
    outlierCount: originalValues.length - values.length,
    meanDays: roundDays(mean),
    medianDays: roundDays(median),
    p50Days: roundDays(median),
    p75Days: roundDays(percentile(values, 0.75)),
    p90Days: roundDays(percentile(values, 0.9)),
    minimumDays: roundDays(values[0]),
    maximumDays: roundDays(values[values.length - 1]),
    standardDeviationDays: roundDays(Math.sqrt(variance)),
    iqrDays: roundDays(percentile(values, 0.75) - percentile(values, 0.25)),
    recentSampleCount: recentValues.length,
    recentMedianDays: roundDays(recentMedian),
    recentTrendDays: recentMedian === null ? null : roundDays(recentMedian - median),
  };
};

const confidenceForEstimate = ({ statistics, sourceLevel, missingRatio = 0 } = {}) => {
  if (!statistics) {
    return { label: "low", score: 0, components: { sample: 0, source: 0, consistency: 0, recency: 0, completeness: 0 } };
  }
  const sample = Math.min(35, statistics.sampleCount * 5);
  const source = SOURCE_SCORES[sourceLevel] || 0;
  const spreadRatio = statistics.medianDays > 0
    ? statistics.iqrDays / statistics.medianDays
    : statistics.iqrDays;
  const consistency = Math.max(0, Math.round(20 * (1 - Math.min(1, spreadRatio))));
  const recency = Math.round(10 * Math.min(1, statistics.recentSampleCount / Math.max(1, statistics.sampleCount)));
  const completeness = Math.max(0, Math.round(5 * (1 - Math.min(1, missingRatio))));
  const score = Math.max(0, Math.min(100, sample + source + consistency + recency + completeness));
  const label = score >= 75 && statistics.sampleCount >= 5
    ? "high"
    : score >= 50 ? "moderate" : "low";
  return { label, score, components: { sample, source, consistency, recency, completeness } };
};

const selectLeadTimeEstimate = (samples = [], criteria = {}, options = {}) => {
  const itemCode = key(criteria.itemCode);
  const vendor = key(criteria.vendor);
  const productType = key(criteria.productType);
  const levels = [
    ["same_item_same_vendor", (sample) => itemCode && vendor && key(sample.itemCode) === itemCode && key(sample.vendor) === vendor],
    ["same_item_all_vendors", (sample) => itemCode && key(sample.itemCode) === itemCode],
    ["same_product_type_same_vendor", (sample) => productType && vendor && key(sample.productType) === productType && key(sample.vendor) === vendor],
    ["vendor_wide", (sample) => vendor && key(sample.vendor) === vendor],
    ["oms_baseline", () => true],
  ];

  for (const [sourceLevel, matches] of levels) {
    const matching = samples.filter(matches);
    if (matching.length < (options.minimumSamples || MIN_HISTORY_SAMPLES)) continue;
    const statistics = calculateLeadTimeStatistics(matching, options);
    if (!statistics || statistics.sampleCount < (options.minimumSamples || MIN_HISTORY_SAMPLES)) continue;
    return {
      sourceLevel,
      ...statistics,
      confidence: confidenceForEstimate({ statistics, sourceLevel }),
    };
  }

  return null;
};

const getHistoricalInspectionLeadTime = (rows = [], filters = {}, options = {}) => {
  const samples = normalizeHistoricalSamples(rows, options);
  return selectLeadTimeEstimate(samples, filters, options);
};
const getItemInspectionLeadTimeEstimate = (rows, itemCode, vendor, options) =>
  getHistoricalInspectionLeadTime(rows, { itemCode, vendor }, options);
const getVendorInspectionLeadTimeEstimate = (rows, vendor, options) =>
  getHistoricalInspectionLeadTime(rows, { vendor }, options);
const getProductTypeLeadTimeEstimate = (rows, productType, vendor, options) =>
  getHistoricalInspectionLeadTime(rows, { productType, vendor }, options);

const getContainerTargetCbm = (value = process.env.OMS_CHAT_CONTAINER_TARGET_CBM) => {
  const parsed = Number(value);
  return parsed > 0 && parsed <= 1000 ? parsed : DEFAULT_CONTAINER_TARGET_CBM;
};

const resolveRowCbm = (row, quantity) => resolveOrderRowCbmSummaryWithStoredFallback({
  itemDoc: row?.item_doc || row?.itemDoc || row?.resolved_item || null,
  quantity,
  storedTotalCbm: number(row?.quantity) > 0
    ? number(row?.total_po_cbm) * (number(quantity) / number(row.quantity))
    : 0,
}).total;

const forecastOrderInspectionDate = ({ order, samples, now = new Date() } = {}) => {
  const estimate = selectLeadTimeEstimate(samples, {
    itemCode: order?.item_code || order?.item?.item_code,
    vendor: order?.vendor,
    productType: order?.product_type || order?.item_doc?.product_type || order?.item_doc?.type,
  }, { now });
  const orderDate = dateParser(order?.order_date);
  const effectiveEtd = dateParser(order?.revised_ETD || order?.revised_etd || order?.ETD || order?.etd);
  if (!orderDate || !estimate) {
    const currentDate = dateParser(now);
    const fallbackDate = effectiveEtd && currentDate && effectiveEtd >= currentDate
      ? effectiveEtd
      : null;
    return {
      estimate,
      earliestDate: isoDate(fallbackDate),
      planningDate: isoDate(fallbackDate),
      windowStart: isoDate(fallbackDate),
      windowEnd: isoDate(fallbackDate),
      usedEtdFallback: Boolean(fallbackDate),
      confidence: estimate?.confidence || confidenceForEstimate(),
    };
  }

  const earliest = laterDate(now, addDays(orderDate, estimate.medianDays));
  const planning = laterDate(now, addDays(orderDate, estimate.p75Days), effectiveEtd);
  const windowEnd = laterDate(planning, addDays(orderDate, estimate.p90Days));
  return {
    estimate,
    earliestDate: isoDate(earliest),
    planningDate: isoDate(planning),
    windowStart: isoDate(earliest),
    windowEnd: isoDate(windowEnd),
    effectiveEtd: isoDate(effectiveEtd),
    usedEtdFallback: false,
    confidence: estimate.confidence,
  };
};

const getReadyShipmentCbm = (orders = []) => toRoundedCbmValue(
  (Array.isArray(orders) ? orders : []).reduce((sum, order) => {
    const progress = deriveOrderProgress({
      orderEntry: order,
      qcRecord: order?.qc_record,
    });
    return sum + resolveRowCbm(order, progress.inspected_unshipped_quantity);
  }, 0),
);

const readyCbmMap = (rows = [], keyField) => new Map(
  (Array.isArray(rows) ? rows : []).map((row) => [
    key(row?.[keyField]),
    number(row?.ready_cbm ?? row?.currentReadyCbm ?? row?.total_cbm),
  ]).filter(([entryKey]) => entryKey),
);

const getRemainingContainerCbm = (readyCbm, targetCbm) =>
  toRoundedCbmValue(Math.max(0, getContainerTargetCbm(targetCbm) - number(readyCbm)));

const buildExpectedCbmTimeline = ({ currentReadyCbm = 0, targetCbm, contributions = [], now = new Date() } = {}) => {
  const target = getContainerTargetCbm(targetCbm);
  const grouped = new Map();
  for (const contribution of Array.isArray(contributions) ? contributions : []) {
    const date = isoDate(contribution?.date || contribution?.planningDate);
    const cbm = number(contribution?.cbm);
    if (!date || cbm <= 0) continue;
    const entry = grouped.get(date) || { date, addedCbm: 0, contributors: [] };
    entry.addedCbm += cbm;
    entry.contributors.push({
      orderId: cleanText(contribution?.orderId || contribution?.order_id),
      itemCode: cleanText(contribution?.itemCode || contribution?.item_code),
      cbm: toRoundedCbmValue(cbm),
    });
    grouped.set(date, entry);
  }

  let runningCbm = toRoundedCbmValue(currentReadyCbm);
  let thresholdCrossingDate = runningCbm >= target ? isoDate(now) : null;
  const timeline = [...grouped.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((entry) => {
      runningCbm = toRoundedCbmValue(runningCbm + entry.addedCbm);
      if (!thresholdCrossingDate && runningCbm >= target) thresholdCrossingDate = entry.date;
      return { ...entry, addedCbm: toRoundedCbmValue(entry.addedCbm), runningCbm };
    });

  return {
    currentReadyCbm: toRoundedCbmValue(currentReadyCbm),
    targetCbm: target,
    remainingCbm: getRemainingContainerCbm(currentReadyCbm, target),
    thresholdCrossingDate,
    projectedCbm: runningCbm,
    timeline,
  };
};

const combineConfidence = (contributions = []) => {
  const supported = contributions.filter((entry) => entry?.forecast?.estimate && number(entry.cbm) > 0);
  const totalCbm = contributions.reduce((sum, entry) => sum + number(entry.cbm), 0);
  const supportedCbm = supported.reduce((sum, entry) => sum + number(entry.cbm), 0);
  if (!supported.length || totalCbm <= 0) return confidenceForEstimate();
  const weightedScore = supported.reduce(
    (sum, entry) => sum + number(entry.forecast.confidence.score) * number(entry.cbm),
    0,
  ) / totalCbm;
  const score = Math.max(0, Math.min(100, Math.round(weightedScore)));
  const hasStrongSampleDepth = supported.every(
    (entry) => number(entry.forecast.estimate?.sampleCount) >= 5,
  );
  const evidenceCoverage = supportedCbm / totalCbm;
  return {
    label: score >= 75 && hasStrongSampleDepth && evidenceCoverage >= 0.8
      ? "high"
      : score >= 50 ? "moderate" : "low",
    score,
    supportedCbm: toRoundedCbmValue(supportedCbm),
    evidenceCoverage: Number(evidenceCoverage.toFixed(2)),
  };
};

const forecastVendorNextShipment = ({
  vendor,
  orders = [],
  historicalRows = [],
  readyCbmByBrand = null,
  targetCbm,
  now = new Date(),
} = {}) => {
  const target = getContainerTargetCbm(targetCbm);
  const normalizedSamples = normalizeHistoricalSamples(historicalRows, { now });
  const vendorKey = key(vendor);
  const vendorOrders = (Array.isArray(orders) ? orders : []).filter(
    (order) => !vendorKey || key(order?.vendor) === vendorKey,
  );
  const brandGroups = new Map();
  const canonicalReady = readyCbmByBrand === null
    ? null
    : readyCbmMap(readyCbmByBrand, "brand");

  for (const order of vendorOrders) {
    const brand = cleanText(order?.brand) || "Unspecified brand";
    const group = brandGroups.get(brand) || { brand, orders: [] };
    group.orders.push(order);
    brandGroups.set(brand, group);
  }

  canonicalReady?.forEach((_readyCbm, brandKey) => {
    if ([...brandGroups.keys()].some((brand) => key(brand) === brandKey)) return;
    const source = readyCbmByBrand.find((entry) => key(entry?.brand) === brandKey);
    const brand = cleanText(source?.brand) || "Unspecified brand";
    brandGroups.set(brand, { brand, orders: [] });
  });

  const brands = [...brandGroups.values()].map((group) => {
    const readyCbm = canonicalReady === null
      ? getReadyShipmentCbm(group.orders)
      : toRoundedCbmValue(canonicalReady.get(key(group.brand)) || 0);
    const contributions = group.orders.flatMap((order) => {
      const progress = deriveOrderProgress({ orderEntry: order, qcRecord: order?.qc_record });
      if (progress.pending_inspection_quantity <= 0) return [];
      const cbm = toRoundedCbmValue(resolveRowCbm(order, progress.pending_inspection_quantity));
      if (cbm <= 0) return [];
      const forecast = forecastOrderInspectionDate({ order, samples: normalizedSamples, now });
      if (!forecast.planningDate) return [];
      return [{
        orderId: cleanText(order?.order_id),
        itemCode: cleanText(order?.item_code || order?.item?.item_code),
        pendingQuantity: progress.pending_inspection_quantity,
        cbm,
        date: forecast.planningDate,
        forecast,
      }];
    });
    const readiness = buildExpectedCbmTimeline({ currentReadyCbm: readyCbm, targetCbm: target, contributions, now });
    const earliestReadiness = buildExpectedCbmTimeline({
      currentReadyCbm: readyCbm,
      targetCbm: target,
      now,
      contributions: contributions.map((entry) => ({ ...entry, date: entry.forecast.earliestDate })),
    });
    return {
      brand: group.brand,
      readyCbm,
      remainingCbm: readiness.remainingCbm,
      earliestThresholdCrossingDate: earliestReadiness.thresholdCrossingDate,
      thresholdCrossingDate: readiness.thresholdCrossingDate,
      projectedCbm: readiness.projectedCbm,
      timeline: readiness.timeline,
      contributingOrders: contributions.map(({ forecast, ...entry }) => ({
        ...entry,
        forecast: {
          earliestDate: forecast.earliestDate,
          planningDate: forecast.planningDate,
          windowEnd: forecast.windowEnd,
          effectiveEtd: forecast.effectiveEtd,
          sourceLevel: forecast.estimate?.sourceLevel || "etd_only",
          sampleCount: forecast.estimate?.sampleCount || 0,
          confidence: forecast.confidence,
        },
      })),
      confidence: readyCbm >= target
        ? { label: "high", score: 100, supportedCbm: readyCbm, evidenceCoverage: 1 }
        : combineConfidence(contributions),
    };
  });

  brands.sort((left, right) => {
    if (left.readyCbm >= target && right.readyCbm < target) return -1;
    if (right.readyCbm >= target && left.readyCbm < target) return 1;
    if (left.thresholdCrossingDate && right.thresholdCrossingDate) {
      return left.thresholdCrossingDate.localeCompare(right.thresholdCrossingDate);
    }
    if (left.thresholdCrossingDate) return -1;
    if (right.thresholdCrossingDate) return 1;
    return right.projectedCbm - left.projectedCbm;
  });

  const nextShipment = brands[0] || null;
  const evidenceSources = nextShipment?.contributingOrders
    ?.map((entry) => entry.forecast.sourceLevel)
    .filter(Boolean) || [];
  const sampleCounts = nextShipment?.contributingOrders
    ?.map((entry) => entry.forecast.sampleCount) || [];
  const planningDate = nextShipment?.thresholdCrossingDate || null;
  const earliestDate = nextShipment?.earliestThresholdCrossingDate || planningDate;
  const crossingForecasts = nextShipment?.contributingOrders?.filter(
    (entry) => planningDate && entry.forecast.planningDate <= planningDate,
  ) || [];
  const windowEnd = isoDate(laterDate(
    planningDate,
    ...crossingForecasts.map((entry) => entry.forecast.windowEnd),
  ));

  return {
    analysisType: "vendor_next_shipment_forecast",
    answerType: "forecast",
    vendor: cleanText(vendor),
    targetCbm: target,
    status: !nextShipment
      ? "no_open_orders"
      : nextShipment.readyCbm >= target
        ? "ready_now"
        : nextShipment.thresholdCrossingDate
          ? "forecast_ready"
          : "threshold_not_reached",
    brands,
    nextShipment,
    confidence: nextShipment?.confidence || confidenceForEstimate(),
    forecast: {
      earliestDate,
      planningDate,
      windowStart: earliestDate,
      windowEnd,
    },
    evidence: {
      historicalSampleCount: Math.max(0, ...sampleCounts),
      leadTimeSource: [...new Set(evidenceSources)].join(", ") || "none",
      validHistoricalSamples: normalizedSamples.length,
    },
  };
};

const forecastNextContainerReadiness = forecastVendorNextShipment;

const forecastBrandNextContainerVendor = ({
  brand,
  orders = [],
  historicalRows = [],
  readyCbmByVendor = null,
  targetCbm,
  now = new Date(),
} = {}) => {
  const target = getContainerTargetCbm(targetCbm);
  const brandKey = key(brand);
  const vendorGroups = new Map();
  const canonicalReady = readyCbmByVendor === null
    ? null
    : readyCbmMap(readyCbmByVendor, "vendor");

  for (const order of Array.isArray(orders) ? orders : []) {
    if (brandKey && key(order?.brand) !== brandKey) continue;
    const vendor = cleanText(order?.vendor) || "Unspecified vendor";
    const group = vendorGroups.get(vendor) || { vendor, orders: [] };
    group.orders.push(order);
    vendorGroups.set(vendor, group);
  }

  canonicalReady?.forEach((_readyCbm, vendorKey) => {
    if ([...vendorGroups.keys()].some((vendor) => key(vendor) === vendorKey)) return;
    const source = readyCbmByVendor.find((entry) => key(entry?.vendor) === vendorKey);
    const vendor = cleanText(source?.vendor) || "Unspecified vendor";
    vendorGroups.set(vendor, { vendor, orders: [] });
  });

  const vendors = [...vendorGroups.values()].map((group) => {
    const currentReadyCbm = canonicalReady === null
      ? null
      : toRoundedCbmValue(canonicalReady.get(key(group.vendor)) || 0);
    const shipment = forecastVendorNextShipment({
      vendor: group.vendor,
      orders: group.orders,
      historicalRows,
      readyCbmByBrand: currentReadyCbm === null
        ? null
        : [{ brand: cleanText(brand) || "Unspecified brand", ready_cbm: currentReadyCbm }],
      targetCbm: target,
      now,
    });
    const nextShipment = shipment.nextShipment;
    return {
      vendor: group.vendor,
      status: shipment.status,
      currentReadyCbm: nextShipment?.readyCbm || 0,
      remainingCbm: nextShipment?.remainingCbm ?? target,
      projectedCbm: nextShipment?.projectedCbm || 0,
      thresholdCrossingDate: nextShipment?.thresholdCrossingDate || null,
      earliestThresholdCrossingDate: nextShipment?.earliestThresholdCrossingDate || null,
      contributingOrders: nextShipment?.contributingOrders || [],
      confidence: shipment.confidence,
      evidence: shipment.evidence,
      forecast: shipment.forecast,
    };
  });

  vendors.sort((left, right) => {
    const leftReady = left.currentReadyCbm >= target;
    const rightReady = right.currentReadyCbm >= target;
    if (leftReady !== rightReady) return leftReady ? -1 : 1;
    if (left.thresholdCrossingDate && right.thresholdCrossingDate) {
      const dateOrder = left.thresholdCrossingDate.localeCompare(right.thresholdCrossingDate);
      if (dateOrder) return dateOrder;
    } else if (left.thresholdCrossingDate || right.thresholdCrossingDate) {
      return left.thresholdCrossingDate ? -1 : 1;
    } else if (left.projectedCbm !== right.projectedCbm) {
      return right.projectedCbm - left.projectedCbm;
    }
    if (left.confidence.score !== right.confidence.score) {
      return right.confidence.score - left.confidence.score;
    }
    if (left.currentReadyCbm !== right.currentReadyCbm) {
      return right.currentReadyCbm - left.currentReadyCbm;
    }
    if (left.remainingCbm !== right.remainingCbm) {
      return left.remainingCbm - right.remainingCbm;
    }
    return left.vendor.localeCompare(right.vendor);
  });

  const mostLikelyVendor = vendors[0] || null;
  return {
    analysisType: "brand_next_container_vendor_forecast",
    answerType: "forecast",
    brand: cleanText(brand),
    targetCbm: target,
    status: !mostLikelyVendor
      ? "no_open_orders"
      : mostLikelyVendor.currentReadyCbm >= target
        ? "ready_now"
        : mostLikelyVendor.thresholdCrossingDate
          ? "forecast_ready"
          : "threshold_not_reached",
    vendors,
    mostLikelyVendor,
    confidence: mostLikelyVendor?.confidence || confidenceForEstimate(),
    forecast: mostLikelyVendor?.forecast || {
      earliestDate: null,
      planningDate: null,
      windowStart: null,
      windowEnd: null,
    },
    evidence: {
      candidateVendorCount: vendors.length,
      historicalSampleCount: mostLikelyVendor?.evidence?.historicalSampleCount || 0,
      leadTimeSource: mostLikelyVendor?.evidence?.leadTimeSource || "none",
    },
  };
};

const forecastOpenOrderInspectionDates = ({ orders = [], historicalRows = [], now = new Date() } = {}) => {
  const samples = normalizeHistoricalSamples(historicalRows, { now });
  return orders
    .map((order) => {
      const progress = deriveOrderProgress({ orderEntry: order, qcRecord: order?.qc_record });
      if (progress.status === "Shipped" || progress.pending_inspection_quantity <= 0) return null;
      return {
        orderId: cleanText(order?.order_id),
        itemCode: cleanText(order?.item_code || order?.item?.item_code),
        vendor: cleanText(order?.vendor),
        brand: cleanText(order?.brand),
        inspectionStatus: progress.status,
        orderQuantity: progress.order_quantity,
        passedQuantity: progress.passed_quantity,
        pendingInspectionQuantity: progress.pending_inspection_quantity,
        inspectionCompletionPercent: progress.order_quantity > 0
          ? Number(((progress.passed_quantity / progress.order_quantity) * 100).toFixed(1))
          : 0,
        ...forecastOrderInspectionDate({ order, samples, now }),
      };
    })
    .filter(Boolean)
    .sort((left, right) =>
      right.inspectionCompletionPercent - left.inspectionCompletionPercent
      || left.pendingInspectionQuantity - right.pendingInspectionQuantity
      || String(left.planningDate || "9999").localeCompare(String(right.planningDate || "9999"))
      || left.orderId.localeCompare(right.orderId));
};

const escapeRegex = (value) => cleanText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exactTextMatch = (value) => ({
  $regex: `^${cleanText(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(escapeRegex).join("[\\s_\\-/‐-―]+")}$`,
  $options: "i",
});

const buildHistoricalInspectionPipeline = () => [
  {
    $match: {
      archived: { $ne: true },
      status: { $in: ["Inspection Done", "Partial Shipped", "Shipped"] },
      qc_record: { $exists: true, $ne: null },
    },
  },
  { $lookup: { from: "qcs", localField: "qc_record", foreignField: "_id", as: "qc" } },
  { $unwind: "$qc" },
  { $lookup: { from: "inspections", localField: "qc.inspection_record", foreignField: "_id", as: "inspection" } },
  { $unwind: "$inspection" },
  {
    $match: {
      "inspection.status": { $regex: "^Inspection Done$", $options: "i" },
      "inspection.passed": { $gt: 0 },
    },
  },
  { $lookup: { from: "items", localField: "item.item_code", foreignField: "code", as: "item_doc" } },
  { $unwind: { path: "$item_doc", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      _id: 0,
      order_id: 1,
      item_code: "$item.item_code",
      vendor: "$__oms_vendor_name",
      brand: 1,
      product_type: { $ifNull: ["$item_doc.product_type", "$item_doc.type"] },
      order_date: 1,
      inspection_date: "$inspection.inspection_date",
      inspection_status: "$inspection.status",
      passed: "$inspection.passed",
      order_status: "$status",
      shipped_quantity: { $sum: "$shipment.quantity" },
    },
  },
  { $sort: { inspection_date: -1, order_id: 1 } },
];

const buildOpenOrderPipeline = ({ vendor, brand, itemCode } = {}) => {
  const match = { archived: { $ne: true }, status: { $nin: ["Cancelled", "Shipped"] } };
  if (vendor) match.__oms_vendor_name = exactTextMatch(vendor);
  if (brand) match.brand = exactTextMatch(brand);
  if (itemCode) match["item.item_code"] = exactTextMatch(itemCode);

  return [
    { $match: match },
    { $lookup: { from: "qcs", localField: "qc_record", foreignField: "_id", as: "qc" } },
    { $unwind: { path: "$qc", preserveNullAndEmptyArrays: true } },
    { $lookup: { from: "items", localField: "item.item_code", foreignField: "code", as: "item_doc" } },
    { $unwind: { path: "$item_doc", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        order_id: 1,
        item_code: "$item.item_code",
        vendor: "$__oms_vendor_name",
        brand: 1,
        product_type: { $ifNull: ["$item_doc.product_type", "$item_doc.type"] },
        order_date: 1,
        ETD: 1,
        revised_ETD: 1,
        status: 1,
        quantity: 1,
        total_po_cbm: 1,
        shipped_quantity: { $sum: "$shipment.quantity" },
        qc_passed: "$qc.quantities.qc_passed",
        qc_quantity_requested: "$qc.quantities.quantity_requested",
        qc_latest_request: { $arrayElemAt: ["$qc.request_history", -1] },
        inspected_item_sizes: "$item_doc.inspected_item_sizes",
        pis_item_sizes: "$item_doc.pis_item_sizes",
        inspected_box_sizes: "$item_doc.inspected_box_sizes",
        inspected_box_mode: "$item_doc.inspected_box_mode",
        pis_box_sizes: "$item_doc.pis_box_sizes",
        pis_box_mode: "$item_doc.pis_box_mode",
        item_cbm: "$item_doc.cbm",
      },
    },
    { $sort: { revised_ETD: 1, ETD: 1, order_id: 1 } },
  ];
};

const ANALYSIS_TYPES = Object.freeze([
  "historical_inspection_lead_time",
  "open_order_inspection_forecast",
  "brand_ready_cbm",
  "vendor_next_shipment_forecast",
  "brand_next_container_vendor_forecast",
]);

const validateAnalyticsRequest = (request = {}) => {
  const allowed = new Set(["analysisType", "vendor", "brand", "itemCode", "productType", "targetCbm"]);
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new OmsForecastValidationError("analytics_arguments_invalid", "Analytics arguments must be an object");
  }
  for (const property of Object.keys(request)) {
    if (!allowed.has(property)) {
      throw new OmsForecastValidationError("analytics_argument_unsupported", "Analytics request includes an unsupported argument");
    }
  }
  if (!ANALYSIS_TYPES.includes(request.analysisType)) {
    throw new OmsForecastValidationError("analysis_type_unsupported", "Unsupported OMS analysis type");
  }
  const normalized = { analysisType: request.analysisType };
  for (const property of ["vendor", "brand", "itemCode", "productType"]) {
    if (request[property] === undefined) continue;
    const value = cleanText(request[property]);
    if (!value || value.length > 120) {
      throw new OmsForecastValidationError("analytics_field_invalid", "An analytics text field is invalid");
    }
    normalized[property] = value;
  }
  if (request.targetCbm !== undefined) {
    const targetCbm = Number(request.targetCbm);
    if (!Number.isFinite(targetCbm) || targetCbm <= 0 || targetCbm > 1000) {
      throw new OmsForecastValidationError("target_cbm_invalid", "The container target is invalid");
    }
    normalized.targetCbm = targetCbm;
  }
  if (request.analysisType === "vendor_next_shipment_forecast" && !normalized.vendor) {
    throw new OmsForecastValidationError("vendor_required", "A vendor is required for a vendor shipment forecast");
  }
  if (request.analysisType === "brand_next_container_vendor_forecast" && !normalized.brand) {
    throw new OmsForecastValidationError("brand_required", "A brand is required for a brand vendor forecast");
  }
  return normalized;
};

const combineQueryAudit = (results = []) => ({
  collections: results.flatMap((result) => result?.audit?.collections || [result?.audit?.collection]).filter(Boolean),
  stageCount: results.reduce((sum, result) => sum + number(result?.audit?.stageCount), 0),
  durationMs: results.reduce((sum, result) => sum + number(result?.audit?.durationMs), 0),
  returnedRows: results.reduce((sum, result) => sum + number(result?.audit?.returnedRows), 0),
  truncated: results.some((result) => Boolean(result?.audit?.truncated)),
});

const hydrateForecastOrder = (row = {}) => ({
  ...row,
  shipment: row.shipment || [{ quantity: row.shipped_quantity }],
  qc_record: row.qc_record || {
    quantities: {
      qc_passed: row.qc_passed,
      quantity_requested: row.qc_quantity_requested,
    },
    request_history: row.qc_latest_request
      ? [row.qc_latest_request]
      : row.qc_request_history,
  },
  item_doc: row.item_doc || {
    inspected_item_sizes: row.inspected_item_sizes,
    pis_item_sizes: row.pis_item_sizes,
    inspected_box_sizes: row.inspected_box_sizes,
    inspected_box_mode: row.inspected_box_mode,
    pis_box_sizes: row.pis_box_sizes,
    pis_box_mode: row.pis_box_mode,
    cbm: row.item_cbm,
    product_type: row.product_type,
  },
});

const runOmsForecastAnalysis = async (
  request,
  {
    queryExecutor,
    capabilityExecutor = executeOmsCapability,
    capabilityDependencies,
    user,
    now = new Date(),
  } = {},
) => {
  const args = validateAnalyticsRequest(request);
  if (typeof queryExecutor !== "function") throw new TypeError("queryExecutor is required");
  const results = [];
  const capabilityResults = [];
  const query = async (payload) => {
    const result = await queryExecutor({ ...payload, user });
    results.push(result);
    return result;
  };
  const capability = async (payload) => {
    const result = await capabilityExecutor(payload, {
      ...capabilityDependencies,
      now,
    });
    capabilityResults.push(result);
    return result;
  };

  if (args.analysisType === "historical_inspection_lead_time") {
    const history = await query({
      collection: "orders",
      pipeline: buildHistoricalInspectionPipeline(),
      purpose: "Calculate validated historical inspection lead-time evidence",
    });
    const analysis = getHistoricalInspectionLeadTime(history.rows, args, { now });
    const audit = combineQueryAudit(results);
    return {
      analysisType: args.analysisType,
      analysis,
      databaseCalls: 1,
      partialResults: audit.truncated,
      limitations: audit.truncated ? [TRUNCATED_EVIDENCE_LIMITATION] : [],
      audit,
    };
  }

  if (args.analysisType === "brand_ready_cbm") {
    const ready = await capability({
      capability: "packed_goods",
      filters: args.brand ? { brand: [args.brand] } : {},
      operation: {
        type: "group",
        groupBy: ["brand"],
        metrics: [{ operation: "sum", field: "total_cbm", as: "ready_cbm" }],
        sort: [{ field: "ready_cbm", direction: "desc" }],
        limit: 100,
      },
    });
    return {
      analysisType: args.analysisType,
      analysis: ready.grouped.map((entry) => ({ brand: entry.brand, readyCbm: entry.ready_cbm })),
      databaseCalls: ready.databaseCalls,
      capabilityCalls: 1,
      capabilitiesUsed: ["packed_goods"],
      partialResults: Boolean(ready.truncated),
      limitations: ready.truncated ? [TRUNCATED_EVIDENCE_LIMITATION] : [],
      audit: {
        collections: ready.audit?.collections || [],
        stageCount: Number(ready.audit?.stageCount || 0),
        durationMs: Number(ready.durationMs || 0),
        returnedRows: ready.grouped.length,
        truncated: Boolean(ready.truncated),
      },
    };
  }

  const current = await query({
    collection: "orders",
    pipeline: buildOpenOrderPipeline(args),
    purpose: "Calculate current open-order inspection and shipment readiness",
  });
  const currentOrders = current.rows
    .map(hydrateForecastOrder)
    .filter((order) => deriveOrderProgress({
      orderEntry: order,
      qcRecord: order.qc_record,
    }).status !== "Shipped");

  let canonicalReady = null;
  if (["vendor_next_shipment_forecast", "brand_next_container_vendor_forecast"].includes(args.analysisType)) {
    const groupField = args.analysisType === "brand_next_container_vendor_forecast" ? "vendor" : "brand";
    canonicalReady = await capability({
      capability: "packed_goods",
      filters: {
        ...(args.brand ? { brand: [args.brand] } : {}),
        ...(args.vendor ? { vendor: args.vendor } : {}),
      },
      operation: {
        type: "group",
        groupBy: [groupField],
        metrics: [{ operation: "sum", field: "total_cbm", as: "ready_cbm" }],
        sort: [{ field: "ready_cbm", direction: "desc" }],
        limit: 100,
      },
    });
  }

  let history;
  let historyFailure = null;
  try {
    history = await query({
      collection: "orders",
      pipeline: buildHistoricalInspectionPipeline(),
      purpose: "Calculate historical evidence for open-order forecasting",
    });
  } catch (error) {
    if (!["database_timeout", "chat_database_unavailable"].includes(error?.category)) throw error;
    historyFailure = error;
    history = { rows: [] };
  }
  const analysis = args.analysisType === "open_order_inspection_forecast"
    ? forecastOpenOrderInspectionDates({ orders: currentOrders, historicalRows: history.rows, now })
    : args.analysisType === "brand_next_container_vendor_forecast"
      ? forecastBrandNextContainerVendor({
          brand: args.brand,
          orders: currentOrders,
          historicalRows: history.rows,
          readyCbmByVendor: canonicalReady?.grouped || [],
          targetCbm: args.targetCbm,
          now,
        })
    : forecastVendorNextShipment({
        vendor: args.vendor,
        orders: currentOrders,
        historicalRows: history.rows,
        readyCbmByBrand: canonicalReady?.grouped || [],
        targetCbm: args.targetCbm,
        now,
      });
  const capabilityDatabaseCalls = capabilityResults.reduce(
    (sum, result) => sum + number(result?.databaseCalls),
    0,
  );
  const queryAudit = combineQueryAudit([
    ...results,
    ...(historyFailure?.audit ? [{ audit: historyFailure.audit }] : []),
  ]);
  const evidenceTruncated = queryAudit.truncated
    || capabilityResults.some((result) => result?.truncated);
  return {
    analysisType: args.analysisType,
    analysis,
    databaseCalls: results.length + (historyFailure ? 1 : 0) + capabilityDatabaseCalls,
    capabilityCalls: capabilityResults.length,
    capabilitiesUsed: [...new Set(capabilityResults.map((result) => result?.capability?.id).filter(Boolean))],
    partialResults: Boolean(historyFailure) || evidenceTruncated,
    limitations: [
      ...(historyFailure
        ? ["Historical inspection evidence was unavailable; only current order and future ETD evidence could be used."]
        : []),
      ...(evidenceTruncated ? [TRUNCATED_EVIDENCE_LIMITATION] : []),
    ],
    audit: {
      ...queryAudit,
      collections: [...new Set([
        ...queryAudit.collections,
        ...capabilityResults.flatMap((result) => result?.audit?.collections || []),
      ])],
      durationMs: queryAudit.durationMs + capabilityResults.reduce(
        (sum, result) => sum + number(result?.durationMs),
        0,
      ),
      returnedRows: queryAudit.returnedRows + capabilityResults.reduce(
        (sum, result) => sum + number(result?.grouped?.length || result?.rows?.length),
        0,
      ),
      truncated: evidenceTruncated,
    },
  };
};

module.exports = {
  ANALYSIS_TYPES,
  DEFAULT_CONTAINER_TARGET_CBM,
  MIN_HISTORY_SAMPLES,
  OmsForecastValidationError,
  buildExpectedCbmTimeline,
  calculateLeadTimeStatistics,
  confidenceForEstimate,
  forecastNextContainerReadiness,
  forecastBrandNextContainerVendor,
  forecastOpenOrderInspectionDates,
  forecastOrderInspectionDate,
  forecastVendorNextShipment,
  getContainerTargetCbm,
  getHistoricalInspectionLeadTime,
  getItemInspectionLeadTimeEstimate,
  getProductTypeLeadTimeEstimate,
  getReadyShipmentCbm,
  getRemainingContainerCbm,
  getVendorInspectionLeadTimeEstimate,
  normalizeHistoricalSamples,
  runOmsForecastAnalysis,
  selectLeadTimeEstimate,
  validateAnalyticsRequest,
  __test__: {
    buildHistoricalInspectionPipeline,
    buildOpenOrderPipeline,
  },
};
