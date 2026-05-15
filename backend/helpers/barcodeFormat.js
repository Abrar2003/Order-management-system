  const EAN13_BODY_LENGTH = 12;
const EAN13_LENGTH = 13;

const normalizeDigits = (value) => String(value ?? "").replace(/\D/g, "");

const calculateEan13CheckDigit = (body = "") => {
  const digits = normalizeDigits(body).slice(0, EAN13_BODY_LENGTH);
  if (digits.length !== EAN13_BODY_LENGTH) return "";

  const sum = digits.split("").reduce((total, digit, index) => {
    const value = Number(digit);
    return total + value * (index % 2 === 0 ? 1 : 3);
  }, 0);

  return String((10 - (sum % 10)) % 10);
};

const toEan13BarcodeValue = (value) => {
  const digits = normalizeDigits(value);
  if (!digits || digits.length > EAN13_LENGTH) return "";

  const body = digits.slice(0, EAN13_BODY_LENGTH).padStart(EAN13_BODY_LENGTH, "0");
  const checkDigit = calculateEan13CheckDigit(body);
  return checkDigit ? `${body}${checkDigit}` : "";
};

const formatEan13BarcodeDisplay = (value, fallback = "Not Set") => {
  const rawText = String(value ?? "").trim();
  if (!rawText || rawText === "0") return fallback;

  return toEan13BarcodeValue(rawText) || rawText;
};

module.exports = {
  formatEan13BarcodeDisplay,
  toEan13BarcodeValue,
};
