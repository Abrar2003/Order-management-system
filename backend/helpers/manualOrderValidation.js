const { normalizeVendorText } = require("./vendorRef");

const normalizeText = (value) => normalizeVendorText(value);

const getMissingManualOrderFields = ({
  orderId = "",
  itemCode = "",
  description = "",
  brand = "",
  vendor = "",
  quantity = null,
  orderDate = "",
  etd = "",
} = {}) => {
  const missingFields = [];

  if (!normalizeText(orderId)) missingFields.push("PO");
  if (!normalizeText(itemCode)) missingFields.push("Item Code");
  if (!normalizeText(description)) missingFields.push("Description");
  if (!normalizeText(brand)) missingFields.push("Brand");
  if (!normalizeText(vendor)) missingFields.push("Vendor");
  if (!normalizeText(orderDate)) missingFields.push("Order Date");
  if (!normalizeText(etd)) missingFields.push("ETD");

  const parsedQuantity = Number(quantity);
  if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
    missingFields.push("Quantity (> 0)");
  }

  return missingFields;
};

const buildManualOrderRows = (body = {}) => {
  if (!Array.isArray(body?.items)) {
    return Array.isArray(body?.orders) ? body.orders : [];
  }

  const po = body?.po && typeof body.po === "object" ? body.po : {};
  return body.items.map((item, index) => ({
    ...(item && typeof item === "object" ? item : {}),
    row_number: Number(item?.row_number) > 0 ? Number(item.row_number) : index + 1,
    order_id: po.order_id ?? po.orderId ?? po.PO,
    brand: po.brand,
    vendor: po.vendor,
    order_date: po.order_date ?? po.orderDate,
    ETD: po.ETD ?? po.etd,
  }));
};

const formatManualOrderValidationMessage = (entries = []) => {
  const safeEntries = Array.isArray(entries) ? entries : [];
  if (safeEntries.length === 0) return "";

  return [
    "Manual order submission was blocked. Complete the required fields:",
    ...safeEntries.map((entry) => {
      const rowNumber = Number(entry?.row_number || 0);
      const fields = Array.isArray(entry?.missing_fields)
        ? entry.missing_fields.filter(Boolean)
        : [];
      return `Row ${rowNumber || "?"}: ${fields.join(", ") || "Required fields"}`;
    }),
  ].join("\n");
};

module.exports = {
  buildManualOrderRows,
  formatManualOrderValidationMessage,
  getMissingManualOrderFields,
};
