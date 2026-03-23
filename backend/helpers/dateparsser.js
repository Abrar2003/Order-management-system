const { parseDateOnly, parseDateParts } = require("./dateOnly");

const dateParser = (value) => {
  if (!value) return null;

  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const excelDate = new Date(excelEpoch.getTime() + value * 86400000);
    return parseDateOnly(excelDate);
  }

  if (value instanceof Date) {
    return parseDateOnly(value);
  }

  if (typeof value === "string") {
    const cleaned = value.trim();
    const dmyMatch = cleaned.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
    if (dmyMatch) {
      return parseDateParts(
        Number(dmyMatch[3]),
        Number(dmyMatch[2]),
        Number(dmyMatch[1]),
      );
    }

    return parseDateOnly(cleaned);
  }

  return parseDateOnly(value);
};

module.exports = dateParser;
