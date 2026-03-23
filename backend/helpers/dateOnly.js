const APP_DATE_TIMEZONE = process.env.APP_DATE_TIMEZONE || "Asia/Kolkata";

const pad2 = (value) => String(value).padStart(2, "0");

const datePartsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_DATE_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const parseDateParts = (year, month, day) => {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(parsed.getTime())) return null;
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
};

const extractZonedParts = (value) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const parts = datePartsFormatter.formatToParts(parsed);
  const lookup = Object.create(null);
  for (const part of parts) {
    if (part?.type) {
      lookup[part.type] = part.value;
    }
  }

  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

  return { year, month, day };
};

const extractDateParts = (value) => {
  if (value instanceof Date) {
    return extractZonedParts(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return extractZonedParts(value);
  }

  const asString = String(value ?? "").trim();
  if (!asString) return null;

  const ymdExact = asString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdExact) {
    return {
      year: Number(ymdExact[1]),
      month: Number(ymdExact[2]),
      day: Number(ymdExact[3]),
    };
  }

  const ymdSlash = asString.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (ymdSlash) {
    return {
      year: Number(ymdSlash[1]),
      month: Number(ymdSlash[2]),
      day: Number(ymdSlash[3]),
    };
  }

  const dmySlash = asString.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmySlash) {
    return {
      year: Number(dmySlash[3]),
      month: Number(dmySlash[2]),
      day: Number(dmySlash[1]),
    };
  }

  const dmyDash = asString.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyDash) {
    return {
      year: Number(dmyDash[3]),
      month: Number(dmyDash[2]),
      day: Number(dmyDash[1]),
    };
  }

  const shouldTryNativeParse =
    /[a-zA-Z]/.test(asString) ||
    asString.includes(",") ||
    asString.includes("T") ||
    /\d{4}-\d{2}-\d{2}\s+\d/.test(asString);

  if (!shouldTryNativeParse) return null;

  return extractZonedParts(asString);
};

const parseDateOnly = (value) => {
  const parts = extractDateParts(value);
  if (!parts) return null;
  return parseDateParts(parts.year, parts.month, parts.day);
};

const parseDateTime = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const asString = String(value ?? "").trim();
  if (!asString) return null;

  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toDateOnlyIso = (value) => {
  const parts = extractDateParts(value);
  if (!parts) return "";
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
};

const formatDateOnlyDDMMYYYY = (value, fallback = "") => {
  const parts = extractDateParts(value);
  if (!parts) return fallback;
  return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`;
};

module.exports = {
  APP_DATE_TIMEZONE,
  extractDateParts,
  formatDateOnlyDDMMYYYY,
  parseDateOnly,
  parseDateTime,
  parseDateParts,
  toDateOnlyIso,
};
