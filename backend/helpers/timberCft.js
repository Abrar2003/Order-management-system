const normalizeIdentifier = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const parseTimberCft = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isSafeInteger(Math.round(parsed * 1000)) || Math.abs(Math.round(parsed * 1000) - parsed * 1000) > 1e-7) {
    const error = new Error("Timber_CFT must be a non-negative number with at most three decimals");
    error.statusCode = 400;
    throw error;
  }
  return parsed;
};

const safeMilli = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw Object.assign(new Error("Timber quantity exceeds safe milli-CFT arithmetic"), { statusCode: 400 });
  return value;
};
const toMilliCft = (value) => safeMilli(Math.round(Number(value) * 1000));
const shipmentMilliCft = (perUnit, quantity) => safeMilli(Math.round(toMilliCft(perUnit) * Number(quantity)));
const addMilliCft = (a,b) => safeMilli(a+b);

const financialYear = (dateValue) => {
  const value = String(dateValue || "");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    const error = new Error("A valid invoice date is required");
    error.statusCode = 400;
    throw error;
  }
  return date.getUTCFullYear() - (date.getUTCMonth() < 3 ? 1 : 0);
};

const invoiceKey = ({ issuer_gst, invoice_number, invoice_date }) => {
  const gst = normalizeIdentifier(issuer_gst);
  const number = normalizeIdentifier(invoice_number);
  if (!gst || !number) {
    const error = new Error("Invoice issuer GST and invoice number are required");
    error.statusCode = 400;
    throw error;
  }
  return `${gst}|${financialYear(invoice_date)}|${number}`;
};

module.exports = { normalizeIdentifier, parseTimberCft, toMilliCft, shipmentMilliCft, financialYear, invoiceKey, addMilliCft };
