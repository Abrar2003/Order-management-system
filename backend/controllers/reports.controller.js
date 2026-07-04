const mongoose = require("mongoose");
const XLSX = require("xlsx");

const Inspection = require("../models/inspection.model");
const QC = require("../models/qc.model");
const Item = require("../models/item.model");
const Order = require("../models/order.model");
const { applyDataAccessMatch } = require("../services/userDataAccess.service");
const {
  getMonthlyShipmentsDrilldownData,
  getMonthlyShipmentsReportData,
} = require("../services/monthlyShipmentsReport.service");
const {
  buildNormalizedInspectionSizeState,
  compareInspectionSizeSnapshot,
  normalizeNumber,
} = require("../helpers/inspectionSizeSnapshot");
const {
  evaluateCommonInspectionErrors,
} = require("../helpers/commonInspectionErrors");

const normalizeText = (value) => String(value ?? "").trim();
const escapeRegex = (value = "") =>
  String(value)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

const INSPECTED_ITEMS_REPORT_LIMIT = 200;
const INSPECTED_ITEMS_REPORT_SELECT = [
  "code",
  "name",
  "description",
  "brand",
  "brand_name",
  "brands",
  "vendors",
  "image",
  "cad_file",
  "pis_file",
  "assembly_file",
  "mounting_file",
  "mounting_file_needed",
  "packeging_ppt",
  "kd",
  "finish",
  "qc",
  "source",
  "shipping_marks",
  "inspected_item_sizes",
  "inspected_box_sizes",
  "pd_checked",
  "updatedAt",
].join(" ");
const INSPECTED_ITEMS_ORDER_SELECT = [
  "item",
  "brand",
  "vendor",
  "status",
  "qc_record",
  "updatedAt",
].join(" ");

const INSPECTED_ITEM_CRITERIA = Object.freeze({
  INSPECTED: "inspected",
  CAD: "cad",
  PIS: "pis",
  ASSEMBLY: "assembly",
  MOUNTING_FILE: "mounting_file",
  PACKAGING_PPT: "packaging_ppt",
  PRODUCT_IMAGE: "product_image",
  FINISH: "finish",
  SHIPPING_MARKS: "shipping_marks",
  EAN: "ean",
  FLAT_CARTON: "flat_carton",
  THREE_D_CARTON: "three_d_carton",
  PRODUCT_DATABASE: "product_database",
});

const normalizeInspectedItemsCodeKey = (value) =>
  normalizeText(value).toLocaleLowerCase();

const normalizeDistinctTextValues = (values = []) => [
  ...new Map(
    (Array.isArray(values) ? values : [])
      .map(normalizeText)
      .filter(Boolean)
      .map((value) => [value.toLocaleLowerCase(), value]),
  ).values(),
];

const getLatestInspectedItemsDate = (...values) =>
  values
    .map((value) => ({
      value: normalizeText(value),
      timestamp: getDateOnlyTimestamp(value),
    }))
    .filter((entry) => entry.value)
    .sort((left, right) => right.timestamp - left.timestamp)[0]?.value || "";

const buildOrderItemReportGroups = (orders = []) => {
  const groups = new Map();

  for (const order of Array.isArray(orders) ? orders : []) {
    if (normalizeText(order?.status).toLocaleLowerCase() === "cancelled") {
      continue;
    }
    const code = normalizeText(order?.item?.item_code);
    const key = normalizeInspectedItemsCodeKey(code);
    if (!key) continue;

    const existing = groups.get(key) || {
      key,
      code,
      description: "",
      brands: [],
      vendors: [],
      last_inspected_date: "",
      inspected: false,
      updated_at: null,
    };
    const qc = order?.qc_record || {};
    const qcInspected = Boolean(
      normalizeText(qc?.last_inspected_date) ||
        Number(qc?.quantities?.checked || 0) > 0 ||
        Number(qc?.quantities?.passed || 0) > 0,
    );

    if (!existing.description) {
      existing.description = normalizeText(order?.item?.description);
    }
    existing.brands = normalizeDistinctTextValues([
      ...existing.brands,
      order?.brand,
    ]);
    existing.vendors = normalizeDistinctTextValues([
      ...existing.vendors,
      order?.vendor,
    ]);
    existing.last_inspected_date = getLatestInspectedItemsDate(
      existing.last_inspected_date,
      qc?.last_inspected_date,
    );
    existing.inspected = existing.inspected || qcInspected;
    existing.updated_at = existing.updated_at || order?.updatedAt || null;
    groups.set(key, existing);
  }

  return groups;
};

const buildOrderOnlyInspectedItemsSource = (group = {}) => ({
  _id: `order:${encodeURIComponent(normalizeText(group?.key))}`,
  code: normalizeText(group?.code),
  name: "",
  description: normalizeText(group?.description),
  brand: normalizeText(group?.brands?.[0]),
  brands: normalizeDistinctTextValues(group?.brands),
  vendors: normalizeDistinctTextValues(group?.vendors),
  qc: {
    last_inspected_date: normalizeText(group?.last_inspected_date),
    quantities: {
      checked: group?.inspected ? 1 : 0,
      passed: 0,
    },
  },
  updatedAt: group?.updated_at || null,
});

const mergeInspectedItemsSources = (items = [], orders = []) => {
  const orderGroups = buildOrderItemReportGroups(orders);
  const mergedSources = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const code = normalizeText(item?.code);
    const key = normalizeInspectedItemsCodeKey(code);
    if (!key) continue;

    const orderGroup = orderGroups.get(key);
    if (!mergedSources.has(key)) {
      const masterBrands = normalizeDistinctTextValues([
        item?.brand,
        item?.brand_name,
        ...(Array.isArray(item?.brands) ? item.brands : []),
      ]);
      const masterVendors = normalizeDistinctTextValues(item?.vendors);
      const masterLastInspectedDate = normalizeText(item?.qc?.last_inspected_date);
      const orderLastInspectedDate = normalizeText(orderGroup?.last_inspected_date);
      const orderInspected = orderGroup?.inspected === true;

      mergedSources.set(key, {
        ...item,
        code,
        description:
          normalizeText(item?.description) ||
          normalizeText(orderGroup?.description),
        brand:
          normalizeText(item?.brand || item?.brand_name) ||
          normalizeText(orderGroup?.brands?.[0]),
        brands:
          masterBrands.length > 0
            ? masterBrands
            : normalizeDistinctTextValues(orderGroup?.brands),
        vendors:
          masterVendors.length > 0
            ? masterVendors
            : normalizeDistinctTextValues(orderGroup?.vendors),
        qc: {
          ...(item?.qc || {}),
          last_inspected_date: getLatestInspectedItemsDate(
            masterLastInspectedDate,
            orderLastInspectedDate,
          ),
          quantities: {
            ...(item?.qc?.quantities || {}),
            checked:
              Number(item?.qc?.quantities?.checked || 0) > 0 || orderInspected
                ? Math.max(1, Number(item?.qc?.quantities?.checked || 0))
                : 0,
          },
        },
      });
    }

    orderGroups.delete(key);
  }

  for (const group of orderGroups.values()) {
    mergedSources.set(group.key, buildOrderOnlyInspectedItemsSource(group));
  }

  return [...mergedSources.values()];
};

