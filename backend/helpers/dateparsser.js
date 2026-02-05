const dateParser = (value) => {
  if (!value) return null;

  // Case 1: Excel serial number
  if (typeof value === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + value * 86400000);
  }

  // Case 2: String date (DD/MM/YYYY or DD-MM-YYYY)
  if (typeof value === "string") {
    const cleaned = value.trim();

    // Match DD/MM/YYYY or DD-MM-YYYY
    const match = cleaned.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);

    if (!match) return null;

    const [, day, month, year] = match.map(Number);

    if (!day || !month || !year) return null;

    return new Date(year, month - 1, day);
  }

  return null;
};

module.exports = dateParser;
