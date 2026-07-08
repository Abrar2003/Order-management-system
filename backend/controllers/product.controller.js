const Order = require("../models/order.model");
const { applyDataAccessMatch } = require("../services/userDataAccess.service");
const { getVendorName } = require("../helpers/vendorRef");

const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeText = (value) => String(value ?? "").trim();

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toRoundedNumber = (value, decimals = 2) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(decimals));
};

const toUtcDateOnly = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  ));
};

const toIsoDateOnly = (value) => {
  const parsed = toUtcDateOnly(value);
  return parsed ? parsed.toISOString().slice(0, 10) : "";
};

const calculateShippingTimeDays = (orderDate, shippingDate) => {
  const orderDateUtc = toUtcDateOnly(orderDate);
  const shippingDateUtc = toUtcDateOnly(shippingDate);
  if (!orderDateUtc || !shippingDateUtc) return null;

  const diffDays = (shippingDateUtc.getTime() - orderDateUtc.getTime()) / DAY_MS;
  return diffDays >= 0 ? diffDays : null;
};

const getInspectionDateValue = (inspection = {}) =>
  inspection?.inspection_date || inspection?.createdAt || null;

const latestValidShipmentDate = (shipmentEntries = []) =>
  (Array.isArray(shipmentEntries) ? shipmentEntries : []).reduce((latest, entry) => {
    const parsed = toUtcDateOnly(entry?.stuffing_date);
    if (!parsed) return latest;
    if (!latest || parsed.getTime() > latest.getTime()) return parsed;
    return latest;
  }, null);

const sumShipmentQuantity = (shipmentEntries = []) =>
  (Array.isArray(shipmentEntries) ? shipmentEntries : []).reduce(
    (sum, entry) => sum + Math.max(0, toFiniteNumber(entry?.quantity, 0)),
    0,
  );

const averageNumbers = (values = [], decimals = 2) => {
  const validValues = (Array.isArray(values) ? values : []).filter((value) => {
    if (value === null || value === undefined || value === "") return false;
    return Number.isFinite(Number(value));
  });
  if (validValues.length === 0) return null;

  const total = validValues.reduce((sum, value) => sum + Number(value), 0);
  return toRoundedNumber(total / validValues.length, decimals);
};

const normalizeDistinctValues = (values = []) =>
  [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeText(value))
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));