const matchesInspectedItemsReportFilters = (
  row = {},
  { search, brand, vendor } = {},
) => {
  const normalizedSearch = normalizeText(search).toLocaleLowerCase();
  const normalizedBrand = normalizeText(brand).toLocaleLowerCase();
  const normalizedVendor = normalizeText(vendor).toLocaleLowerCase();
  const rowBrands = normalizeDistinctTextValues([
    row?.brand,
    ...(Array.isArray(row?.brands) ? row.brands : []),
  ]).map((value) => value.toLocaleLowerCase());
  const rowVendors = normalizeDistinctTextValues(row?.vendors)
    .map((value) => value.toLocaleLowerCase());

  if (normalizedSearch && normalizedSearch !== "all") {
    const searchableValues = [
      row?.code,
      row?.name,
      row?.description,
      ...rowBrands,
    ].map((value) => normalizeText(value).toLocaleLowerCase());
    if (!searchableValues.some((value) => value.includes(normalizedSearch))) {
      return false;
    }
  }

  if (
    normalizedBrand &&
    normalizedBrand !== "all" &&
    !rowBrands.includes(normalizedBrand)
  ) {
    return false;
  }

  if (
    normalizedVendor &&
    normalizedVendor !== "all" &&
    !rowVendors.includes(normalizedVendor)
  ) {
    return false;
  }

  return true;
};

const hasStoredItemFile = (file = {}) =>
  Boolean(normalizeText(file?.key || file?.url || file?.link || file?.public_id));

const hasFinishUploaded = (item = {}) =>
  Array.isArray(item?.finish) && item.finish.some((entry) =>
    normalizeText(entry?.unique_code || entry?.color || entry?.finish_id || entry?.image?.key),
  );

const hasShippingMarksUploaded = (item = {}) => {
  const marks = item?.shipping_marks || {};
  return (
    (Array.isArray(marks.files) && marks.files.some((file) => hasStoredItemFile(file))) ||
    hasStoredItemFile(marks.shipping_marks_1) ||
    hasStoredItemFile(marks.shipping_marks_2) ||
    hasStoredItemFile(marks.ean) ||
    (Array.isArray(marks.flat_carton) && marks.flat_carton.some((file) => hasStoredItemFile(file))) ||
    hasStoredItemFile(marks.flat_carton_1) ||
    hasStoredItemFile(marks.flat_carton_2) ||
    hasStoredItemFile(marks.three_d_carton)
  );
};

const hasItemBeenInspected = (item = {}) =>
  Boolean(
    normalizeText(item?.qc?.last_inspected_date) ||
      Number(item?.qc?.quantities?.checked || 0) > 0 ||
      Number(item?.qc?.quantities?.passed || 0) > 0 ||
      item?.source?.from_qc === true ||
      (Array.isArray(item?.inspected_item_sizes) && item.inspected_item_sizes.length > 0) ||
      (Array.isArray(item?.inspected_box_sizes) && item.inspected_box_sizes.length > 0),
  );

const hasEanUploaded = (item = {}) => {
  const marks = item?.shipping_marks || {};
  return hasStoredItemFile(marks.ean);
};

const hasFlatCartonUploaded = (item = {}) => {
  const marks = item?.shipping_marks || {};
  return (
    (Array.isArray(marks.flat_carton) && marks.flat_carton.some((file) => hasStoredItemFile(file))) ||
    hasStoredItemFile(marks.flat_carton_1) ||
    hasStoredItemFile(marks.flat_carton_2)
  );
};

const hasThreeDCartonUploaded = (item = {}) => {
  const marks = item?.shipping_marks || {};
  return hasStoredItemFile(marks.three_d_carton);
};

const isProductDatabaseCreated = (item = {}) =>
  ["created", "checked", "approved"].includes(normalizeText(item?.pd_checked).toLowerCase());

const buildInspectedItemsReportFlags = (item = {}) => ({
  inspected: hasItemBeenInspected(item),
  cad: hasStoredItemFile(item?.cad_file),
  pis: hasStoredItemFile(item?.pis_file),
  assembly: item?.kd === true ? hasStoredItemFile(item?.assembly_file) : null,
  mounting_file: item?.mounting_file_needed === true ? hasStoredItemFile(item?.mounting_file) : null,
  packaging_ppt: hasStoredItemFile(item?.packeging_ppt),
  product_image: hasStoredItemFile(item?.image),
  finish: hasFinishUploaded(item),
  shipping_marks: hasShippingMarksUploaded(item),
  ean: hasEanUploaded(item),
  flat_carton: hasFlatCartonUploaded(item),
  three_d_carton: hasThreeDCartonUploaded(item),
  product_database: isProductDatabaseCreated(item),
});

const isInspectedItemsCriterionApplicable = (row = {}, criterion = "all") => {
  const normalizedCriterion = normalizeText(criterion).toLowerCase() || "all";
  if (normalizedCriterion === INSPECTED_ITEM_CRITERIA.ASSEMBLY) {
    return row?.requirements?.assembly === true;
  }
  if (normalizedCriterion === INSPECTED_ITEM_CRITERIA.MOUNTING_FILE) {
    return row?.requirements?.mounting_file === true;
  }
  return true;
};

const matchesInspectedItemsCriterion = (row = {}, criterion = "all", status = "all") => {
  const normalizedCriterion = normalizeText(criterion).toLowerCase() || "all";
  const normalizedStatus = normalizeText(status).toLowerCase() || "all";
  if (normalizedCriterion === "all" || normalizedStatus === "all") return true;
  if (!isInspectedItemsCriterionApplicable(row, normalizedCriterion)) return false;
  const value = Boolean(row?.flags?.[normalizedCriterion]);
  if (normalizedStatus === "yes") return value;
  if (normalizedStatus === "no") return !value;
  return true;
};

