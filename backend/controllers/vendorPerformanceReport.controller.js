const ExcelJS = require("exceljs");
const sharp = require("sharp");
const mongoose = require("mongoose");
const Order = require("../models/order.model");
const Item = require("../models/item.model");
const Tenure = require("../models/tenure.model");
const Inspection = require("../models/inspection.model");
const { applyDataAccessMatch } = require("../services/userDataAccess.service");
const {
  buildVendorFilter,
  buildVendorsArrayFilter,
  normalizeVendorText,
} = require("../helpers/vendorRef");
const {
  deriveGroupedOrderStatus,
  deriveOrderProgress,
  normalizeOrderStatus,
} = require("../helpers/orderStatus");
const { groupProductAnalyticsRows } = require("./product.controller");
const {
  buildClaimsReportRow,
  isCurrentClaimSystemItem,
} = require("./reports.controller");
const { parseDateOnly } = require("../helpers/dateOnly");

const DAY_MS = 24 * 60 * 60 * 1000;
const KOLKATA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MAX_CHART_ROWS = 12;
const monthFormatter = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const ACTIVE_ORDER_MATCH = {
  $and: [{ archived: { $ne: true } }, { status: { $ne: "Cancelled" } }],
};

const normalizeText = (value) => String(value ?? "").trim();
const normalizeVendor = (value) => normalizeVendorText(value);
const normalizeBrandFilters = (value) => [...new Set(
  (Array.isArray(value) ? value : String(value ?? "").split(","))
    .map(normalizeText)
    .filter(Boolean),
)];
const buildBrandMatch = (brands = []) => brands.length > 0 ? { brand: { $in: brands } } : {};
const buildItemBrandMatch = (brands = []) => brands.length > 0 ? {
  $or: [
    { brand: { $in: brands } },
    { brand_name: { $in: brands } },
    { brands: { $in: brands } },
  ],
} : {};
const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};
const toUtcDate = (value) => {
  return parseDateOnly(value);
};
const toIsoDate = (value) => {
  const date = toUtcDate(value);
  return date ? date.toISOString().slice(0, 10) : "";
};
const differenceInDays = (actualDate, etdDate) => {
  const actual = toUtcDate(actualDate);
  const etd = toUtcDate(etdDate);
  return actual && etd ? Math.round((actual.getTime() - etd.getTime()) / DAY_MS) : null;
};
const delayStatus = (days) => {
  if (!Number.isFinite(days)) return "Unknown";
  if (days > 0) return "Delayed";
  if (days < 0) return "Early";
  return "On time";
};
const effectiveEtd = (order) => toUtcDate(order?.revised_ETD) || toUtcDate(order?.ETD);
const resolveEtdDateRange = ({ fromDate = "", toDate = "" } = {}) => {
  const hasFromDate = Boolean(normalizeText(fromDate));
  const hasToDate = Boolean(normalizeText(toDate));
  const from = hasFromDate ? parseDateOnly(fromDate) : null;
  const to = hasToDate ? parseDateOnly(toDate) : null;
  if ((hasFromDate && !from) || (hasToDate && !to) || (from && to && from > to)) return null;
  return {
    from,
    toExclusive: to ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() + 1)) : null,
    fromInstant: from ? new Date(from.getTime() - KOLKATA_OFFSET_MS) : null,
    toExclusiveInstant: to ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() + 1) - KOLKATA_OFFSET_MS) : null,
  };
};
const buildEffectiveEtdMatch = (range) => {
  if (!range?.fromInstant && !range?.toExclusiveInstant) return {};
  const dateMatch = {};
  if (range.fromInstant) dateMatch.$gte = range.fromInstant;
  if (range.toExclusiveInstant) dateMatch.$lt = range.toExclusiveInstant;
  return {
    $or: [
      { revised_ETD: dateMatch },
      { revised_ETD: null, ETD: dateMatch },
    ],
  };
};
const scopedActiveOrders = (user, extraMatch = {}) => applyDataAccessMatch(
  { $and: [...ACTIVE_ORDER_MATCH.$and, extraMatch] },
  user,
);

const getCompleteShipmentDate = (shipments = [], quantity = 0) => {
  if (quantity <= 0) return null;
  let shipped = 0;
  const rows = (Array.isArray(shipments) ? shipments : [])
    .map((shipment) => ({ date: toUtcDate(shipment?.stuffing_date), quantity: toNumber(shipment?.quantity) }))
    .filter((shipment) => shipment.date)
    .sort((left, right) => left.date - right.date);
  for (const shipment of rows) {
    shipped += shipment.quantity;
    if (shipped >= quantity) return shipment.date;
  }
  return null;
};