const processOrderAnalyticsRow = (order = {}) => {
  const inspections = (Array.isArray(order.inspections) ? order.inspections : [])
    .filter((inspection) => getInspectionDateValue(inspection))
    .sort((left, right) =>
      new Date(getInspectionDateValue(left)) - new Date(getInspectionDateValue(right)),
    );
  const orderQuantity = Math.max(0, toFiniteNumber(order.quantity, 0));
  const passedQuantity = inspections.reduce(
    (sum, inspection) => sum + Math.max(0, toFiniteNumber(inspection?.passed, 0)),
    0,
  );
  const shippedQuantity = sumShipmentQuantity(order.shipment);
  const isFullyShipped = orderQuantity > 0 && shippedQuantity >= orderQuantity;
  const latestShipmentDate = isFullyShipped
    ? latestValidShipmentDate(order.shipment)
    : null;
  const shippingTimeDays = isFullyShipped
    ? calculateShippingTimeDays(order.order_date, latestShipmentDate)
    : null;

  let inspectionTimeDays = null;
  let rejectionPercent = null;

  if (inspections.length === 1) {
    const [inspection] = inspections;
    const inspectionDays = calculateShippingTimeDays(
      order.order_date,
      getInspectionDateValue(inspection),
    );
    inspectionTimeDays = inspectionDays === null
      ? null
      : toRoundedNumber(inspectionDays, 2);

    const passed = Math.max(0, toFiniteNumber(inspection?.passed, 0));
    if (orderQuantity > 0) {
      const rejected = Math.max(0, orderQuantity - passed);
      rejectionPercent = passed >= orderQuantity
        ? 0
        : toRoundedNumber((rejected / orderQuantity) * 100, 2);
    }
  } else if (inspections.length >= 2) {
    const first = new Date(getInspectionDateValue(inspections[0]));
    const last = new Date(getInspectionDateValue(inspections[inspections.length - 1]));
    const inspectionDays = (last - first) / DAY_MS;
    inspectionTimeDays = Number.isFinite(inspectionDays)
      ? toRoundedNumber(inspectionDays, 2)
      : null;

    let remaining = orderQuantity;
    const percentages = [];

    for (const inspection of inspections) {
      if (!remaining || remaining <= 0) break;

      const passed = Math.max(0, toFiniteNumber(inspection?.passed, 0));
      const rejected = Math.max(0, remaining - passed);
      const percent = (rejected / remaining) * 100;

      if (percent !== 0) percentages.push(percent);
      remaining = rejected;
    }

    rejectionPercent = averageNumbers(percentages, 2);
  }

  return {
    orderId: normalizeText(order.order_id),
    itemId: normalizeText(order.itemId),
    itemCode: normalizeText(order.itemCode),
    itemName: normalizeText(order.itemName),
    brand: normalizeText(order.brand),
    vendor: getVendorName(order.vendor) || normalizeText(order.vendor),
    orderDate: toIsoDateOnly(order.order_date),
    shippingDate: latestShipmentDate ? toIsoDateOnly(latestShipmentDate) : "",
    shippingTimeDays: shippingTimeDays === null ? null : toRoundedNumber(shippingTimeDays, 1),
    orderQuantity,
    passedQuantity,
    shippedQuantity: Math.min(orderQuantity || shippedQuantity, shippedQuantity),
    isFullyShipped,
    inspectionTimeDays,
    rejectionPercent,
  };
};