const getDateOnlyTimestamp = (value) => {
  const isoDate = toISODateString(value);
  if (!isoDate) return 0;
  const parsed = new Date(`${isoDate}T00:00:00.000Z`).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeInspectedItemsDateRange = ({ fromDate = "", toDate = "" } = {}) => {
  const hasFrom = Boolean(normalizeText(fromDate));
  const hasTo = Boolean(normalizeText(toDate));
  const fromIso = hasFrom ? toISODateString(fromDate) : "";
  const toIso = hasTo ? toISODateString(toDate) : "";

  if (hasFrom && !fromIso) {
    throw new Error("Invalid from date filter");
  }
  if (hasTo && !toIso) {
    throw new Error("Invalid to date filter");
  }

  const fromTime = fromIso ? getDateOnlyTimestamp(fromIso) : 0;
  const toTime = toIso ? getDateOnlyTimestamp(toIso) : 0;
  if (fromTime && toTime && fromTime > toTime) {
    throw new Error("From date cannot be after to date");
  }

  return {
    from_date: fromIso,
    to_date: toIso,
    from_time: fromTime,
    to_time: toTime,
  };
};

const matchesInspectedItemsDateRange = (row = {}, dateRange = {}) => {
  const hasDateFilter = Boolean(dateRange?.from_time || dateRange?.to_time);
  if (!hasDateFilter) return true;

  const inspectedTime = getDateOnlyTimestamp(row?.last_inspected_date);
  if (!inspectedTime) return false;
  if (dateRange.from_time && inspectedTime < dateRange.from_time) return false;
  if (dateRange.to_time && inspectedTime > dateRange.to_time) return false;
  return true;
};

const sortInspectedItemsRows = (left = {}, right = {}) => {
  const dateDelta =
    getDateOnlyTimestamp(right?.last_inspected_date) -
    getDateOnlyTimestamp(left?.last_inspected_date);
  if (dateDelta !== 0) return dateDelta;
  return normalizeText(left?.code).localeCompare(
    normalizeText(right?.code),
    undefined,
    { sensitivity: "base" },
  );
};

const buildInspectedItemsReportRow = (item = {}) => {
  const flags = buildInspectedItemsReportFlags(item);
  return {
    id: String(item?._id || ""),
    code: normalizeText(item?.code),
    name: normalizeText(item?.name),
    description: normalizeText(item?.description),
    brand: normalizeText(item?.brand || item?.brand_name || (Array.isArray(item?.brands) ? item.brands[0] : "")),
    brands: Array.isArray(item?.brands) ? item.brands.filter(Boolean) : [],
    vendors: Array.isArray(item?.vendors) ? item.vendors.filter(Boolean) : [],
    last_inspected_date: normalizeText(item?.qc?.last_inspected_date),
    flags,
    requirements: {
      assembly: item?.kd === true,
      mounting_file: item?.mounting_file_needed === true,
    },
    files: {
      image: item?.image || {},
      cad_file: item?.cad_file || {},
      pis_file: item?.pis_file || {},
      assembly_file: item?.assembly_file || {},
      mounting_file: item?.mounting_file || {},
      packeging_ppt: item?.packeging_ppt || {},
      finish_count: Array.isArray(item?.finish) ? item.finish.length : 0,
      shipping_marks: item?.shipping_marks || {},
    },
    updated_at: item?.updatedAt || null,
  };
};

const buildInspectedItemsSummary = (rows = []) => {
  const total = rows.length;
  const createSummaryEntry = (key, label, totalRows = rows) => {
    let filteredRowsForPill = totalRows;
    if (key === "pis") {
      filteredRowsForPill = totalRows.filter(
        (row) => normalizeText(row?.brand).toLowerCase() !== "giga"
      );
    }
    return {
      key,
      label,
      count: filteredRowsForPill.filter((row) => Boolean(row?.flags?.[key])).length,
      total: filteredRowsForPill.length,
    };
  };
  const assemblyRows = rows.filter((row) => row?.requirements?.assembly === true);
  const mountingFileRows = rows.filter((row) => row?.requirements?.mounting_file === true);

  return {
    total_items: total,
    inspected: createSummaryEntry(INSPECTED_ITEM_CRITERIA.INSPECTED, "Inspected Items"),
    cad: createSummaryEntry(INSPECTED_ITEM_CRITERIA.CAD, "CAD Uploaded"),
    pis: createSummaryEntry(INSPECTED_ITEM_CRITERIA.PIS, "PIS Uploaded"),
    assembly: createSummaryEntry(INSPECTED_ITEM_CRITERIA.ASSEMBLY, "Assembly Uploaded", assemblyRows),
    mounting_file: createSummaryEntry(INSPECTED_ITEM_CRITERIA.MOUNTING_FILE, "Mounting File Uploaded", mountingFileRows),
    packaging_ppt: createSummaryEntry(INSPECTED_ITEM_CRITERIA.PACKAGING_PPT, "Packaging PPT Uploaded"),
    product_image: createSummaryEntry(INSPECTED_ITEM_CRITERIA.PRODUCT_IMAGE, "Product Image Uploaded"),
    finish: createSummaryEntry(INSPECTED_ITEM_CRITERIA.FINISH, "Finish Uploaded"),
    shipping_marks: createSummaryEntry(INSPECTED_ITEM_CRITERIA.SHIPPING_MARKS, "Shipping Marks Uploaded"),
    ean: createSummaryEntry(INSPECTED_ITEM_CRITERIA.EAN, "EAN Uploaded"),
    flat_carton: createSummaryEntry(INSPECTED_ITEM_CRITERIA.FLAT_CARTON, "Flat Carton Uploaded"),
    three_d_carton: createSummaryEntry(INSPECTED_ITEM_CRITERIA.THREE_D_CARTON, "3D Carton Uploaded"),
    product_database: createSummaryEntry(INSPECTED_ITEM_CRITERIA.PRODUCT_DATABASE, "Product Database Created"),
  };
};

const getInspectedItemsReportDataset = async ({
  search,
  brand,
  vendor,
  criterion = "all",
  status = "all",
  fromDate = "",
  toDate = "",
  user,
} = {}) => {
  const dateRange = normalizeInspectedItemsDateRange({ fromDate, toDate });
  const accessOptions = {
    brandFields: ["brand", "brand_name", "brands"],
    vendorFields: ["vendors"],
  };
  const itemAccessMatch = applyDataAccessMatch({}, user, accessOptions);
  const orderAccessMatch = applyDataAccessMatch(
    { status: { $ne: "Cancelled" } },
    user,
  );

  const [items, orders] = await Promise.all([
    Item.find(itemAccessMatch)
      .select(INSPECTED_ITEMS_REPORT_SELECT)
      .sort({ "qc.last_inspected_date": -1, code: 1 })
      .lean(),
    Order.find(orderAccessMatch)
      .select(INSPECTED_ITEMS_ORDER_SELECT)
      .populate({
        path: "qc_record",
        select: "last_inspected_date quantities",
      })
      .sort({ updatedAt: -1 })
      .lean(),
  ]);

  const allRows = mergeInspectedItemsSources(items, orders)
    .map(buildInspectedItemsReportRow);
  const baseRows = allRows.filter((row) =>
    matchesInspectedItemsReportFilters(row, { search, brand, vendor }),
  );
  const dateFilteredRows = baseRows
    .filter((row) => matchesInspectedItemsDateRange(row, dateRange))
    .sort(sortInspectedItemsRows);
  const normalizedCriterion = normalizeText(criterion).toLowerCase() || "all";
  const normalizedStatus = normalizeText(status).toLowerCase() || "all";
  const filteredRows = dateFilteredRows.filter((row) =>
    matchesInspectedItemsCriterion(row, normalizedCriterion, normalizedStatus),
  );

  return {
    rows: filteredRows,
    summary: buildInspectedItemsSummary(dateFilteredRows),
    filters: {
      search: normalizeText(search),
      brand: normalizeText(brand) || "all",
      vendor: normalizeText(vendor) || "all",
      criterion: normalizedCriterion,
      status: normalizedStatus,
      from_date: dateRange.from_date,
      to_date: dateRange.to_date,
      brand_options: normalizeDistinctTextValues(
        allRows
          .filter((row) =>
            matchesInspectedItemsReportFilters(row, { search, vendor }),
          )
          .flatMap((row) => [row?.brand, ...(row?.brands || [])]),
      ).sort((left, right) =>
        left.localeCompare(right, undefined, { sensitivity: "base" }),
      ),
      vendor_options: normalizeDistinctTextValues(
        allRows
          .filter((row) =>
            matchesInspectedItemsReportFilters(row, { search, brand }),
          )
          .flatMap((row) => row?.vendors || []),
      ).sort((left, right) =>
        left.localeCompare(right, undefined, { sensitivity: "base" }),
      ),
    },
  };
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
  "master_item_sizes",
  "master_box_sizes",
  "master_box_mode",
  "pis_item_sizes",
  "pis_box_sizes",
  "pis_box_mode",
  "qc_mismatch_comments",
].join(" ");
const QC_REPORT_MISMATCH_RECENT_INSPECTION_LIMIT = 3;
const QC_REPORT_MISMATCH_STATUS = "Inspection Done";

const getDateTimeValue = (value) => {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const getNullableDateTimeValue = (value) => {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const compareDateDescNullLast = (leftValue, rightValue) => {
  const leftTime = getNullableDateTimeValue(leftValue);
  const rightTime = getNullableDateTimeValue(rightValue);

  if (leftTime !== null && rightTime !== null) {
    if (rightTime !== leftTime) return rightTime - leftTime;
    return 0;
  }
  if (leftTime !== null) return -1;
  if (rightTime !== null) return 1;
  return 0;
};

const compareInspectionRecencyDesc = (left = {}, right = {}) => {
  const recencyDelta = compareDateDescNullLast(
    left?.inspection_date_recency_value,
    right?.inspection_date_recency_value,
  );
  if (recencyDelta !== 0) return recencyDelta;
  const inspectionDateDelta = compareDateDescNullLast(
    left?.inspection_date_value,
    right?.inspection_date_value,
  );
  if (inspectionDateDelta !== 0) return inspectionDateDelta;
  const createdAtDelta = compareDateDescNullLast(left?.createdAt, right?.createdAt);
  if (createdAtDelta !== 0) return createdAtDelta;
  return normalizeText(right?._id).localeCompare(normalizeText(left?._id));
};

const getLatestOrderDateValue = (inspections = []) => {
  let latestEntry = null;
  (Array.isArray(inspections) ? inspections : []).forEach((inspection) => {
    if (
      compareDateDescNullLast(
        inspection?.order_date_value,
        latestEntry?.order_date_value,
      ) < 0
    ) {
      latestEntry = inspection;
    }
  });
  return latestEntry?.order_date_value || null;
};

const sortInspectionsByOrderAndInspectionDate = (inspections = []) => {
  if (!Array.isArray(inspections) || inspections.length === 0) {
    return [];
  }

  // 1. Group by order_id (PO)
  const poGroups = new Map();
  inspections.forEach((insp) => {
    const po = normalizeText(insp?.order_id) || "N/A";
    const group = poGroups.get(po) || [];
    group.push(insp);
    poGroups.set(po, group);
  });

  // 2. Sort inspections within each PO group by inspection_date (recency) latest first
  poGroups.forEach((group) => {
    group.sort(compareInspectionRecencyDesc);
  });

  // 3. For each PO group, find its latest order_date.
  const poOrderDates = new Map();
  poGroups.forEach((group, po) => {
    poOrderDates.set(po, getLatestOrderDateValue(group));
  });

  // 4. Sort PO keys based on order_date latest first
  const sortedPos = Array.from(poGroups.keys()).sort((poA, poB) => {
    const dateCompare = compareDateDescNullLast(poOrderDates.get(poA), poOrderDates.get(poB));
    if (dateCompare !== 0) return dateCompare;
    return poA.localeCompare(poB);
  });

  // 5. Flatten the sorted PO groups
  const flattened = [];
  sortedPos.forEach((po) => {
    const group = poGroups.get(po) || [];
    flattened.push(...group);
  });

  return flattened;
};

const selectLatestInspectionPerLatestPo = (
  inspections = [],
  limit = QC_REPORT_MISMATCH_RECENT_INSPECTION_LIMIT,
) => {
  if (!Array.isArray(inspections) || inspections.length === 0) return [];

  const poGroups = new Map();
  inspections.forEach((inspection) => {
    const normalizedPo = normalizeText(inspection?.order_id);
    if (!normalizedPo || normalizedPo.toLowerCase() === "n/a") return;
    const poKey = normalizedPo;
    const group = poGroups.get(poKey) || {
      order_id: normalizedPo,
      inspections: [],
    };
    group.inspections.push(inspection);
    poGroups.set(poKey, group);
  });

  const requiredPoCount = Math.max(1, limit);
  if (poGroups.size < requiredPoCount) return [];

  return [...poGroups.values()]
    .map((group) => {
      const sortedInspections = [...group.inspections].sort(compareInspectionRecencyDesc);
      return {
        ...group,
        order_date_value: getLatestOrderDateValue(group.inspections),
        latest_inspection: sortedInspections[0] || null,
      };
    })
    .sort((left, right) => {
      const dateCompare = compareDateDescNullLast(left.order_date_value, right.order_date_value);
      if (dateCompare !== 0) return dateCompare;
      return normalizeText(left.order_id).localeCompare(normalizeText(right.order_id));
    })
    .slice(0, requiredPoCount)
    .map((group) => group.latest_inspection)
    .filter(Boolean);
};

const limitRecentInspectionsByItem = (
  inspections = [],
  limit = QC_REPORT_MISMATCH_RECENT_INSPECTION_LIMIT,
) => {
  const groupedByItem = new Map();

  (Array.isArray(inspections) ? inspections : []).forEach((inspection, index) => {
    const itemKey = normalizeLookupKey(inspection?.item_code);
    const fallbackKey = normalizeText(inspection?._id) || String(index);
    const groupKey = itemKey || `inspection:${fallbackKey}`;
    const group = groupedByItem.get(groupKey) || [];
    group.push(inspection);
    groupedByItem.set(groupKey, group);
  });

  return [...groupedByItem.values()]
    .flatMap((group) =>
      selectLatestInspectionPerLatestPo(group, Math.max(1, limit))
    );
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
    },
    in: {
      $max: [
        0,
        buildFirstPositiveExpression([
          "$$inspectedBoxSizesCbm",
          "$$inspectedItemSizesCbm",
        ]),
      ],
    },
  },
});