const buildPoSections = (orderRows = []) => {
  const today = toUtcDate(new Date());
  const groups = new Map();
  for (const order of orderRows) {
    const vendor = normalizeVendor(order?.vendor);
    const brand = normalizeText(order?.brand);
    const po = normalizeText(order?.order_id);
    const key = `${vendor.toLowerCase()}__${brand.toLowerCase()}__${po.toLowerCase()}`;
    const group = groups.get(key) || {
      po,
      vendor,
      brand,
      total_quantity: 0,
      item_count: 0,
      all_packed: true,
      all_shipped: true,
      packed_date: null,
      shipping_date: null,
      etd: null,
      statuses: [],
    };
    const quantity = toNumber(order?.quantity);
    const progress = deriveOrderProgress({ orderEntry: order });
    const storedStatus = normalizeOrderStatus(order?.status);
    const isPacked = quantity > 0 && (
      progress.pending_inspection_quantity <= 0
      || ["Inspection Done", "Partial Shipped", "Shipped"].includes(storedStatus)
    );
    const packedDate = toUtcDate(order?.qc_record?.last_inspected_date);
    const shippingDate = getCompleteShipmentDate(order?.shipment, quantity);
    const etd = effectiveEtd(order);

    group.total_quantity += quantity;
    group.item_count += 1;
    group.all_packed = group.all_packed && isPacked;
    group.all_shipped = group.all_shipped && Boolean(shippingDate);
    if (packedDate && (!group.packed_date || packedDate > group.packed_date)) group.packed_date = packedDate;
    if (shippingDate && (!group.shipping_date || shippingDate > group.shipping_date)) group.shipping_date = shippingDate;
    if (etd && (!group.etd || etd > group.etd)) group.etd = etd;
    group.statuses.push(order?.status);
    groups.set(key, group);
  }

  const serialize = (group, actualDate, actualKey, {
    inspectionPending = false,
    comparisonDate = group.etd,
    comparisonKey = "etd",
  } = {}) => {
    const days = differenceInDays(actualDate, comparisonDate);
    const isOverdueInspectionPending = inspectionPending && group.etd < today;
    return {
      po: group.po,
      brand: group.brand,
      vendor: group.vendor,
      [comparisonKey]: toIsoDate(comparisonDate),
      [actualKey]: toIsoDate(actualDate),
      difference_days: days,
      status: inspectionPending
        ? isOverdueInspectionPending ? "Inspection pending — delayed" : "Inspection pending"
        : delayStatus(days),
      is_inspection_pending: inspectionPending,
      is_overdue_inspection_pending: isOverdueInspectionPending,
      po_status: deriveGroupedOrderStatus(group.statuses),
      item_count: group.item_count,
      total_quantity: group.total_quantity,
    };
  };
  const compareRows = (left, right) => (
    Number(right.difference_days ?? -Infinity) - Number(left.difference_days ?? -Infinity)
    || String(left.po).localeCompare(String(right.po), undefined, { numeric: true })
  );
  const serializeStuffingDelay = (group) => {
    const finalPackedDate = group.all_packed ? group.packed_date : null;
    const packedDifference = differenceInDays(group.shipping_date, finalPackedDate);
    const etdDifference = differenceInDays(group.shipping_date, group.etd);
    return {
      ...serialize(group, group.shipping_date, "stuffing_date", {
        comparisonDate: finalPackedDate,
        comparisonKey: "final_packed_date",
      }),
      effective_etd: toIsoDate(group.etd),
      packed_difference_days: packedDifference,
      packed_status: delayStatus(packedDifference),
      etd_difference_days: etdDifference,
      etd_status: delayStatus(etdDifference),
    };
  };

  return {
    po_delay: [...groups.values()]
      .filter((group) => group.etd && group.all_packed && group.packed_date)
      .map((group) => serialize(group, group.packed_date, "packed_date"))
      .sort(compareRows),
    shipping_delay: [...groups.values()]
      .filter((group) => group.all_shipped && group.shipping_date && (group.etd || (group.all_packed && group.packed_date)))
      .map(serializeStuffingDelay)
      .sort(compareRows),
  };
};

const claimPercentage = (tenure) => tenure?.delivered_quantity > 0
  ? Number(((tenure.rejected_quantity / tenure.delivered_quantity) * 100).toFixed(2))
  : 0;