const groupProductAnalyticsRows = (orders = []) => {
  const groupedRows = new Map();

  (Array.isArray(orders) ? orders : []).forEach((order) => {
    const poRow = processOrderAnalyticsRow(order);
    const itemKey = poRow.itemId || poRow.itemCode;
    if (!itemKey) return;

    const existing = groupedRows.get(itemKey) || {
      id: itemKey,
      itemId: poRow.itemId,
      itemCode: poRow.itemCode,
      itemName: poRow.itemName,
      brandValues: new Set(),
      vendorValues: new Set(),
      poCount: 0,
      orderQuantity: 0,
      passedQuantity: 0,
      shippedQuantity: 0,
      orders: [],
    };

    existing.poCount += 1;
    existing.orderQuantity += poRow.orderQuantity;
    existing.passedQuantity += poRow.passedQuantity;
    existing.shippedQuantity += poRow.shippedQuantity;
    existing.orders.push(poRow);

    if (poRow.brand) existing.brandValues.add(poRow.brand);
    if (poRow.vendor) existing.vendorValues.add(poRow.vendor);
    if (!existing.itemName && poRow.itemName) existing.itemName = poRow.itemName;

    groupedRows.set(itemKey, existing);
  });

  return [...groupedRows.values()].map((group) => {
    const orders = [...group.orders].sort((left, right) =>
      String(left.orderId || "").localeCompare(String(right.orderId || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
    const shippingValues = orders
      .filter((order) => order.isFullyShipped)
      .map((order) => order.shippingTimeDays);

    return {
      id: group.id,
      itemId: group.itemId,
      itemCode: group.itemCode,
      itemName: group.itemName,
      brand: normalizeDistinctValues([...group.brandValues]).join(", "),
      vendor: normalizeDistinctValues([...group.vendorValues]).join(", "),
      poCount: group.poCount,
      orderQuantity: group.orderQuantity,
      passedQuantity: group.passedQuantity,
      shippedQuantity: group.shippedQuantity,
      inspectionTimeDays: averageNumbers(
        orders.map((order) => order.inspectionTimeDays),
        2,
      ),
      rejectionPercent: averageNumbers(
        orders.map((order) => order.rejectionPercent),
        2,
      ),
      avgShippingTimeDays: averageNumbers(shippingValues, 1),
      orders,
    };
  });
};

exports.getProductAnalytics = async (req, res) => {
  try {
    const { search = "", brand, vendor, page = 1, limit = 20 } = req.query;

    const normalizedPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const normalizedLimit = Math.max(1, Number.parseInt(limit, 10) || 20);
    const skip = (normalizedPage - 1) * normalizedLimit;

    // -------------------------------
    // MATCH STAGE (Filters)
    // -------------------------------
    const matchStage = {
      archived: { $ne: true },
    };

    if (search) {
      const escapedSearch = normalizeText(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      matchStage.$or = [
        { "item.item_code": { $regex: escapedSearch, $options: "i" } },
        { "item.description": { $regex: escapedSearch, $options: "i" } },
        { order_id: { $regex: escapedSearch, $options: "i" } },
      ];
    }

    if (brand && brand !== "all") matchStage.brand = brand;
    if (vendor && vendor !== "all") matchStage.vendor = vendor;

    const scopedMatchStage = applyDataAccessMatch(matchStage, req.user);
    const scopedOptionsMatch = applyDataAccessMatch({ archived: { $ne: true } }, req.user);

    // Fetch available filters for dropdowns
    const [brandOptions, vendorOptions] = await Promise.all([
      Order.distinct("brand", scopedOptionsMatch),
      Order.distinct("vendor", scopedOptionsMatch),
    ]);

    // -------------------------------
    // AGGREGATION PIPELINE
    // -------------------------------
    const pipeline = [
      { $match: scopedMatchStage },

      // JOIN QC
      {
        $lookup: {
          from: "qcs",
          localField: "qc_record",
          foreignField: "_id",
          as: "qc",
        },
      },
      { $unwind: { path: "$qc", preserveNullAndEmptyArrays: true } },

      // JOIN INSPECTIONS (NO UNWIND)
      {
        $lookup: {
          from: "inspections",
          localField: "qc._id",
          foreignField: "qc",
          as: "inspections",
        },
      },

      // KEEP ONLY REQUIRED FIELDS
      {
        $project: {
          order_id: 1,
          order_date: 1,
          brand: 1,
          vendor: 1,
          shipment: 1,
          itemId: "$item._id",
          itemCode: "$item.item_code",
          itemName: "$item.description",
          quantity: 1,
          inspections: {
            $map: {
              input: "$inspections",
              as: "insp",
              in: {
                passed: "$$insp.passed",
                inspection_date: "$$insp.inspection_date",
                createdAt: "$$insp.createdAt",
              },
            },
          },
        },
      },

      { $sort: { itemCode: 1, order_id: 1 } },
    ];

    const rawOrders = await Order.aggregate(pipeline);
    const groupedData = groupProductAnalyticsRows(rawOrders)
      .sort((left, right) => {
        const quantityDelta = Number(right.orderQuantity || 0) - Number(left.orderQuantity || 0);
        if (quantityDelta !== 0) return quantityDelta;
        return String(left.itemCode || "").localeCompare(String(right.itemCode || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
    const total = groupedData.length;
    const totalPages = Math.max(1, Math.ceil(total / normalizedLimit));
    const data = groupedData.slice(skip, skip + normalizedLimit);
    
    return res.json({
      success: true,
      data,
      pagination: {
        totalRecords: total,
        totalPages,
        page: normalizedPage,
        limit: normalizedLimit,
      },
      filters: {
        brands: brandOptions || [],
        vendors: vendorOptions || [],
      },
    });
  } catch (error) {
    console.error("Product Analytics Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch product analytics",
    });
  }
};

exports._private = {
  calculateShippingTimeDays,
  groupProductAnalyticsRows,
  processOrderAnalyticsRow,
};
