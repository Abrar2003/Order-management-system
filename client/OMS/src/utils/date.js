const pad2 = (value) => String(value).padStart(2, "0");

const extractParts = (value) => {
  const asString = String(value ?? "").trim();
  if (!asString) return null;

  const ymdWithOptionalTime = asString.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/,
  );
  if (ymdWithOptionalTime) {
    const year = Number(ymdWithOptionalTime[1]);
    const month = Number(ymdWithOptionalTime[2]);
    const day = Number(ymdWithOptionalTime[3]);
    return { day, month, year };
  }

  const dmySlash = asString.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmySlash) {
    const day = Number(dmySlash[1]);
    const month = Number(dmySlash[2]);
    const year = Number(dmySlash[3]);
    return { day, month, year };
  }

  const dmyDash = asString.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyDash) {
    const day = Number(dmyDash[1]);
    const month = Number(dmyDash[2]);
    const year = Number(dmyDash[3]);
    return { day, month, year };
  }

  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    day: parsed.getDate(),
    month: parsed.getMonth() + 1,
    year: parsed.getFullYear(),
  };
};

export const formatDateDDMMYYYY = (value, fallback = "N/A") => {
  const parts = extractParts(value);
  if (!parts) return fallback;

  return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}`;
};

