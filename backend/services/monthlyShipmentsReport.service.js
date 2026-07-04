const Order = require("../models/order.model");
const {
  combineMongoMatches,
  applyDataAccessMatch,
} = require("./userDataAccess.service");
const {
  resolveShipmentRowCbm,
  toRoundedCbmValue,
} = require("./shipmentCbmAllocation.service");

const INCLUDED_STATUSES = Object.freeze(["Partial Shipped", "Shipped"]);
const TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 330;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOT_SET = "Not Set";

const MONTH_NAMES_LONG = Object.freeze([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]);

const MONTH_NAMES_SHORT = Object.freeze([
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]);

const pad2 = (value) => String(value).padStart(2, "0");

const normalizeText = (value) => String(value ?? "").trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();

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

const createError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const parseInteger = (value) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const isValidDateParts = ({ year, month, day }) => {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
};

const parseIsoDateParts = (value) => {
  const match = normalizeText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  return isValidDateParts(parts) ? parts : null;
};

const isoFromParts = ({ year, month, day }) =>
  `${year}-${pad2(month)}-${pad2(day)}`;

const getLastDayOfMonth = (year, month) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const addDaysToParts = (parts, days = 0) => {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

const getKolkataParts = (value = new Date()) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const lookup = Object.create(null);
  formatter.formatToParts(parsed).forEach((part) => {
    if (part?.type) lookup[part.type] = part.value;
  });
  const parts = {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
  };
  return isValidDateParts(parts) ? parts : null;
};

const localDatePartsToUtc = (parts) =>
  new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day) -
      IST_OFFSET_MINUTES * MS_PER_MINUTE,
  );

const isoDateToKolkataUtcRange = (isoDate) => {
  const parts = parseIsoDateParts(isoDate);
  if (!parts) return null;
  return {
    start: localDatePartsToUtc(parts),
    endExclusive: localDatePartsToUtc(addDaysToParts(parts, 1)),
  };
};

const toKolkataIsoDate = (value) => {
  if (!value) return "";
  const parts = getKolkataParts(value);
  return parts ? isoFromParts(parts) : "";
};

const formatDateLabel = (isoDate) => {
  const parts = parseIsoDateParts(isoDate);
  if (!parts) return "";
  return `${pad2(parts.day)} ${MONTH_NAMES_SHORT[parts.month - 1]} ${parts.year}`;
};

const monthKeyFromParts = ({ year, month }) => `${year}-${pad2(month)}`;

const monthKeyFromDate = (value) => {
  const parts = getKolkataParts(value);
  return parts ? monthKeyFromParts(parts) : "";
};

const monthLabelFromKey = (monthKey = "") => {
  const match = normalizeText(monthKey).match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  const month = Number(match[2]);
  return `${MONTH_NAMES_SHORT[month - 1]} ${match[1]}`;
};

const buildMonthsBetween = (fromIso, toIso) => {
  const fromParts = parseIsoDateParts(fromIso);
  const toParts = parseIsoDateParts(toIso);
  if (!fromParts || !toParts) return [];

  const months = [];
  let cursorYear = fromParts.year;
  let cursorMonth = fromParts.month;
  const endKey = monthKeyFromParts(toParts);

  while (true) {
    const key = monthKeyFromParts({ year: cursorYear, month: cursorMonth });
    months.push({
      key,
      label: `${MONTH_NAMES_SHORT[cursorMonth - 1]} ${cursorYear}`,
      year: cursorYear,
      month: cursorMonth,
      from_date: `${cursorYear}-${pad2(cursorMonth)}-01`,
      to_date: `${cursorYear}-${pad2(cursorMonth)}-${pad2(
        getLastDayOfMonth(cursorYear, cursorMonth),
      )}`,
    });

    if (key === endKey) break;
    cursorMonth += 1;
    if (cursorMonth > 12) {
      cursorMonth = 1;
      cursorYear += 1;
    }
  }

  return months;
};

const normalizePeriodMode = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (
    normalized === "month" ||
    normalized === "selected-month" ||
    normalized === "month-selection"
  ) {
    return "month";
  }
  if (
    normalized === "custom" ||
    normalized === "custom-range" ||
    normalized === "custom-date-range"
  ) {
    return "custom";
  }
  return "last-six-months";
};

