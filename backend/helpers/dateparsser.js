const dateParser = (value) => {
  if (!value) return null;

  // Case 1: Excel serial number
  if (typeof value === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + value * 86400000);
  }

  // Case 2: DD/MM/YYYY string
  if (typeof value === "string") {
    const [day, month, year] = value.split("/").map(Number);
    if (!day || !month || !year) return null;
    return new Date(year, month - 1, day);
  }

  return null;
};

module.exports = dateParser;
