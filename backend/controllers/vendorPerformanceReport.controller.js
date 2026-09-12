const XLSX = require("xlsx");
const Order = require("../models/order.model");
const Item = require("../models/item.model");
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

const DAY_MS = 24 * 60 * 60 * 1000;
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
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  ));
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

  const serialize = (group, actualDate, actualKey, { inspectionPending = false } = {}) => {
    const days = differenceInDays(actualDate, group.etd);
    const isOverdueInspectionPending = inspectionPending && group.etd < today;
    return {
      po: group.po,
      brand: group.brand,
      vendor: group.vendor,
      etd: toIsoDate(group.etd),
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

  return {
    po_delay: [...groups.values()]
      .filter((group) => group.etd && (
        (group.all_packed && group.packed_date)
        || !group.all_packed
      ))
      .map((group) => group.all_packed
        ? serialize(group, group.packed_date, "packed_date")
        : serialize(group, today, "packed_date", { inspectionPending: true }))
      .sort(compareRows),
    shipping_delay: [...groups.values()]
      .filter((group) => group.all_shipped && group.shipping_date && group.etd)
      .map((group) => serialize(group, group.shipping_date, "shipping_date"))
      .sort(compareRows),
  };
};

const claimPercentage = (tenure) => tenure?.delivered_quantity > 0
  ? Number(((tenure.rejected_quantity / tenure.delivered_quantity) * 100).toFixed(2))
  : 0;

const buildClaimRows = (items = []) => {
  const rows = items.filter(isCurrentClaimSystemItem).map(buildClaimsReportRow);
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

const buildVendorPerformanceDataset = async ({ vendor = "", brands, user } = {}) => {
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
    $and: [buildVendorFilter({ field: "vendor", vendorName: selectedVendor }), buildBrandMatch(selectedBrands)],
  });
  const orderRows = await Order.find(orderMatch)
    .select("order_id order_date brand vendor status ETD revised_ETD quantity item shipment qc_record")
    .populate("qc_record", "last_inspected_date quantities")
    .lean();
  const productAnalyticsOrderRows = await Order.find(applyDataAccessMatch(
    { $and: [{ archived: { $ne: true } }, buildVendorFilter({ field: "vendor", vendorName: selectedVendor }), buildBrandMatch(selectedBrands)] },
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
    ] },
    user,
    { brandFields: ["brand", "brand_name", "brands"], vendorFields: ["vendors"] },
  );
  const claimItems = await Item.find(itemMatch)
    .select("code name description brand brand_name brands vendors claim_tenures claim_percentage")
    .lean();
  const poSections = buildPoSections(orderRows);

  return {
    filters: { vendor_options: vendorOptions, brand_options: brandOptions, brands: selectedBrands },
    vendor: selectedVendor,
    sections: {
      po_delay: { rows: poSections.po_delay },
      product_analytics: { rows: productRows },
      product_complaints: { rows: buildClaimRows(claimItems) },
      shipping_delay: { rows: poSections.shipping_delay },
    },
  };
};

const getVendorPerformanceReport = async (req, res) => {
  try {
    return res.json(await buildVendorPerformanceDataset({ vendor: req.query.vendor, brands: req.query.brands, user: req.user }));
  } catch (error) {
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
    ["po", "PO"], ["brand", "Brand"], ["shipping_date", "Complete Shipping Date"], ["etd", "Effective ETD"], ["difference_days", "Difference (Days)"], ["status", "Status"], ["item_count", "Items"], ["total_quantity", "Quantity"],
  ],
};

const exportVendorPerformanceReport = async (req, res) => {
  const section = normalizeText(req.query.section);
  if (!EXPORT_COLUMNS[section] || !normalizeText(req.query.vendor)) {
    return res.status(400).json({ message: "Vendor and a valid report table are required." });
  }
  try {
    const dataset = await buildVendorPerformanceDataset({ vendor: req.query.vendor, brands: req.query.brands, user: req.user });
    const rows = dataset.sections[section].rows.map((row) => ({
      ...row,
      tenure_summary: Array.isArray(row.tenures)
        ? row.tenures.map((tenure) => `${tenure.from_date} to ${tenure.to_date}: ${tenure.percentage}%`).join("; ")
        : "",
    }));
    const columns = EXPORT_COLUMNS[section];
    const data = [columns.map(([, header]) => header), ...rows.map((row) => columns.map(([key]) => row[key] ?? ""))];
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet["!cols"] = columns.map(([key, header], index) => ({
      wch: Math.min(50, Math.max(12, header.length + 2, ...data.slice(1).map((row) => String(row[index] ?? "").length + 2))),
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, section.replace(/_/g, " ").slice(0, 31));
    const fileName = `vendor-${section.replace(/_/g, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  } catch (error) {
    console.error("Vendor performance export error:", error);
    return res.status(500).json({ message: "Failed to export vendor performance report" });
  }
};

module.exports = {
  getVendorPerformanceReport,
  exportVendorPerformanceReport,
  __test__: { buildClaimRows, buildPoSections, differenceInDays },
};