const buildClaimRows = (items = [], tenureById = new Map()) => {
  const rows = items.filter(isCurrentClaimSystemItem).map((item) => buildClaimsReportRow(item, tenureById));
  const currentTenureEnd = rows
    .flatMap((row) => row.tenures.map((tenure) => tenure.to_date))
    .filter(Boolean)
    .sort()
    .at(-1) || "";

  return rows.map((row) => {
    const tenures = [...row.tenures]
      .sort((left, right) => String(left.from_date).localeCompare(String(right.from_date)))
      .map((tenure) => ({ ...tenure, percentage: claimPercentage(tenure) }));
    const current = currentTenureEnd
      ? tenures.find((tenure) => tenure.to_date === currentTenureEnd)
      : tenures.at(-1);
    const previous = currentTenureEnd
      ? tenures.filter((tenure) => tenure.to_date < currentTenureEnd).at(-1)
      : tenures.at(-2);
    const currentPercentage = claimPercentage(current);
    const previousPercentage = claimPercentage(previous);
    const remark = currentPercentage === 0 && previousPercentage > 0
      ? "positive"
      : currentPercentage > 0 && previousPercentage === 0
        ? "negative"
        : currentPercentage < previousPercentage ? "positive" : currentPercentage > previousPercentage ? "negative" : "neutral";
    return {
      ...row,
      tenures,
      current_claim_percentage: currentPercentage,
      remark,
    };
  });
};

const buildTenureClaimAverageRows = (rows = []) => {
  const totals = new Map();
  rows.forEach((row) => (row.tenures || []).forEach((tenure) => {
    const from_date = String(tenure?.from_date || "");
    const to_date = String(tenure?.to_date || "");
    if (!from_date || !to_date) return;
    const key = String(tenure?.tenure_id || `${row?.brand || ""}:${from_date}:${to_date}`);
    const total = totals.get(key) || { brand: row?.brand || "", from_date, to_date, item_count: 0, delivered_quantity: 0, rejected_quantity: 0 };
    total.item_count += 1;
    total.delivered_quantity += Number(tenure?.delivered_quantity || 0);
    total.rejected_quantity += Number(tenure?.rejected_quantity || 0);
    totals.set(key, total);
  }));
  return [...totals.values()]
    .map((total) => ({
      ...total,
      label: [total.brand, `${total.from_date} to ${total.to_date}`].filter(Boolean).join(" · "),
      average_claim_percentage: claimPercentage(total),
    }))
    .sort((left, right) => left.from_date.localeCompare(right.from_date) || left.to_date.localeCompare(right.to_date) || left.brand.localeCompare(right.brand));
};

const chartNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const average = (rows = [], key) => {
  const values = rows.map((row) => chartNumber(row?.[key])).filter((value) => value !== null);
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null;
};
const buildVendorPerformanceSummaries = ({ poRows = [], claimRows = [], shippingRows = [], brands = [] } = {}) => {
  const selectedBrands = [...new Set(brands.filter(Boolean))];
  const poStats = (rows) => ({
    po_count: rows.length,
    delayed_po_count: rows.filter((row) => Number(row?.difference_days || 0) > 0).length,
    early_po_count: rows.filter((row) => Number(row?.difference_days || 0) < 0).length,
    average_delay_days: average(rows, "difference_days"),
  });
  const brandRows = selectedBrands.map((brand) => {
    const rows = poRows.filter((row) => normalizeText(row?.brand).toLowerCase() === normalizeText(brand).toLowerCase());
    return { brand, ...poStats(rows) };
  });
  const claimTotals = claimRows.reduce((total, row) => ({
    delivered_quantity: total.delivered_quantity + Number(row?.delivered_quantity || 0),
    rejected_quantity: total.rejected_quantity + Number(row?.rejected_quantity || 0),
  }), { delivered_quantity: 0, rejected_quantity: 0 });
  return {
    po_delay: { combined: poStats(poRows), brands: brandRows },
    product_complaints: {
      item_count: claimRows.length,
      average_claim_percentage: claimTotals.delivered_quantity > 0
        ? Number(((claimTotals.rejected_quantity / claimTotals.delivered_quantity) * 100).toFixed(2))
        : 0,
    },
    shipping_delay: {
      delayed_po_count: shippingRows.filter((row) => Number(row?.packed_difference_days || 0) > 0).length,
      average_stuffing_time_days: average(shippingRows, "packed_difference_days"),
    },
  };
};
const chartRows = (rows, keys) => rows
  .filter((row) => keys.some((key) => chartNumber(row?.[key]) !== null))
  .slice()
  .sort((left, right) => Math.max(...keys.map((key) => Math.abs(chartNumber(right?.[key]) || 0))) - Math.max(...keys.map((key) => Math.abs(chartNumber(left?.[key]) || 0))))
  .slice(0, MAX_CHART_ROWS);
const chartPoLabel = (row) => [row?.po, row?.brand].filter(Boolean).join(" / ") || "PO";
const chartPoStatus = (row) => row?.is_overdue_inspection_pending
  ? "Inspection overdue"
  : row?.is_inspection_pending ? "Inspection pending" : row?.status || "Unknown";