const buildInitialInspectionMatch = ({
  reportRange,
  inspectorObjectId = null,
} = {}) => {
  const baseMatch = {
    status: QC_REPORT_MISMATCH_STATUS,
    passed: { $gt: 0 },
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
      inspection_date_recency_value: inspectionDateToDateExpression,
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
            order: 1,
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
    $lookup: {
      from: "orders",
      localField: "qc_doc.order",
      foreignField: "_id",
      as: "order_doc",
    },
  },
  {
    $addFields: {
      order_doc: { $arrayElemAt: ["$order_doc", 0] },
    },
  },
  {
    $addFields: {
      vendor_value: buildTrimmedStringExpression("$qc_doc.order_meta.vendor"),
      brand_value: buildTrimmedStringExpression("$qc_doc.order_meta.brand"),
      order_id_value: buildTrimmedStringExpression("$qc_doc.order_meta.order_id"),
      item_code_value: buildTrimmedStringExpression("$qc_doc.item.item_code"),
      order_date_value: "$order_doc.order_date",
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
  user = null,
} = {}) => {
  const pipeline = [
    ...buildDateNormalizationStages({ reportRange, inspectorObjectId }),
    ...buildQcLookupStages(),
    ...buildUserLookupStages(),
  ];
  const accessMatch = applyDataAccessMatch({}, user, {
    brandFields: ["brand_value"],
    vendorFields: ["vendor_value"],
  });
  if (Object.keys(accessMatch).length > 0) {
    pipeline.push({ $match: accessMatch });
  }

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
        inspection_date_recency_value: 1,
        order_date_value: 1,
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
        inspection_date_recency_value: -1,
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
        $match: applyDataAccessMatch({}, req.user, {
          brandFields: ["brand_value"],
          vendorFields: ["vendor_value"],
        }),
      },
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
        inspected_quantity: Number(totals.inspected_quantity.toFixed(2)),
        inspected_cbm: Number(totals.inspected_cbm.toFixed(2)),
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
        $match: applyDataAccessMatch({}, req.user, {
          brandFields: ["brand_value"],
          vendorFields: ["vendor_value"],
        }),
      },
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
          overallSummary.total_passed_quantity.toFixed(2),
        ),
        total_cbm: Number(overallSummary.total_cbm.toFixed(2)),
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