const resolveReportPeriod = ({ query = {}, now = new Date() } = {}) => {
  const mode = normalizePeriodMode(
    query.period_mode ?? query.periodMode ?? query.mode,
  );
  let fromParts;
  let toParts;
  let selectedYear = null;
  let selectedMonth = null;

  if (mode === "month") {
    selectedYear = parseInteger(query.year);
    selectedMonth = parseInteger(query.month);
    if (!selectedYear || selectedYear < 1900 || selectedYear > 3000) {
      throw createError("A valid year is required for month selection.");
    }
    if (!selectedMonth || selectedMonth < 1 || selectedMonth > 12) {
      throw createError("A valid month is required for month selection.");
    }
    fromParts = { year: selectedYear, month: selectedMonth, day: 1 };
    toParts = {
      year: selectedYear,
      month: selectedMonth,
      day: getLastDayOfMonth(selectedYear, selectedMonth),
    };
  } else if (mode === "custom") {
    const fromInput = query.from_date ?? query.fromDate ?? query.from;
    const toInput = query.to_date ?? query.toDate ?? query.to;
    fromParts = parseIsoDateParts(fromInput);
    toParts = parseIsoDateParts(toInput);
    if (!fromParts || !toParts) {
      throw createError("Valid from_date and to_date are required.");
    }
    if (
      localDatePartsToUtc(fromParts).getTime() >
      localDatePartsToUtc(toParts).getTime()
    ) {
      throw createError("To date cannot be before From date.");
    }
  } else {
    const todayParts = getKolkataParts(now);
    if (!todayParts) {
      throw createError("Unable to resolve the current business date.");
    }
    const previousMonth = new Date(
      Date.UTC(todayParts.year, todayParts.month - 2, 1),
    );
    const startMonth = new Date(
      Date.UTC(
        previousMonth.getUTCFullYear(),
        previousMonth.getUTCMonth() - 5,
        1,
      ),
    );
    fromParts = {
      year: startMonth.getUTCFullYear(),
      month: startMonth.getUTCMonth() + 1,
      day: 1,
    };
    toParts = {
      year: previousMonth.getUTCFullYear(),
      month: previousMonth.getUTCMonth() + 1,
      day: getLastDayOfMonth(
        previousMonth.getUTCFullYear(),
        previousMonth.getUTCMonth() + 1,
      ),
    };
  }

  const fromDate = isoFromParts(fromParts);
  const toDate = isoFromParts(toParts);
  const toExclusiveParts = addDaysToParts(toParts, 1);

  return {
    mode,
    year: selectedYear,
    month: selectedMonth,
    from_date: fromDate,
    to_date: toDate,
    from_utc: localDatePartsToUtc(fromParts),
    to_exclusive_utc: localDatePartsToUtc(toExclusiveParts),
    timezone: TIMEZONE,
    label: `${formatDateLabel(fromDate)} - ${formatDateLabel(toDate)}`,
    months: buildMonthsBetween(fromDate, toDate),
  };
};

const normalizeCountry = (value) => normalizeText(value) || NOT_SET;

const normalizeContributionRows = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const container = normalizeText(row?.container);
      const brand = normalizeText(row?.brand) || "N/A";
      const vendor = normalizeText(row?.vendor) || "N/A";
      const country = normalizeCountry(row?.country);
      const stuffingDate = row?.stuffing_date || null;
      const monthKey = row?.month_key || monthKeyFromDate(stuffingDate);
      const allocatedCbm = Number(row?.allocated_cbm || 0);

      return {
        order_document_id: normalizeText(row?.order_document_id),
        shipment_id: normalizeText(row?.shipment_id),
        order_id: normalizeText(row?.order_id) || "N/A",
        item_code: normalizeText(row?.item_code),
        item_description: normalizeText(row?.item_description),
        status: normalizeText(row?.status),
        container,
        container_key: normalizeKey(container),
        stuffing_date: stuffingDate,
        stuffing_date_iso: row?.stuffing_date_iso || toKolkataIsoDate(stuffingDate),
        month_key: monthKey,
        month_label: monthLabelFromKey(monthKey),
        brand,
        brand_key: normalizeKey(brand),
        vendor,
        vendor_key: normalizeKey(vendor),
        country,
        country_key: normalizeKey(country),
        order_quantity: Number(row?.order_quantity || 0),
        shipment_quantity: Number(row?.shipment_quantity || 0),
        allocated_cbm: Number.isFinite(allocatedCbm) ? allocatedCbm : 0,
        cbm_source: normalizeText(row?.cbm_source),
      };
    })
    .filter((row) => row.container_key && row.stuffing_date && row.month_key);