const chartCounts = (rows, getLabel) => Object.entries(rows.reduce((result, row) => {
  const label = getLabel(row);
  result[label] = (result[label] || 0) + 1;
  return result;
}, {})).map(([label, count]) => ({ label, count }));
const stuffingStatusCounts = (rows) => rows.reduce((result, row) => {
  const packed = row?.packed_status || "Unknown";
  const etd = row?.etd_status || "Unknown";
  (result[packed] ||= { packed: 0, etd: 0 }).packed += 1;
  (result[etd] ||= { packed: 0, etd: 0 }).etd += 1;
  return result;
}, {});
const monthlyChartColor = (index, total) => `hsl(${Math.round(index * 360 / Math.max(1, total))} 65% 44%)`;
const buildMonthlyPoDelayChartSpec = (rows = [], dateKey = "etd", delayKey = "difference_days", title = "Monthly PO delay: ETD vs final packed") => {
  const chartData = rows
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.[dateKey] || "")) && chartNumber(row?.[delayKey]) !== null)
    .slice()
    .sort((left, right) => String(left[dateKey]).localeCompare(String(right[dateKey])) || chartPoLabel(left).localeCompare(chartPoLabel(right)))
    .map((row) => ({
      month: String(row[dateKey]).slice(0, 7),
      label: chartPoLabel(row),
      difference_days: chartNumber(row[delayKey]),
    }));
  const monthStats = chartData.reduce((result, row) => {
    const stats = result.get(row.month) || { sum: 0, count: 0 };
    stats.sum += row.difference_days;
    stats.count += 1;
    result.set(row.month, stats);
    return result;
  }, new Map());
  const months = [...monthStats.keys()];
  const monthIndexes = new Map(months.map((month, index) => [month, index]));
  const overallAverageDelay = chartData.length ? chartData.reduce((sum, row) => sum + row.difference_days, 0) / chartData.length : null;
  return {
    type: "monthly_po_delay",
    title,
    data: chartData.map((row) => ({ ...row, color: monthlyChartColor(monthIndexes.get(row.month), months.length), average_delay: monthStats.get(row.month).sum / monthStats.get(row.month).count, overall_average_delay: overallAverageDelay })),
  };
};
const buildVendorPerformanceChartSpecs = (section, rows = [], poDelayRows = rows) => {
  const monthlyPoDelay = buildMonthlyPoDelayChartSpec(poDelayRows);
  if (section === "po_delay") return [
    monthlyPoDelay,
    {
      title: "ETD vs final packed",
      data: chartRows(rows, ["difference_days"]).map((row) => ({
        label: chartPoLabel(row),
        difference_days: chartNumber(row.difference_days),
        color: row.difference_days > 0 ? "#dc3545" : row.difference_days < 0 ? "#198754" : "#0d6efd",
      })),
      series: [{ key: "difference_days", label: "ETD vs final packed (days)", color: "#0d6efd" }],
    },
    {
      title: "PO status breakdown",
      data: chartCounts(rows, chartPoStatus),
      series: [{ key: "count", label: "POs", color: "#0d6efd" }],
    },
  ];
  if (section === "product_complaints") return [monthlyPoDelay, {
    title: "Average claim rate by tenure",
    data: buildTenureClaimAverageRows(rows),
    series: [{ key: "average_claim_percentage", label: "Average claim (%)", color: "#dc3545" }],
  }];
  if (section === "shipping_delay") {
    const statusCounts = stuffingStatusCounts(rows);
    return [
    buildMonthlyPoDelayChartSpec(rows, "final_packed_date", "packed_difference_days", "Monthly stuffing delay: final packed vs stuffing"),
    {
      title: "Final packed vs stuffing",
      data: chartRows(rows, ["packed_difference_days"]).map((row) => ({
        label: chartPoLabel(row),
        packed_difference_days: chartNumber(row.packed_difference_days),
      })),
      series: [{ key: "packed_difference_days", label: "Stuffing vs final packed (days)", color: "#6f42c1" }],
    },
    {
      title: "Stuffing status breakdown",
      data: ["Early", "On time", "Delayed", "Unknown"].map((label) => ({
        label,
        packed: statusCounts[label]?.packed || 0,
        etd: statusCounts[label]?.etd || 0,
      })).filter((row) => row.packed || row.etd),
      series: [
        { key: "packed", label: "vs final packed", color: "#6f42c1" },
        { key: "etd", label: "vs ETD", color: "#fd7e14" },
      ],
    },
    ];
  }
  return monthlyPoDelay.data.length > 0 ? [monthlyPoDelay] : [];
};
const escapeSvg = (value) => String(value ?? "").replace(/[&<>"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
}[character]));
const renderHorizontalBarChartSvg = ({ title, data, series }) => {
  const width = 1000;
  const height = Math.max(260, 105 + data.length * 38);
  const left = 235;
  const right = 80;
  const top = 58;
  const bottom = 28;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = data.flatMap((row) => series.map((entry) => chartNumber(row?.[entry.key]))).filter((value) => value !== null);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const min = rawMin < 0 ? rawMin * 1.1 : 0;
  const max = rawMax > 0 ? rawMax * 1.1 : 1;
  const x = (value) => left + ((value - min) / (max - min || 1)) * plotWidth;
  const zeroX = x(0);
  const groupHeight = plotHeight / Math.max(1, data.length);
  const barHeight = Math.max(7, Math.min(14, (groupHeight - 8) / Math.max(1, series.length)));
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = min + ((max - min) * index / 4);
    const gridX = x(value);
    return `<line x1="${gridX}" y1="${top}" x2="${gridX}" y2="${height - bottom}" stroke="#d9dee5"/><text x="${gridX}" y="${height - 8}" text-anchor="middle" font-size="11" fill="#6c757d">${Math.round(value)}</text>`;
  }).join("");
  const bars = data.map((row, rowIndex) => {
    const groupY = top + rowIndex * groupHeight;
    const labelY = groupY + groupHeight / 2 + 4;
    const rowBars = series.map((entry, seriesIndex) => {
      const value = chartNumber(row?.[entry.key]);
      if (value === null) return "";
      const startX = x(Math.min(0, value));
      const endX = x(Math.max(0, value));
      const y = groupY + 4 + seriesIndex * (barHeight + 3);
      const valueX = value >= 0 ? endX + 5 : startX - 5;
      return `<rect x="${startX}" y="${y}" width="${Math.max(1, endX - startX)}" height="${barHeight}" rx="2" fill="${row.color || entry.color}"/><text x="${valueX}" y="${y + barHeight - 2}" text-anchor="${value >= 0 ? "start" : "end"}" font-size="10" fill="#343a40">${value}</text>`;
    }).join("");
    return `<text x="${left - 8}" y="${labelY}" text-anchor="end" font-size="11" fill="#343a40">${escapeSvg(String(row.label).slice(0, 36))}</text>${rowBars}`;
  }).join("");
  const legend = series.map((entry, index) => `<rect x="${left + index * 165}" y="28" width="12" height="12" rx="2" fill="${entry.color}"/><text x="${left + 18 + index * 165}" y="38" font-size="12" fill="#343a40">${escapeSvg(entry.label)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/><text x="24" y="30" font-size="18" font-weight="700" fill="#212529">${escapeSvg(title)}</text>${legend}${grid}<line x1="${zeroX}" y1="${top}" x2="${zeroX}" y2="${height - bottom}" stroke="#6c757d" stroke-width="1.5"/>${bars}</svg>`;
};
const renderMonthlyPoDelayChartSvg = ({ title, data }) => {
  const width = Math.max(1000, 180 + data.length * 42);
  const height = 500;
  const left = 70;
  const right = 35;
  const top = 135;
  const bottom = 70;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = data.map((row) => row.difference_days);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const min = rawMin < 0 ? rawMin * 1.1 : 0;
  const max = rawMax > 0 ? rawMax * 1.1 : 1;
  const y = (value) => top + ((max - value) / (max - min || 1)) * plotHeight;
  const zeroY = y(0);
  const monthGroups = data.reduce((result, row, index) => {
    const group = result.get(row.month) || { start: index, end: index };
    group.end = index;
    result.set(row.month, group);
    return result;
  }, new Map());
  const monthEntries = [...monthGroups.entries()];
  const monthIndexes = new Map(monthEntries.map(([month], index) => [month, index]));
  const groupWidth = plotWidth / Math.max(1, monthEntries.length);
  const maxBarsPerMonth = Math.max(1, ...monthEntries.map(([, group]) => group.end - group.start + 1));
  const barWidth = Math.max(4, Math.min(8, groupWidth / maxBarsPerMonth));
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = min + ((max - min) * index / 4);
    const gridY = y(value);
    return `<line x1="${left}" y1="${gridY}" x2="${width - right}" y2="${gridY}" stroke="#d9dee5"/><text x="${left - 8}" y="${gridY + 4}" text-anchor="end" font-size="11" fill="#6c757d">${Math.round(value)}</text>`;
  }).join("");
  const bars = data.map((row, index) => {
    const group = monthGroups.get(row.month);
    const groupIndex = monthIndexes.get(row.month);
    const centerX = left + groupIndex * groupWidth + (index - group.start) * barWidth + barWidth / 2;
    const valueY = y(row.difference_days);
    const barY = Math.min(zeroY, valueY);
    const barHeight = Math.max(1, Math.abs(zeroY - valueY));
    const valueLabelY = row.difference_days >= 0 ? valueY - 5 : valueY + 14;
    return `<rect x="${centerX - barWidth / 2}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="2" fill="${row.color || "#0d6efd"}"/><text x="${centerX}" y="${valueLabelY}" text-anchor="middle" font-size="10" fill="#343a40">${row.difference_days}</text>`;
  }).join("");
  const averagePoints = monthEntries.map(([month, group], index) => ({
    x: left + index * groupWidth + groupWidth / 2,
    value: data[group.start].average_delay,
  }));
  const overallAverageDelay = chartNumber(data[0]?.overall_average_delay);
  const overallAverageLine = overallAverageDelay === null ? "" : `<line x1="${left}" y1="${y(overallAverageDelay)}" x2="${width - right}" y2="${y(overallAverageDelay)}" stroke="#dc3545" stroke-width="2" stroke-dasharray="6 4"/><text x="${width - right}" y="${y(overallAverageDelay) - 6}" text-anchor="end" font-size="11" fill="#dc3545">Overall average: ${overallAverageDelay.toFixed(2)} days</text>`;
  const averageLine = `<polyline points="${averagePoints.map((point) => `${point.x},${y(point.value)}`).join(" ")}" fill="none" stroke="#000000" stroke-width="2.5"/>${averagePoints.map((point) => `<circle cx="${point.x}" cy="${y(point.value)}" r="4" fill="#000000"/>`).join("")}${overallAverageLine}`;
  const months = monthEntries.map(([month], index) => {
    const centerX = left + index * groupWidth + groupWidth / 2;
    return `<text x="${centerX}" y="${height - 22}" text-anchor="middle" font-size="12" fill="#343a40">${monthFormatter.format(new Date(`${month}-01T00:00:00Z`))}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/><text x="24" y="30" font-size="18" font-weight="700" fill="#212529">${escapeSvg(title)}</text><line x1="24" y1="51" x2="40" y2="51" stroke="#212529" stroke-width="2.5"/><circle cx="32" cy="51" r="3" fill="#212529"/><text x="47" y="55" font-size="12" fill="#343a40">Monthly average delay</text><text x="24" y="76" font-size="12" fill="#6c757d">Each bar is one PO, grouped by month. Bar colors identify months; the line is that month’s average delay.</text>${grid}<line x1="${left}" y1="${zeroY}" x2="${width - right}" y2="${zeroY}" stroke="#6c757d" stroke-width="1.5"/>${bars}${averageLine}${months}<text x="22" y="${top + plotHeight / 2}" text-anchor="middle" font-size="12" fill="#343a40" transform="rotate(-90 22 ${top + plotHeight / 2})">Days</text></svg>`;
};

const buildVendorPerformanceDataset = async ({ vendor = "", brands, fromDate, toDate, user } = {}) => {
  const etdRange = resolveEtdDateRange({ fromDate, toDate });
  if (!etdRange) throw new Error("Invalid date filters");
  const scopedOrders = await Order.find(scopedActiveOrders(user))
    .select("vendor brand")
    .lean();
  const vendorOptions = [...new Set(scopedOrders.map((order) => normalizeVendor(order?.vendor)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const selectedVendor = normalizeText(vendor);
  const selectedBrands = normalizeBrandFilters(brands);
  const brandOptions = [...new Set(scopedOrders
    .filter((order) => !selectedVendor || normalizeVendor(order?.vendor).toLowerCase() === selectedVendor.toLowerCase())
    .map((order) => normalizeText(order?.brand))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const emptySections = {
    po_delay: { rows: [] },
    product_analytics: { rows: [] },
    product_complaints: { rows: [] },
    shipping_delay: { rows: [] },
  };
  if (!selectedVendor) {
    return { filters: { vendor_options: vendorOptions, brand_options: brandOptions }, vendor: "", sections: emptySections };
  }

  const orderMatch = scopedActiveOrders(user, {
    $and: [
      buildVendorFilter({ field: "vendor", vendorName: selectedVendor }),
      buildBrandMatch(selectedBrands),
      buildEffectiveEtdMatch(etdRange),
    ],
  });
  const orderRows = await Order.find(orderMatch)
    .select("order_id order_date brand vendor status ETD revised_ETD quantity item shipment qc_record")
    .populate("qc_record", "last_inspected_date quantities")
    .lean();
  const productAnalyticsOrderRows = await Order.find(applyDataAccessMatch(
    { $and: [
      { archived: { $ne: true } },
      buildVendorFilter({ field: "vendor", vendorName: selectedVendor }),
      buildBrandMatch(selectedBrands),
      buildEffectiveEtdMatch(etdRange),
    ] },
    user,
  ))
    .select("order_id order_date brand vendor quantity item shipment qc_record")
    .populate("qc_record", "last_inspected_date quantities")
    .lean();
  const qcIds = [...new Set([...orderRows, ...productAnalyticsOrderRows]
    .map((order) => String(order?.qc_record?._id || ""))
    .filter(Boolean))];
  const inspections = qcIds.length > 0
    ? await Inspection.find({ qc: { $in: qcIds } })
      .select("qc passed rejected inspection_date createdAt")
      .lean()
    : [];
  const inspectionsByQc = new Map();
  for (const inspection of inspections) {
    const key = String(inspection?.qc || "");
    inspectionsByQc.set(key, [...(inspectionsByQc.get(key) || []), inspection]);
  }
  const productRows = groupProductAnalyticsRows(productAnalyticsOrderRows.map((order) => ({
    order_id: order?.order_id,
    order_date: order?.order_date,
    brand: order?.brand,
    vendor: normalizeVendor(order?.vendor),
    shipment: order?.shipment,
    itemId: order?.item?._id,
    itemCode: order?.item?.item_code,
    itemName: order?.item?.description,
    quantity: order?.quantity,
    inspections: inspectionsByQc.get(String(order?.qc_record?._id || "")) || [],
  }))).sort((left, right) => {
    const quantityDelta = Number(right.orderQuantity || 0) - Number(left.orderQuantity || 0);
    return quantityDelta || String(left.itemCode || "").localeCompare(String(right.itemCode || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
  const itemMatch = applyDataAccessMatch(
    { $and: [
      { "claim_tenures.0": { $exists: true } },
      buildVendorsArrayFilter({ field: "vendors", vendorName: selectedVendor }),
      buildItemBrandMatch(selectedBrands),
      ...(etdRange.from || etdRange.toExclusive
        ? [{ code: { $in: [...new Set(productAnalyticsOrderRows.map((order) => normalizeText(order?.item?.item_code)).filter(Boolean))] } }]
        : []),
    ] },
    user,
    { brandFields: ["brand", "brand_name", "brands"], vendorFields: ["vendors"] },
  );
  const claimItems = await Item.find(itemMatch)
    .select("code name description brand brand_name brands vendors claim_tenures claim_percentage")
    .lean();
  const claimTenureIds = [...new Set(claimItems.flatMap((item) =>
    (Array.isArray(item?.claim_tenures) ? item.claim_tenures : [])
      .map((claim) => String(claim?.tenure_id || ""))
      .filter((id) => mongoose.Types.ObjectId.isValid(id)),
  ))];
  const claimTenures = claimTenureIds.length > 0
    ? await Tenure.find({ _id: { $in: claimTenureIds } }).lean()
    : [];
  const claimTenureById = new Map(claimTenures.map((tenure) => [String(tenure._id), tenure]));
  const poSections = buildPoSections(orderRows);
  const claimRows = buildClaimRows(claimItems, claimTenureById);
  const summaries = buildVendorPerformanceSummaries({
    poRows: poSections.po_delay,
    claimRows,
    shippingRows: poSections.shipping_delay,
    brands: selectedBrands.length ? selectedBrands : brandOptions,
  });

  return {
    filters: {
      vendor_options: vendorOptions,
      brand_options: brandOptions,
      brands: selectedBrands,
      from_date: etdRange.from?.toISOString().slice(0, 10) || "",
      to_date: etdRange.toExclusive ? new Date(etdRange.toExclusive.getTime() - DAY_MS).toISOString().slice(0, 10) : "",
    },
    vendor: selectedVendor,
    sections: {
      po_delay: { rows: poSections.po_delay, summary: summaries.po_delay },
      product_analytics: { rows: productRows },
      product_complaints: { rows: claimRows, summary: summaries.product_complaints },
      shipping_delay: { rows: poSections.shipping_delay, summary: summaries.shipping_delay },
    },
  };
};

const getVendorPerformanceReport = async (req, res) => {
  try {
    return res.json(await buildVendorPerformanceDataset({
      vendor: req.query.vendor,
      brands: req.query.brands,
      fromDate: req.query.from_date ?? req.query.fromDate ?? req.query.from,
      toDate: req.query.to_date ?? req.query.toDate ?? req.query.to,
      user: req.user,
    }));
  } catch (error) {
    if (error.message === "Invalid date filters") return res.status(400).json({ message: error.message });
    console.error("Vendor performance report error:", error);
    return res.status(500).json({ message: "Failed to load vendor performance report" });
  }
};

const EXPORT_COLUMNS = {
  po_delay: [
    ["po", "PO"], ["brand", "Brand"], ["packed_date", "Complete Packed Date"], ["etd", "Effective ETD"], ["difference_days", "Difference (Days)"], ["status", "Status"], ["item_count", "Items"], ["total_quantity", "Quantity"],
  ],
  product_analytics: [
    ["poCount", "PO Count"], ["itemCode", "Item Code"], ["orderQuantity", "Order Qty"], ["passedQuantity", "Passed"], ["inspectionTimeDays", "Inspection Time (days)"], ["rejectionPercent", "Average Rejection (%)"], ["avgPackedTimeDays", "Avg Packed Time"], ["avgOfferTimeDays", "Avg Offer Time"], ["avgShippingTimeDays", "Avg Shipping Time"],
  ],
  product_complaints: [
    ["code", "Item Code"], ["description", "Description"], ["brand", "Brand"], ["tenure_summary", "Tenures / Claim %"], ["current_claim_percentage", "Current Claim %"], ["remark", "Remark"],
  ],
  shipping_delay: [
    ["po", "PO"], ["brand", "Brand"], ["stuffing_date", "Complete Stuffing Date"], ["final_packed_date", "Final Packed Date"], ["packed_difference_days", "Stuffing vs Final Packed (Days)"], ["packed_status", "Stuffing vs Final Packed Status"], ["effective_etd", "Effective ETD"], ["etd_difference_days", "Stuffing vs ETD (Days)"], ["etd_status", "Stuffing vs ETD Status"], ["item_count", "Items"], ["total_quantity", "Quantity"],
  ],
};

const exportVendorPerformanceReport = async (req, res) => {
  const section = normalizeText(req.query.section);
  if (!EXPORT_COLUMNS[section] || !normalizeText(req.query.vendor)) {
    return res.status(400).json({ message: "Vendor and a valid report table are required." });
  }
  try {
    const dataset = await buildVendorPerformanceDataset({
      vendor: req.query.vendor,
      brands: req.query.brands,
      fromDate: req.query.from_date ?? req.query.fromDate ?? req.query.from,
      toDate: req.query.to_date ?? req.query.toDate ?? req.query.to,
      user: req.user,
    });
    const rows = dataset.sections[section].rows.map((row) => ({
      ...row,
      tenure_summary: Array.isArray(row.tenures)
        ? row.tenures.map((tenure) => `${tenure.from_date} to ${tenure.to_date}: ${tenure.percentage}%`).join("; ")
        : "",
    }));
    const columns = EXPORT_COLUMNS[section];
    const data = rows.map((row) => columns.map(([key]) => row[key] ?? ""));
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "OMS";
    const worksheet = workbook.addWorksheet(section.replace(/_/g, " ").slice(0, 31), {
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    worksheet.columns = columns.map(([, header], index) => ({
      width: Math.min(50, Math.max(12, header.length + 2, ...data.map((row) => String(row[index] ?? "").length + 2))),
    }));
    let tableRow = 1;
    for (const spec of buildVendorPerformanceChartSpecs(section, rows, dataset.sections.po_delay.rows).filter((entry) => entry.data.length > 0)) {
      const imageHeight = spec.type === "monthly_po_delay" ? 500 : Math.max(260, 105 + spec.data.length * 38);
      const chartSvg = spec.type === "monthly_po_delay"
        ? renderMonthlyPoDelayChartSvg(spec)
        : renderHorizontalBarChartSvg(spec);
      const png = await sharp(Buffer.from(chartSvg)).png().toBuffer();
      const imageId = workbook.addImage({ buffer: png, extension: "png" });
      worksheet.addImage(imageId, { tl: { col: 0, row: tableRow - 1 }, ext: { width: spec.type === "monthly_po_delay" ? Math.max(900, 180 + spec.data.length * 42) : 900, height: imageHeight } });
      const imageRows = Math.ceil(imageHeight / 20) + 1;
      for (let row = tableRow; row < tableRow + imageRows; row += 1) worksheet.getRow(row).height = 20;
      tableRow += imageRows;
    }
    const headerRow = worksheet.getRow(tableRow);
    headerRow.values = columns.map(([, header]) => header);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D6EFD" } };
    headerRow.alignment = { horizontal: "center" };
    for (const row of data) worksheet.addRow(row);
    worksheet.autoFilter = {
      from: { row: tableRow, column: 1 },
      to: { row: tableRow, column: columns.length },
    };
    const fileName = `vendor-${section.replace(/_/g, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(await workbook.xlsx.writeBuffer());
  } catch (error) {
    if (error.message === "Invalid date filters") return res.status(400).json({ message: error.message });
    console.error("Vendor performance export error:", error);
    return res.status(500).json({ message: "Failed to export vendor performance report" });
  }
};

module.exports = {
  getVendorPerformanceReport,
  exportVendorPerformanceReport,
  __test__: { buildClaimRows, buildTenureClaimAverageRows, buildPoSections, buildVendorPerformanceSummaries, differenceInDays, resolveEtdDateRange, buildEffectiveEtdMatch, buildVendorPerformanceChartSpecs },
};
