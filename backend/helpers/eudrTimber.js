const crypto = require("node:crypto");

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const DOCUMENT_CATEGORIES = Object.freeze([
  "TIMBER_PURCHASE_INVOICE",
  "TRANSPORT_RECEIPT",
  "DELIVERY_CHALLAN",
  "EWAY_BILL",
  "TIMBER_ORIGIN_DOCUMENT",
  "OTHER_SUPPORTING_DOCUMENT",
]);
const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

const normalizeText = (value = "") => String(value ?? "").trim();

const normalizeKey = (value = "") =>
  normalizeText(value).toLowerCase().replace(/\s+/g, " ");

const normalizeGstin = (value = "") => {
  const normalized = normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized || null;
};

const isValidGstin = (value = "") => !value || GSTIN_PATTERN.test(normalizeGstin(value));

// Keep punctuation intact: invoice identifiers can legitimately differ by slash, dash, or dot.
const normalizeInvoiceNumber = (value = "") =>
  normalizeText(value).toUpperCase().replace(/\s+/g, "");

const normalizeFinancialYear = (value = "", invoiceDate = null) => {
  const supplied = normalizeText(value).replace(/\s/g, "");
  if (/^\d{4}-\d{2}$/.test(supplied)) return supplied;

  const date = invoiceDate ? new Date(invoiceDate) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
};

const parseCftToMilli = (value, { allowZero = false } = {}) => {
  const normalized = normalizeText(value);
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) {
    throw new Error("CFT must be a number with up to three decimal places");
  }

  const [wholePart, fractionPart = ""] = normalized.split(".");
  const result = Number(wholePart) * 1000 + Number(fractionPart.padEnd(3, "0"));
  if (!Number.isSafeInteger(result) || (!allowZero && result <= 0) || (allowZero && result < 0)) {
    throw new Error("CFT must be within the supported positive range");
  }
  return result;
};

const formatMilliCft = (value = 0) => {
  const numeric = Number(value || 0);
  if (!Number.isSafeInteger(numeric)) return "0";
  return (numeric / 1000).toFixed(3).replace(/\.?0+$/, "");
};

const totalDeliveryMilliCft = (entries = []) =>
  (Array.isArray(entries) ? entries : []).reduce(
    (total, entry) => total + Number(entry?.received_cft_milli || 0),
    0,
  );

const validateDeliveryQuantities = ({ purchasedMilliCft, deliveryEntries = [] } = {}) => {
  if (!Number.isSafeInteger(purchasedMilliCft) || purchasedMilliCft <= 0) {
    return "Purchased CFT must be greater than zero";
  }
  const total = totalDeliveryMilliCft(deliveryEntries);
  if (total > purchasedMilliCft) {
    return "Received CFT cannot exceed purchased CFT";
  }
  return "";
};

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const hasValidFileSignature = (buffer, mimeType = "") => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || !DOCUMENT_MIME_TYPES.has(mimeType)) {
    return false;
  }
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
};

const buildInvoiceIdentity = ({ supplierId = "", invoiceNumber = "", financialYear = "" } = {}) =>
  [String(supplierId || ""), normalizeInvoiceNumber(invoiceNumber), normalizeText(financialYear)].join("|");

const findNameSimilarity = (left = "", right = "") => {
  const a = normalizeKey(left).replace(/[^a-z0-9]/g, "");
  const b = normalizeKey(right).replace(/[^a-z0-9]/g, "");
  if (!a || !b) return 0;
  if (a === b) return 1;

  const previous = Array.from({ length: b.length + 1 }, (_entry, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const old = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
      diagonal = old;
    }
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
};

const isApprovalBlocked = (flags = []) =>
  (Array.isArray(flags) ? flags : []).some(
    (flag) => flag?.severity === "HARD" && flag?.state !== "RESOLVED",
  );

const isSameActor = (user, actor) =>
  String(user?._id || user?.id || user || "") === String(actor?.user || actor?._id || actor || "");

module.exports = {
  DOCUMENT_CATEGORIES,
  DOCUMENT_MIME_TYPES,
  buildInvoiceIdentity,
  findNameSimilarity,
  formatMilliCft,
  hasValidFileSignature,
  isApprovalBlocked,
  isSameActor,
  isValidGstin,
  normalizeFinancialYear,
  normalizeGstin,
  normalizeInvoiceNumber,
  normalizeKey,
  normalizeText,
  parseCftToMilli,
  sha256,
  totalDeliveryMilliCft,
  validateDeliveryQuantities,
};
