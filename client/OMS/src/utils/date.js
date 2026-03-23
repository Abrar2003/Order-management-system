export const APP_DATE_TIMEZONE = "Asia/Kolkata";

const pad2 = (value) => String(value).padStart(2, "0");

const isValidDateParts = ({ day, month, year }) => {
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(year)
  ) {
    return false;
  }

  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
};

const datePartsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_DATE_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

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

  const normalized = {
    day: Number(lookup.day),
    month: Number(lookup.month),
    year: Number(lookup.year),
  };
  return isValidDateParts(normalized) ? normalized : null;
};

const extractParts = (value) => {
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
    const parts = {
      day: Number(ymdExact[3]),
      month: Number(ymdExact[2]),
      year: Number(ymdExact[1]),
    };
    return isValidDateParts(parts) ? parts : null;
  }

  const ymdSlash = asString.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (ymdSlash) {
    const parts = {
      day: Number(ymdSlash[3]),
      month: Number(ymdSlash[2]),
      year: Number(ymdSlash[1]),
    };
    return isValidDateParts(parts) ? parts : null;
  }

  const dmySlash = asString.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmySlash) {
    const parts = {
      day: Number(dmySlash[1]),
      month: Number(dmySlash[2]),
      year: Number(dmySlash[3]),
    };
    return isValidDateParts(parts) ? parts : null;
  }

  const dmyDash = asString.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyDash) {
    const parts = {
      day: Number(dmyDash[1]),
      month: Number(dmyDash[2]),
      year: Number(dmyDash[3]),
    };
    return isValidDateParts(parts) ? parts : null;
  }

  const shouldTryNativeParse =
    /[a-zA-Z]/.test(asString) ||
    asString.includes(",") ||
    asString.includes("T") ||
    /\d{4}-\d{2}-\d{2}\s+\d/.test(asString);
  if (!shouldTryNativeParse) return null;

  return extractZonedParts(asString);
};

export const extractDateParts = (value) => extractParts(value);

export const formatDateDDMMYYYY = (value, fallback = "N/A") => {
  const parts = extractParts(value);
  if (!parts) return fallback;

  return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`;
};

export const toISODateString = (value) => {
  const parts = extractParts(value);
  if (!parts) return "";
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
};

export const toDDMMYYYYInputValue = (value, fallback = "") => {
  const parts = extractParts(value);
  if (!parts) return fallback;
  return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`;
};

export const isValidDDMMYYYY = (value) =>
  Boolean(String(value ?? "").trim().match(/^\d{2}\/\d{2}\/\d{4}$/))
  && Boolean(extractParts(value));

export const getTodayISODate = () => toISODateString(new Date());

export const getTodayDDMMYYYY = () => formatDateDDMMYYYY(new Date(), "");