exports.getInspectedItemsReport = async (req, res) => {
  try {
    const search = req.query.search;
    const brand = req.query.brand;
    const vendor = req.query.vendor;
    const criterion = normalizeText(req.query.criterion).toLowerCase() || "all";
    const status = normalizeText(req.query.status).toLowerCase() || "all";
    const fromDate = req.query.from_date ?? req.query.fromDate ?? req.query.from;
    const toDate = req.query.to_date ?? req.query.toDate ?? req.query.to;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(
      INSPECTED_ITEMS_REPORT_LIMIT,
      parsePositiveInt(req.query.limit, 20),
    );
    const skip = (page - 1) * limit;

    const dataset = await getInspectedItemsReportDataset({
      search,
      brand,
      vendor,
      criterion,
      status,
      fromDate,
      toDate,
      user: req.user,
    });

    return res.status(200).json({
      success: true,
      rows: dataset.rows.slice(skip, skip + limit),
      summary: dataset.summary,
      filters: dataset.filters,
      pagination: {
        page,
        limit,
        total: dataset.rows.length,
        totalPages: Math.max(1, Math.ceil(dataset.rows.length / limit)),
      },
    });
  } catch (error) {
    console.error("Get Inspected Items Report Error:", error);
    if (/date/i.test(error?.message || "")) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch inspected items report.",
    });
  }
};