const getReportFiltersFromQuery = (query = {}) => ({
  country: normalizeOptionalFilter(query.country),
  brand: normalizeOptionalFilter(query.brand),
  vendor: normalizeOptionalFilter(query.vendor),
  selected_vendor: normalizeOptionalFilter(
    query.selected_vendor ?? query.selectedVendor,
  ),
});

const matchesReportFilters = (row, filters = {}) => {
  if (filters.country) {
    const countryKey = normalizeKey(filters.country);
    if (countryKey === normalizeKey(NOT_SET)) {
      if (row.country_key !== normalizeKey(NOT_SET)) return false;
    } else if (row.country_key !== countryKey) {
      return false;
    }
  }
  if (filters.brand && row.brand_key !== normalizeKey(filters.brand)) {
    return false;
  }
  if (filters.vendor && row.vendor_key !== normalizeKey(filters.vendor)) {
    return false;
  }
  return true;
};

const sortText = (left, right) =>
  normalizeText(left).localeCompare(normalizeText(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });

const uniqueSorted = (values = []) =>
  [
    ...new Map(
      (Array.isArray(values) ? values : [])
        .map(normalizeText)
        .filter(Boolean)
        .map((value) => [value.toLowerCase(), value]),
    ).values(),
  ].sort(sortText);

const buildFilterOptions = (rows = []) => ({
  countries: uniqueSorted(rows.map((row) => row.country)),
  brands: uniqueSorted(rows.map((row) => row.brand).filter((value) => value !== "N/A")),
  vendors: uniqueSorted(rows.map((row) => row.vendor).filter((value) => value !== "N/A")),
});

const createMetric = () => ({
  containerKeys: new Set(),
  totalAllocatedCbm: 0,
});

const addMetricRow = (metric, row) => {
  if (!metric || !row) return metric;
  if (row.container_key) metric.containerKeys.add(row.container_key);
  metric.totalAllocatedCbm += Number(row.allocated_cbm || 0);
  return metric;
};

const serializeMetric = (metric = createMetric()) => ({
  unique_container_count: metric.containerKeys.size,
  total_allocated_cbm: toRoundedCbmValue(metric.totalAllocatedCbm),
});

const createDisplayMapEntry = (label, metric = createMetric()) => ({
  label,
  metric,
});

const ensureMapEntry = (map, key, label) => {
  if (!map.has(key)) {
    map.set(key, createDisplayMapEntry(label, createMetric()));
  }
  return map.get(key);
};

const buildOverallVendorTotals = (rows = []) => {
  const map = new Map();
  rows.forEach((row) => {
    const entry = ensureMapEntry(map, row.vendor_key, row.vendor);
    addMetricRow(entry.metric, row);
  });
  return [...map.values()]
    .map((entry) => ({
      vendor: entry.label,
      ...serializeMetric(entry.metric),
    }))
    .sort((left, right) => sortText(left.vendor, right.vendor));
};

const buildBrandSections = (rows = []) => {
  const brandMap = new Map();

  rows.forEach((row) => {
    const brandEntry = ensureMapEntry(brandMap, row.brand_key, row.brand);
    addMetricRow(brandEntry.metric, row);
    if (!brandEntry.vendors) brandEntry.vendors = new Map();
    const vendorEntry = ensureMapEntry(
      brandEntry.vendors,
      row.vendor_key,
      row.vendor,
    );
    addMetricRow(vendorEntry.metric, row);
  });

  return [...brandMap.values()]
    .map((brandEntry) => ({
      brand: brandEntry.label,
      ...serializeMetric(brandEntry.metric),
      vendors: [...(brandEntry.vendors || new Map()).values()]
        .map((vendorEntry) => ({
          vendor: vendorEntry.label,
          ...serializeMetric(vendorEntry.metric),
        }))
        .sort((left, right) => sortText(left.vendor, right.vendor)),
    }))
    .sort((left, right) => sortText(left.brand, right.brand));
};

