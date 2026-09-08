export const getProductDatabaseEmptyLabel = (status) =>
  String(status || "").trim().toLowerCase() === "created" ? "N/A" : "Not Set";
