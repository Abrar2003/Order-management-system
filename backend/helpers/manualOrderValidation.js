const { normalizeVendorText } = require("./vendorRef");

const normalizeText = (value) => normalizeVendorText(value);

const getMissingManualOrderFields = ({
  orderId = "",
  itemCode = "",
  description = "",
  brand = "",
  vendor = "",
  quantity = null,
} = {}) => {
  const missingFields = [];

  if (!normalizeText(orderId)) missingFields.push("PO");
  if (!normalizeText(itemCode)) missingFields.push("Item Code");
  if (!normalizeText(description)) missingFields.push("Description");
  if (!normalizeText(brand)) missingFields.push("Brand");
  if (!normalizeText(vendor)) missingFields.push("Vendor");

  const parsedQuantity = Number(quantity);
  if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
    missingFields.push("Quantity (> 0)");
  }

  return missingFields;
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
  formatManualOrderValidationMessage,
  getMissingManualOrderFields,
};