const buildVendorDistribution = (rows = []) => {
  const vendorMap = new Map();
  const brandNames = new Map();

  rows.forEach((row) => {
    brandNames.set(row.brand_key, row.brand);
    const vendorEntry = ensureMapEntry(vendorMap, row.vendor_key, row.vendor);
    addMetricRow(vendorEntry.metric, row);
    if (!vendorEntry.brands) vendorEntry.brands = new Map();
    const brandEntry = ensureMapEntry(
      vendorEntry.brands,
      row.brand_key,
      row.brand,
    );
    addMetricRow(brandEntry.metric, row);
  });

  const brands = [...brandNames.values()].sort(sortText);
  const rowsByVendor = [...vendorMap.values()]
    .map((vendorEntry) => ({
      vendor: vendorEntry.label,
      ...serializeMetric(vendorEntry.metric),
      totals: [...(vendorEntry.brands || new Map()).values()]
        .map((brandEntry) => ({
          brand: brandEntry.label,
          ...serializeMetric(brandEntry.metric),
        }))
        .sort((left, right) => sortText(left.brand, right.brand)),
    }))
    .sort((left, right) => sortText(left.vendor, right.vendor));

  return {
    brands,
    rows: rowsByVendor,
  };
};

const resolveSelectedVendor = ({ filters = {}, rows = [] } = {}) => {
  const availableVendors = uniqueSorted(rows.map((row) => row.vendor));
  if (filters.vendor) {
    const matched = availableVendors.find(
      (vendor) => normalizeKey(vendor) === normalizeKey(filters.vendor),
    );
    return matched || "";
  }
  if (filters.selected_vendor) {
    const matched = availableVendors.find(
      (vendor) => normalizeKey(vendor) === normalizeKey(filters.selected_vendor),
    );
    if (matched) return matched;
  }
  return availableVendors[0] || "";
};

const buildMonthlyTrend = ({ rows = [], period, selectedVendor = "" } = {}) => {
  const selectedVendorKey = normalizeKey(selectedVendor);
  const vendorRows = selectedVendorKey
    ? rows.filter((row) => row.vendor_key === selectedVendorKey)
    : [];
  const brandNames = new Map();
  vendorRows.forEach((row) => brandNames.set(row.brand_key, row.brand));
  const brands = [...brandNames.values()].sort(sortText);

  const monthRows = period.months.map((month) => {
    const brandMap = new Map();
    const monthMetric = createMetric();

    vendorRows
      .filter((row) => row.month_key === month.key)
      .forEach((row) => {
        addMetricRow(monthMetric, row);
        const brandEntry = ensureMapEntry(brandMap, row.brand_key, row.brand);
        addMetricRow(brandEntry.metric, row);
      });

    return {
      month: month.key,
      month_label: month.label,
      ...serializeMetric(monthMetric),
      totals: brands.map((brand) => {
        const entry = brandMap.get(normalizeKey(brand));
        return {
          brand,
          ...(entry ? serializeMetric(entry.metric) : {
            unique_container_count: 0,
            total_allocated_cbm: 0,
          }),
        };
      }),
    };
  });

  return {
    vendor: selectedVendor,
    brands,
    rows: monthRows,
  };
};

