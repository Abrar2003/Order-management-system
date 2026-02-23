const pad2 = (value) => String(value).padStart(2, "0");

const isValidDateParts = ({ day, month, year }) => {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return false;
  }
  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day
  );
};

const extractParts = (value) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const parts = {
      day: value.getDate(),
      month: value.getMonth() + 1,
      year: value.getFullYear(),
    };
    return isValidDateParts(parts) ? parts : null;
  }

  if (typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    const parts = {
      day: parsed.getDate(),
      month: parsed.getMonth() + 1,
      year: parsed.getFullYear(),
    };
    return isValidDateParts(parts) ? parts : null;
  }

  const asString = String(value ?? "").trim();
  if (!asString) return null;

  const ymdOnly = asString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdOnly) {
    const year = Number(ymdOnly[1]);
    const month = Number(ymdOnly[2]);
    const day = Number(ymdOnly[3]);
    const parts = { day, month, year };
    return isValidDateParts(parts) ? parts : null;
  }

  const dmySlash = asString.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmySlash) {
    const day = Number(dmySlash[1]);
    const month = Number(dmySlash[2]);
    const year = Number(dmySlash[3]);
    const parts = { day, month, year };
    return isValidDateParts(parts) ? parts : null;
  }

  const dmyDash = asString.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyDash) {
    const day = Number(dmyDash[1]);
    const month = Number(dmyDash[2]);
    const year = Number(dmyDash[3]);
    const parts = { day, month, year };
    return isValidDateParts(parts) ? parts : null;
  }

  const ymdSlash = asString.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (ymdSlash) {
    const year = Number(ymdSlash[1]);
    const month = Number(ymdSlash[2]);
    const day = Number(ymdSlash[3]);
    const parts = { day, month, year };
    return isValidDateParts(parts) ? parts : null;
  }

  const shouldTryNativeParse =
    /[a-zA-Z]/.test(asString) || asString.includes(",") || asString.includes(" ");
  if (!shouldTryNativeParse) return null;

  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = {
    day: parsed.getDate(),
    month: parsed.getMonth() + 1,
    year: parsed.getFullYear(),
  };
  return isValidDateParts(parts) ? parts : null;
};

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

export const getTodayDDMMYYYY = () => {
  const today = new Date();
  const offsetMs = today.getTimezoneOffset() * 60000;
  const localIso = new Date(today.getTime() - offsetMs).toISOString().slice(0, 10);
  return toDDMMYYYYInputValue(localIso, "");
};