exports.exportInspectedItemsReport = async (req, res) => {
  try {
    const dataset = await getInspectedItemsReportDataset({
      search: req.query.search,
      brand: req.query.brand,
      vendor: req.query.vendor,
      criterion: normalizeText(req.query.criterion).toLowerCase() || "all",
      status: normalizeText(req.query.status).toLowerCase() || "all",
      fromDate: req.query.from_date ?? req.query.fromDate ?? req.query.from,
      toDate: req.query.to_date ?? req.query.toDate ?? req.query.to,
      user: req.user,
    });

    const columns = [
      { header: "Item Code", value: (row) => row.code || "N/A" },
      { header: "Description", value: (row) => row.description || row.name || "N/A" },
      { header: "Brand", value: (row) => row.brand || (row.brands || []).join(", ") || "N/A" },
      { header: "Vendors", value: (row) => (row.vendors || []).join(", ") || "N/A" },
      { header: "Inspected", value: (row) => (row.flags?.inspected ? "Yes" : "No") },
      { header: "CAD", value: (row) => (row.flags?.cad ? "Yes" : "No") },
      { header: "PIS", value: (row) => normalizeText(row.brand).toLowerCase() === "giga" ? "N/A" : (row.flags?.pis ? "Yes" : "No") },
      { header: "Assembly", value: (row) => row.requirements?.assembly ? (row.flags?.assembly ? "Yes" : "No") : "N/A" },
      { header: "Mounting File", value: (row) => row.requirements?.mounting_file ? (row.flags?.mounting_file ? "Yes" : "No") : "N/A" },
      { header: "Packaging PPT", value: (row) => (row.flags?.packaging_ppt ? "Yes" : "No") },
      { header: "Product Image", value: (row) => (row.flags?.product_image ? "Yes" : "No") },
      { header: "Finish", value: (row) => (row.flags?.finish ? "Yes" : "No") },
      { header: "Shipping Marks", value: (row) => (row.flags?.shipping_marks ? "Yes" : "No") },
      { header: "EAN", value: (row) => (row.flags?.ean ? "Yes" : "No") },
      { header: "Flat Carton", value: (row) => (row.flags?.flat_carton ? "Yes" : "No") },
      { header: "3D Carton", value: (row) => (row.flags?.three_d_carton ? "Yes" : "No") },
      { header: "Product Database", value: (row) => (row.flags?.product_database ? "Yes" : "No") },
      {
        header: "Finish Count",
        value: (row) => Number(row.files?.finish_count || 0),
      },
      {
        header: "Last Inspected",
        value: (row) => toISODateString(row.last_inspected_date) || "N/A",
      },
    ];
    const headerRow = columns.map((column) => column.header);
    const dataRows = dataset.rows.map((row) =>
      columns.map((column) => column.value(row)),
    );
    const worksheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    worksheet["!cols"] = columns.map((column, columnIndex) => {
      const maxDataLength = Math.max(
        column.header.length,
        ...dataRows.map((row) => String(row[columnIndex] ?? "").length),
      );
      return { wch: Math.min(34, Math.max(12, maxDataLength + 2)) };
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inspected Items");
    const fileBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xls" });
    const fileDate = new Date().toISOString().slice(0, 10);

    res.setHeader("Content-Type", "application/vnd.ms-excel");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="inspected-items-report-${fileDate}.xls"`,
    );
    return res.status(200).send(fileBuffer);
  } catch (error) {
    console.error("Export Inspected Items Report Error:", error);
    if (/date/i.test(error?.message || "")) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to export inspected items report.",
    });
  }
};

const buildCommonErrorsReportDataset = async ({
  user,
  search = "",
  brand = "",
  vendor = "",
  errorType = "",
  fromDate = "",
  toDate = "",
} = {}) => {
  const normalizedBrand = normalizeOptionalFilter(brand);
  const normalizedVendor = normalizeOptionalFilter(vendor);
  const normalizedSearch = normalizeOptionalFilter(search).toLowerCase();
  const normalizedErrorType = normalizeOptionalFilter(errorType).toLowerCase();
  const fromIso = toISODateString(fromDate);
  const toIso = toISODateString(toDate);
  const qcMatch = applyDataAccessMatch({}, user, {
    brandFields: ["order_meta.brand"],
    vendorFields: ["order_meta.vendor"],
  });

  if (normalizedBrand) qcMatch["order_meta.brand"] = normalizedBrand;
  if (normalizedVendor) qcMatch["order_meta.vendor"] = normalizedVendor;

  const qcRows = await QC.find(qcMatch)
    .select("_id order order_meta item")
    .populate("order", "order_id brand vendor item")
    .lean();
  const qcContextById = new Map(
    qcRows.map((qc) => [
      String(qc?._id || ""),
      {
        order_id: normalizeText(qc?.order?.order_id || qc?.order_meta?.order_id),
        brand: normalizeText(qc?.order?.brand || qc?.order_meta?.brand),
        vendor: normalizeText(qc?.order?.vendor || qc?.order_meta?.vendor),
        item_code: normalizeText(qc?.item?.item_code || qc?.order?.item?.item_code),
        item_description: normalizeText(
          qc?.item?.description || qc?.order?.item?.description,
        ),
      },
    ]),
  );
  const qcIds = qcRows.map((qc) => qc?._id).filter(Boolean);

  if (qcIds.length === 0) {
    return {
      rows: [],
      filters: { brand_options: [], vendor_options: [] },
      summary: { inspection_count: 0, error_count: 0, weight_errors: 0, height_errors: 0 },
    };
  }

  const inspections = await Inspection.find({ qc: { $in: qcIds } })
    .select(
      "qc inspector inspection_date requested_date status inspected_item_sizes inspected_box_sizes inspected_box_mode createdAt",
    )
    .populate("inspector", "name email")
    .sort({ inspection_date: -1, createdAt: -1 })
    .lean();

  const allRows = [];
  for (const inspection of inspections) {
    const context = qcContextById.get(String(inspection?.qc || "")) || {};
    const inspectionDate = toISODateString(inspection?.inspection_date);
    if (fromIso && (!inspectionDate || inspectionDate < fromIso)) continue;
    if (toIso && (!inspectionDate || inspectionDate > toIso)) continue;

    const evaluation = evaluateCommonInspectionErrors(inspection);
    if (!evaluation.has_error) continue;

    const inspectorName = normalizeText(
      inspection?.inspector?.name || inspection?.inspector?.email,
    );
    const searchText = [
      context.order_id,
      context.item_code,
      context.item_description,
      context.brand,
      context.vendor,
      inspectorName,
    ].join(" ").toLowerCase();
    if (normalizedSearch && !searchText.includes(normalizedSearch)) continue;

    const errors = normalizedErrorType
      ? evaluation.errors.filter((error) => error.type === normalizedErrorType)
      : evaluation.errors;
    if (errors.length === 0) continue;

    allRows.push({
      id: String(inspection?._id || ""),
      qc_id: String(inspection?.qc || ""),
      order_id: context.order_id,
      item_code: context.item_code,
      item_description: context.item_description,
      brand: context.brand,
      vendor: context.vendor,
      inspector_name: inspectorName || "N/A",
      inspection_date: inspectionDate,
      status: normalizeText(inspection?.status),
      error_types: errors.map((error) => error.type),
      errors,
      item_sizes: evaluation.item_sizes,
      box_sizes: evaluation.box_sizes,
    });
  }

  const brandOptions = [...new Set(
    [...qcContextById.values()].map((entry) => entry.brand).filter(Boolean),
  )].sort((a, b) => a.localeCompare(b));
  const vendorOptions = [...new Set(
    [...qcContextById.values()].map((entry) => entry.vendor).filter(Boolean),
  )].sort((a, b) => a.localeCompare(b));

  return {
    rows: allRows,
    filters: {
      brand_options: brandOptions,
      vendor_options: vendorOptions,
    },
    summary: {
      inspection_count: allRows.length,
      error_count: allRows.reduce((sum, row) => sum + row.errors.length, 0),
      weight_errors: allRows.reduce(
        (sum, row) => sum + row.errors.filter((error) => error.type === "weight").length,
        0,
      ),
      height_errors: allRows.reduce(
        (sum, row) => sum + row.errors.filter((error) => error.type === "height").length,
        0,
      ),
    },
  };
};

exports.getCommonErrorsReport = async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(5000, parsePositiveInt(req.query.limit, 20));
    const dataset = await buildCommonErrorsReportDataset({
      user: req.user,
      search: req.query.search,
      brand: req.query.brand,
      vendor: req.query.vendor,
      errorType: req.query.error_type,
      fromDate: req.query.from_date,
      toDate: req.query.to_date,
    });
    const total = dataset.rows.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);

    return res.status(200).json({
      success: true,
      rows: dataset.rows.slice((safePage - 1) * limit, safePage * limit),
      summary: dataset.summary,
      filters: {
        ...dataset.filters,
        search: normalizeOptionalFilter(req.query.search),
        brand: normalizeOptionalFilter(req.query.brand),
        vendor: normalizeOptionalFilter(req.query.vendor),
        error_type: normalizeOptionalFilter(req.query.error_type),
        from_date: toISODateString(req.query.from_date),
        to_date: toISODateString(req.query.to_date),
      },
      pagination: { page: safePage, limit, total, totalPages },
    });
  } catch (error) {
    console.error("Common Errors Report Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch Common Errors report",
    });
  }
};

const formatCommonErrorRemark = (value = "") => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "base2") return "Base 2";
  if (normalized === "pedestal") return "Pedestal";
  if (normalized === "stretcher") return "Stretcher";
  return normalized
    ? normalized.replace(/([a-z]+)(\d+)/i, (_, word, number) =>
        `${word.charAt(0).toUpperCase()}${word.slice(1)} ${number}`)
    : "entry";
};

const formatCommonErrorSizeEntries = (entries = [], weightKey = "") =>
  (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const remark = formatCommonErrorRemark(entry?.remark);
      const size = `${Number(entry?.L || 0)} x ${Number(entry?.B || 0)} x ${Number(entry?.H || 0)}`;
      const weight = Number(entry?.[weightKey] || 0);
      return `${remark}: ${size}${weight > 0 ? ` | ${weightKey}: ${weight}` : ""}`;
    })
    .join("; ");

exports.exportCommonErrorsReport = async (req, res) => {
  try {
    const dataset = await buildCommonErrorsReportDataset({
      user: req.user,
      search: req.query.search,
      brand: req.query.brand,
      vendor: req.query.vendor,
      errorType: req.query.error_type,
      fromDate: req.query.from_date,
      toDate: req.query.to_date,
    });
    const rows = dataset.rows.flatMap((row) =>
      row.errors.map((error) => ({
        PO: row.order_id,
        "Item Code": row.item_code,
        Description: row.item_description,
        Brand: row.brand,
        Vendor: row.vendor,
        Inspector: row.inspector_name,
        "Inspection Date": row.inspection_date,
        "Error Type": error.label,
        Formula: error.formula,
        Calculated: error.actual,
        Recorded: error.expected,
        Difference: error.difference,
        "Item Sizes": formatCommonErrorSizeEntries(row.item_sizes, "net_weight"),
        "Box Sizes": formatCommonErrorSizeEntries(row.box_sizes, "gross_weight"),
      })),
    );
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!cols"] = [
      14, 14, 34, 18, 22, 22, 16, 38, 24, 14, 14, 14, 70, 70,
    ].map((wch) => ({ wch }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Common Errors");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xls" });
    const fileName = `common-errors-${new Date().toISOString().slice(0, 10)}.xls`;

    res.setHeader("Content-Type", "application/vnd.ms-excel");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("Export Common Errors Report Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to export Common Errors report",
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
        user: req.user,
      }),
    ).allowDiskUse(true);
    const inspectionsForComparison = limitRecentInspectionsByItem(inspections);

    const uniqueItemCodes = [
      ...new Set(
        inspectionsForComparison
          .map((entry) => normalizeText(entry?.item_code || ""))
          .filter(Boolean),
      ),
    ];

    const itemDocs = uniqueItemCodes.length > 0
      ? await Item.find(
          applyDataAccessMatch(
            {
              $or: uniqueItemCodes.map((code) => ({
                code: {
                  $regex: `^${escapeRegex(code)}$`,
                  $options: "i",
                },
              })),
            },
            req.user,
            {
              brandFields: ["brand", "brand_name", "brands"],
              vendorFields: ["vendors"],
            },
          ),
        )
          .select(QC_REPORT_MISMATCH_ITEM_SELECT)
          .lean()
      : [];

    const itemDocByCode = new Map(
      (Array.isArray(itemDocs) ? itemDocs : []).map((itemDoc) => [
        normalizeLookupKey(itemDoc?.code),
        itemDoc,
      ]),
    );

    const inspectionRows = inspectionsForComparison.map((inspection) => {
      const currentItemDoc =
        itemDocByCode.get(normalizeLookupKey(inspection?.item_code)) || {};
      const mismatch = compareInspectionSizeSnapshot(inspection, currentItemDoc);
      if (!mismatch.has_comparable_data) {
        return null;
      }

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
        inspection_date_recency_value: inspection?.inspection_date_recency_value || null,
        order_date_value: inspection?.order_date_value || null,
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
    }).filter(Boolean);

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
      const normalizedItemKey = normalizeLookupKey(row?.item_code);
      const itemKey = normalizedItemKey && normalizedItemKey !== "n/a"
        ? normalizedItemKey
        : "";
      const fallbackGroupKey =
        normalizeText(row?.inspection_id) ||
        normalizeText(row?.qc_id) ||
        normalizeLookupKey(row?.order_id);
      const groupKey = itemKey || `inspection:${fallbackGroupKey}`;
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
          id: itemKey
            ? `item:${itemKey}`
            : normalizeText(row?.inspection_id) || groupKey,
          qc_id: normalizeText(row?.qc_id),
          order_id: row?.order_id || "N/A",
          order_ids: [],
          latest_order_id: row?.order_id || "",
          brand: row?.brand || "N/A",
          vendor: row?.vendor || "N/A",
          item_code: row?.item_code || "N/A",
          item_description: row?.item_description || "N/A",
          inspector_names: [],
          requested_date: row?.requested_date || "",
          inspection_date: row?.inspection_date || "",
          inspection_date_value: row?.inspection_date_value || null,
          inspection_date_recency_value: row?.inspection_date_recency_value || null,
          status: row?.status || "",
          checked: 0,
          passed: 0,
          pending_after: row?.pending_after ?? 0,
          inspection_count: 0,
          current_qc_inspected_item_sizes: currentSnapshot.inspected_item_sizes,
          current_qc_inspected_box_sizes: currentSnapshot.inspected_box_sizes,
          current_qc_inspected_box_mode: currentSnapshot.inspected_box_mode,
          qc_mismatch_comments: currentItemDoc.qc_mismatch_comments || [],
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

      const normalizedOrderId = normalizeText(row?.order_id);
      if (
        normalizedOrderId &&
        normalizedOrderId !== "N/A" &&
        !group.order_ids.includes(normalizedOrderId)
      ) {
        group.order_ids.push(normalizedOrderId);
      }

      if (
        row?.inspection_date_recency_value &&
        (!group.inspection_date_recency_value ||
          new Date(row.inspection_date_recency_value).getTime() >
            new Date(group.inspection_date_recency_value).getTime())
      ) {
        group.inspection_date_value = row.inspection_date_value;
        group.inspection_date_recency_value = row.inspection_date_recency_value;
        group.inspection_date = row?.inspection_date || group.inspection_date;
        group.requested_date = row?.requested_date || group.requested_date;
        group.status = row?.status || group.status;
        group.latest_order_id = normalizedOrderId || group.latest_order_id;
        group.order_id = normalizedOrderId || group.order_id;
      }

      if (row?.inspector_name && !group.inspector_names.includes(row.inspector_name)) {
        group.inspector_names.push(row.inspector_name);
      }

      const inspectionRecord = {
        inspection_id: row?.inspection_id || row?.id,
        qc_id: row?.qc_id || "",
        order_id: row?.order_id || "N/A",
        brand: row?.brand || "N/A",
        vendor: row?.vendor || "N/A",
        requested_date: row?.requested_date || "",
        inspection_date: row?.inspection_date || "",
        inspection_date_value: row?.inspection_date_value || null,
        inspection_date_recency_value: row?.inspection_date_recency_value || null,
        order_date_value: row?.order_date_value || null,
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
        const sortedInspectionRecords = sortInspectionsByOrderAndInspectionDate(group.inspection_records)
          .map((inspectionRecord, index) => ({
            ...inspectionRecord,
            sheet_label: `Inspection ${index + 1}`,
          }));
        const orderIds = Array.isArray(group.order_ids)
          ? group.order_ids.filter(Boolean)
          : [];
        const orderIdsDisplay = orderIds.length > 3
          ? `${orderIds.slice(0, 3).join(", ")} +${orderIds.length - 3}`
          : orderIds.join(", ");

        return {
          ...group,
          order_ids: orderIds,
          po_count: orderIds.length,
          order_id:
            group.latest_order_id ||
            orderIdsDisplay ||
            group.order_id ||
            "N/A",
          order_ids_display:
            orderIdsDisplay ||
            group.latest_order_id ||
            group.order_id ||
            "N/A",
          latest_order_id: undefined,
          inspector_name: group.inspector_names.join(", ") || "Unassigned",
          inspection_records: sortedInspectionRecords,
        };
      })
      .sort((left, right) => {
        const leftTime = left?.inspection_date_recency_value
          ? new Date(left.inspection_date_recency_value).getTime()
          : 0;
        const rightTime = right?.inspection_date_recency_value
          ? new Date(right.inspection_date_recency_value).getTime()
          : 0;
        const timeDelta = rightTime - leftTime;
        if (timeDelta !== 0) return timeDelta;
        return getDateTimeValue(right?.inspection_date_value) -
          getDateTimeValue(left?.inspection_date_value);
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
        comparison_inspection_limit: QC_REPORT_MISMATCH_RECENT_INSPECTION_LIMIT,
        comparison_recency_field: "order_date_then_inspection_date",
        comparison_strategy: "latest_po_latest_inspection",
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

const getActorDisplayName = (user = {}) => {
  const name = String(user?.name || "").trim();
  if (name) return name;
  const username = String(user?.username || "").trim();
  if (username) return username;
  const email = String(user?.email || "").trim();
  if (email) return email.split("@")[0];
  return "Unknown";
};

exports.getQcMismatchComments = async (req, res) => {
  try {
    const itemCodeInput = String(req.params.code || "").trim();
    if (!itemCodeInput) {
      return res.status(400).json({ message: "Item code is required." });
    }

    const item = await Item.findOne(
      applyDataAccessMatch({ code: new RegExp(`^\\s*${escapeRegex(itemCodeInput)}\\s*$`, "i") }, req.user, {
        brandFields: ["brand", "brand_name", "brands"],
        vendorFields: ["vendors"],
      })
    ).select("code qc_mismatch_comments");

    if (!item) {
      return res.status(200).json({ comments: [] });
    }

    return res.status(200).json({
      success: true,
      comments: item.qc_mismatch_comments || [],
    });
  } catch (error) {
    console.error("Get QC Mismatch Comments Error:", error);
    return res.status(500).json({ message: "Failed to get comments" });
  }
};

exports.createQcMismatchComment = async (req, res) => {
  try {
    const itemCodeInput = String(req.params.code || "").trim();
    const commentText = String(req.body?.comment || "").trim();

    if (!itemCodeInput) {
      return res.status(400).json({ message: "Item code is required." });
    }
    if (!commentText) {
      return res.status(400).json({ message: "Comment cannot be empty." });
    }
    if (commentText.length > 1000) {
      return res.status(400).json({ message: "Comment cannot exceed 1000 characters." });
    }

    const item = await Item.findOne(
      applyDataAccessMatch({ code: new RegExp(`^\\s*${escapeRegex(itemCodeInput)}\\s*$`, "i") }, req.user, {
        brandFields: ["brand", "brand_name", "brands"],
        vendorFields: ["vendors"],
      })
    ).select("code qc_mismatch_comments");

    if (!item) {
      return res.status(404).json({ message: "Item not found or access denied." });
    }

    const userName = getActorDisplayName(req.user);
    const userRole = String(req.user?.role || "qc").trim();

    const newComment = {
      comment: commentText,
      item_code: item.code || itemCodeInput,
      created_by: req.user?._id || req.user?.id || null,
      created_by_name: userName,
      created_by_role: userRole,
      created_at: new Date(),
    };

    item.qc_mismatch_comments = item.qc_mismatch_comments || [];
    item.qc_mismatch_comments.push(newComment);
    await item.save();

    return res.status(201).json({
      success: true,
      comments: item.qc_mismatch_comments,
    });
  } catch (error) {
    console.error("Create QC Mismatch Comment Error:", error);
    return res.status(500).json({ message: "Failed to create comment" });
  }
};

const isQcMismatchCommentCreator = (comment = {}, user = {}) => {
  const actorId = String(user?._id || user?.id || "").trim();
  const creatorId = String(comment?.created_by || "").trim();
  return Boolean(actorId && creatorId && actorId === creatorId);
};

const findQcMismatchCommentTarget = async ({
  itemCodeInput = "",
  commentId = "",
  user = null,
} = {}) => {
  const normalizedItemCode = String(itemCodeInput || "").trim();
  const normalizedCommentId = String(commentId || "").trim();

  if (!normalizedItemCode) {
    return { status: 400, message: "Item code is required." };
  }
  if (!normalizedCommentId || !mongoose.Types.ObjectId.isValid(normalizedCommentId)) {
    return { status: 400, message: "Valid comment id is required." };
  }

  const itemCodeMatch = new RegExp(`^\\s*${escapeRegex(normalizedItemCode)}\\s*$`, "i");
  const item = await Item.findOne(
    applyDataAccessMatch({ code: itemCodeMatch }, user, {
      brandFields: ["brand", "brand_name", "brands"],
      vendorFields: ["vendors"],
    })
  ).select("_id code qc_mismatch_comments");

  if (!item) {
    return { status: 404, message: "Item not found." };
  }

  const comment = item.qc_mismatch_comments.id(normalizedCommentId);
  if (!comment) {
    return { status: 404, message: "Comment not found." };
  }

  return { item, comment };
};

exports.updateQcMismatchComment = async (req, res) => {
  try {
    const commentText = String(req.body?.comment || "").trim();
    if (!commentText) {
      return res.status(400).json({ message: "Comment is required." });
    }
    if (commentText.length > 1000) {
      return res.status(400).json({ message: "Comment cannot exceed 1000 characters." });
    }

    const target = await findQcMismatchCommentTarget({
      itemCodeInput: req.params.code,
      commentId: req.params.commentId,
      user: req.user,
    });

    if (!target?.item || !target?.comment) {
      return res.status(target.status || 404).json({
        message: target.message || "Comment not found.",
      });
    }

    if (!isQcMismatchCommentCreator(target.comment, req.user)) {
      return res.status(403).json({
        message: "Only the comment creator can edit this comment.",
      });
    }

    target.comment.comment = commentText;
    await target.item.save();

    return res.status(200).json({
      success: true,
      comments: target.item.qc_mismatch_comments || [],
    });
  } catch (error) {
    console.error("Update QC Mismatch Comment Error:", error);
    return res.status(500).json({ message: "Failed to update comment" });
  }
};

exports.deleteQcMismatchComment = async (req, res) => {
  try {
    const target = await findQcMismatchCommentTarget({
      itemCodeInput: req.params.code,
      commentId: req.params.commentId,
      user: req.user,
    });

    if (!target?.item || !target?.comment) {
      return res.status(target.status || 404).json({
        message: target.message || "Comment not found.",
      });
    }

    if (!isQcMismatchCommentCreator(target.comment, req.user)) {
      return res.status(403).json({
        message: "Only the comment creator can delete this comment.",
      });
    }

    target.comment.deleteOne();
    await target.item.save();

    return res.status(200).json({
      success: true,
      comments: target.item.qc_mismatch_comments || [],
    });
  } catch (error) {
    console.error("Delete QC Mismatch Comment Error:", error);
    return res.status(500).json({ message: "Failed to delete comment" });
  }
};

exports.getMonthlyShipmentsReport = async (req, res) => {
  try {
    const report = await getMonthlyShipmentsReportData({
      query: req.query,
      user: req.user,
    });

    return res.status(200).json({
      success: true,
      ...report,
    });
  } catch (error) {
    console.error("Monthly Shipments Report Error:", error);
    return res.status(error?.statusCode || 500).json({
      success: false,
      message: error?.message || "Failed to fetch monthly shipments report",
    });
  }
};

exports.getMonthlyShipmentsDrilldown = async (req, res) => {
  try {
    const drilldown = await getMonthlyShipmentsDrilldownData({
      query: req.query,
      user: req.user,
    });

    return res.status(200).json({
      success: true,
      ...drilldown,
    });
  } catch (error) {
    console.error("Monthly Shipments Drilldown Error:", error);
    return res.status(error?.statusCode || 500).json({
      success: false,
      message: error?.message || "Failed to fetch monthly shipments drill-down",
    });
  }
};

exports.__test__ = {
  buildInspectedItemsReportRow,
  buildOrderItemReportGroups,
  matchesInspectedItemsReportFilters,
  matchesInspectedItemsDateRange,
  mergeInspectedItemsSources,
  limitRecentInspectionsByItem,
  selectLatestInspectionPerLatestPo,
  sortInspectionsByOrderAndInspectionDate,
};