const buildDetailRecords = (rows = []) => {
  const map = new Map();

  rows.forEach((row) => {
    const key = row.container_key;
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, {
        container: row.container,
        vendors: new Map(),
        brands: new Map(),
        countries: new Map(),
        orderIds: new Map(),
        itemCodes: new Map(),
        stuffingDates: new Set(),
        stuffingTimestamps: [],
        allocatedCbm: 0,
        shipmentQuantity: 0,
        shipmentCount: 0,
      });
    }

    const entry = map.get(key);
    if (row.vendor && row.vendor !== "N/A") entry.vendors.set(row.vendor_key, row.vendor);
    if (row.brand && row.brand !== "N/A") entry.brands.set(row.brand_key, row.brand);
    if (row.country) entry.countries.set(row.country_key, row.country);
    if (row.order_id && row.order_id !== "N/A") {
      entry.orderIds.set(normalizeKey(row.order_id), row.order_id);
    }
    if (row.item_code) entry.itemCodes.set(normalizeKey(row.item_code), row.item_code);
    if (row.stuffing_date_iso) entry.stuffingDates.add(row.stuffing_date_iso);
    const timestamp = new Date(row.stuffing_date).getTime();
    if (Number.isFinite(timestamp)) entry.stuffingTimestamps.push(timestamp);
    entry.allocatedCbm += Number(row.allocated_cbm || 0);
    entry.shipmentQuantity += Number(row.shipment_quantity || 0);
    entry.shipmentCount += 1;
  });

  return [...map.values()]
    .map((entry) => {
      const sortedDates = [...entry.stuffingDates].sort();
      const minTimestamp = Math.min(...entry.stuffingTimestamps);
      const maxTimestamp = Math.max(...entry.stuffingTimestamps);
      return {
        container: entry.container,
        vendor: uniqueSorted([...entry.vendors.values()]).join(", ") || "N/A",
        brands: uniqueSorted([...entry.brands.values()]),
        countries: uniqueSorted([...entry.countries.values()]),
        stuffing_date:
          sortedDates.length === 1
            ? sortedDates[0]
            : sortedDates.length > 1
              ? `${sortedDates[0]} - ${sortedDates[sortedDates.length - 1]}`
              : "",
        stuffing_date_from:
          Number.isFinite(minTimestamp) ? toKolkataIsoDate(new Date(minTimestamp)) : "",
        stuffing_date_to:
          Number.isFinite(maxTimestamp) ? toKolkataIsoDate(new Date(maxTimestamp)) : "",
        stuffing_dates: sortedDates,
        order_ids: uniqueSorted([...entry.orderIds.values()]),
        item_codes: uniqueSorted([...entry.itemCodes.values()]),
        allocated_cbm: toRoundedCbmValue(entry.allocatedCbm),
        shipment_quantity: entry.shipmentQuantity,
        shipment_count: entry.shipmentCount,
      };
    })
    .sort((left, right) => sortText(left.container, right.container));
};

const applyDrilldownFilters = (rows = [], query = {}) => {
  const detailVendor = normalizeOptionalFilter(
    query.detail_vendor ?? query.detailVendor,
  );
  const detailBrand = normalizeOptionalFilter(
    query.detail_brand ?? query.detailBrand,
  );
  const month = normalizeText(query.month ?? query.month_key ?? query.monthKey);

  return rows.filter((row) => {
    if (detailVendor && row.vendor_key !== normalizeKey(detailVendor)) {
      return false;
    }
    if (detailBrand && row.brand_key !== normalizeKey(detailBrand)) {
      return false;
    }
    if (month && row.month_key !== month) {
      return false;
    }
    return true;
  });
};

const buildMonthlyShipmentsReportFromRows = ({
  rows = [],
  query = {},
  period,
} = {}) => {
  const filters = getReportFiltersFromQuery(query);
  const normalizedRows = normalizeContributionRows(rows);
  const filteredRows = normalizedRows.filter((row) =>
    matchesReportFilters(row, filters),
  );
  const selectedVendor = resolveSelectedVendor({ filters, rows: filteredRows });
  const physicalContainerKeys = new Set(
    filteredRows.map((row) => row.container_key).filter(Boolean),
  );
  const vendorKeys = new Set(
    filteredRows.map((row) => row.vendor_key).filter(Boolean),
  );

  return {
    period: {
      mode: period.mode,
      year: period.year,
      month: period.month,
      from_date: period.from_date,
      to_date: period.to_date,
      timezone: period.timezone,
      label: period.label,
      months: period.months,
    },
    filters: {
      country: filters.country,
      brand: filters.brand,
      vendor: filters.vendor,
      selected_vendor: selectedVendor,
      options: buildFilterOptions(normalizedRows),
    },
    summary: {
      total_unique_containers: physicalContainerKeys.size,
      total_allocated_cbm: toRoundedCbmValue(
        filteredRows.reduce((sum, row) => sum + Number(row.allocated_cbm || 0), 0),
      ),
      vendors_count: vendorKeys.size,
    },
    overall: {
      vendor_totals: buildOverallVendorTotals(filteredRows),
    },
    by_brand: {
      brands: buildBrandSections(filteredRows),
    },
    by_vendor: {
      distribution: buildVendorDistribution(filteredRows),
      monthly_trend: buildMonthlyTrend({
        rows: filteredRows,
        period,
        selectedVendor,
      }),
      selected_vendor: selectedVendor,
    },
    calculation: {
      cbm_source:
        "backend/services/shipmentCbmAllocation.service.js::resolveShipmentRowCbm",
      precision: 6,
      rounding: "Full precision is kept through aggregation and rounded for display fields.",
    },
  };
};

