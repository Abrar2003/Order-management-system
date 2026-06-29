export const isSampleShipmentRow = (row = {}) =>
  String(row?.line_type || "").trim().toLowerCase() === "sample"
  || String(row?.order_id || "").trim().toLowerCase() === "sample";

export const getShipmentPoDisplay = (row = {}) =>
  isSampleShipmentRow(row) ? "Sample" : row?.order_id || "N/A";

export const getShipmentItemDisplay = (row = {}) =>
  row?.item_code || row?.sample_code || "N/A";

export const getShipmentPrimaryQuantityDisplay = (row = {}) =>
  isSampleShipmentRow(row)
    ? row?.quantity ?? "N/A"
    : row?.order_quantity ?? "N/A";

export const getShipmentEntityKey = (row = {}) =>
  `${String(row?.line_type || "order").trim().toLowerCase()}:${String(row?._id || "").trim()}`;

const normalizeIdLike = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    return String(value?._id || value?.id || value?.$oid || "").trim();
  }
  return String(value).trim();
};

export const normalizeShipmentCheckedDraft = (checked = {}) => {
  const isChecked = Boolean(checked?.checked);
  return {
    checked: isChecked,
    checked_by: isChecked
      ? normalizeIdLike(checked?.checked_by ?? checked?.checkedBy)
      : "",
  };
};