const buildMonthlyShipmentsDrilldownFromRows = ({
  rows = [],
  query = {},
  period,
} = {}) => {
  const filters = getReportFiltersFromQuery(query);
  const normalizedRows = normalizeContributionRows(rows);
  const filteredRows = applyDrilldownFilters(
    normalizedRows.filter((row) => matchesReportFilters(row, filters)),
    query,
  );
  const records = buildDetailRecords(filteredRows);

  return {
    period: {
      mode: period.mode,
      from_date: period.from_date,
      to_date: period.to_date,
      timezone: period.timezone,
      label: period.label,
    },
    filters: {
      country: filters.country,
      brand: filters.brand,
      vendor: filters.vendor,
      detail_vendor: normalizeOptionalFilter(
        query.detail_vendor ?? query.detailVendor,
      ),
      detail_brand: normalizeOptionalFilter(
        query.detail_brand ?? query.detailBrand,
      ),
      month: normalizeText(query.month ?? query.month_key ?? query.monthKey),
    },
    summary: {
      total_unique_containers: records.length,
      total_allocated_cbm: toRoundedCbmValue(
        records.reduce((sum, row) => sum + Number(row.allocated_cbm || 0), 0),
      ),
    },
    records,
  };
};

const buildShipmentBaseMatch = ({ period, user } = {}) =>
  applyDataAccessMatch(
    {
      archived: { $ne: true },
      status: { $in: INCLUDED_STATUSES },
      "shipment.0": { $exists: true },
      "shipment.stuffing_date": {
        $gte: period.from_utc,
        $lt: period.to_exclusive_utc,
      },
      "shipment.container": { $exists: true },
    },
    user,
  );

const buildExactTextMatch = (field, value) => {
  const normalized = normalizeOptionalFilter(value);
  if (!normalized) return {};
  return {
    [field]: {
      $regex: `^${escapeRegex(normalized)}$`,
      $options: "i",
    },
  };
};

const fetchMonthlyShipmentContributionRows = async ({
  period,
  user,
  query = {},
} = {}) => {
  const match = combineMongoMatches(
    buildShipmentBaseMatch({ period, user }),
    buildExactTextMatch("brand", query.brand),
    buildExactTextMatch("vendor", query.vendor),
  );

  const pipeline = [
    { $match: match },
    {
      $project: {
        order_id: 1,
        brand: 1,
        vendor: 1,
        status: 1,
        quantity: 1,
        total_po_cbm: 1,
        item: 1,
        shipment: 1,
      },
    },
    { $unwind: "$shipment" },
    {
      $addFields: {
        container_trim: {
          $trim: {
            input: { $ifNull: ["$shipment.container", ""] },
          },
        },
      },
    },
    {
      $match: {
        container_trim: { $ne: "" },
        "shipment.stuffing_date": {
          $gte: period.from_utc,
          $lt: period.to_exclusive_utc,
        },
      },
    },
    {
      $lookup: {
        from: "items",
        let: {
          item_code_key: {
            $toLower: {
              $trim: {
                input: {
                  $toString: { $ifNull: ["$item.item_code", ""] },
                },
              },
            },
          },
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $eq: [
                  {
                    $toLower: {
                      $trim: {
                        input: {
                          $toString: { $ifNull: ["$code", ""] },
                        },
                      },
                    },
                  },
                  "$$item_code_key",
                ],
              },
            },
          },
          {
            $project: {
              code: 1,
              country_of_origin: 1,
              cbm: 1,
              inspected_item_sizes: 1,
              inspected_box_sizes: 1,
              inspected_box_mode: 1,
              pis_item_sizes: 1,
              pis_box_sizes: 1,
              pis_box_mode: 1,
            },
          },
          { $limit: 1 },
        ],
        as: "item_doc",
      },
    },
    {
      $unwind: {
        path: "$item_doc",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        country_trim: {
          $trim: {
            input: { $ifNull: ["$item_doc.country_of_origin", ""] },
          },
        },
      },
    },
  ];

  const country = normalizeOptionalFilter(query.country);
  if (country) {
    if (normalizeKey(country) === normalizeKey(NOT_SET)) {
      pipeline.push({ $match: { country_trim: "" } });
    } else {
      pipeline.push({
        $match: {
          country_trim: {
            $regex: `^${escapeRegex(country)}$`,
            $options: "i",
          },
        },
      });
    }
  }

  pipeline.push(
    {
      $project: {
        order_document_id: "$_id",
        shipment_id: "$shipment._id",
        order_id: 1,
        brand: 1,
        vendor: 1,
        status: 1,
        item_code: "$item.item_code",
        item_description: "$item.description",
        order_quantity: "$quantity",
        total_po_cbm: 1,
        shipment_quantity: "$shipment.quantity",
        container: "$container_trim",
        stuffing_date: "$shipment.stuffing_date",
        country: "$country_trim",
        item_doc: 1,
      },
    },
    { $sort: { container: 1, brand: 1, vendor: 1, order_id: 1 } },
  );

  const rows = await Order.aggregate(pipeline).allowDiskUse(true);

  return rows.map((row) => {
    const allocatedCbm = resolveShipmentRowCbm({
      itemDoc: row?.item_doc || null,
      orderQuantity: row?.order_quantity,
      storedPoCbm: row?.total_po_cbm,
      shipmentQuantity: row?.shipment_quantity,
    });
    const cbmSource =
      row?.item_doc && allocatedCbm > 0
        ? "shipment_cbm_allocation"
        : row?.total_po_cbm
          ? "total_po_cbm"
          : "";

    return {
      order_document_id: normalizeText(row?.order_document_id),
      shipment_id: normalizeText(row?.shipment_id),
      order_id: row?.order_id,
      brand: row?.brand,
      vendor: row?.vendor,
      status: row?.status,
      item_code: row?.item_code,
      item_description: row?.item_description,
      order_quantity: row?.order_quantity,
      shipment_quantity: row?.shipment_quantity,
      container: row?.container,
      stuffing_date: row?.stuffing_date,
      stuffing_date_iso: toKolkataIsoDate(row?.stuffing_date),
      country: normalizeCountry(row?.country),
      allocated_cbm: allocatedCbm,
      cbm_source: cbmSource,
      month_key: monthKeyFromDate(row?.stuffing_date),
    };
  });
};

const getMonthlyShipmentsReportData = async ({
  query = {},
  user = null,
  now = new Date(),
  fetchRows = fetchMonthlyShipmentContributionRows,
} = {}) => {
  const period = resolveReportPeriod({ query, now });
  const rows = await fetchRows({ period, user, query });
  return buildMonthlyShipmentsReportFromRows({ rows, query, period });
};

const getMonthlyShipmentsDrilldownData = async ({
  query = {},
  user = null,
  now = new Date(),
  fetchRows = fetchMonthlyShipmentContributionRows,
} = {}) => {
  const period = resolveReportPeriod({ query, now });
  const rows = await fetchRows({ period, user, query });
  return buildMonthlyShipmentsDrilldownFromRows({ rows, query, period });
};

module.exports = {
  INCLUDED_STATUSES,
  NOT_SET,
  TIMEZONE,
  buildDetailRecords,
  buildMonthlyShipmentsDrilldownFromRows,
  buildMonthlyShipmentsReportFromRows,
  buildShipmentBaseMatch,
  fetchMonthlyShipmentContributionRows,
  getMonthlyShipmentsDrilldownData,
  getMonthlyShipmentsReportData,
  normalizeContributionRows,
  resolveReportPeriod,
  toKolkataIsoDate,
};
