const path = require("path");
const XLSX = require("xlsx");

const EXCEL_EXTENSIONS = new Set([".xls", ".xlsx"]);

const normalizeReportPath = (reportPath, fallbackFileName = "report.xlsx") => {
  const requestedPath = String(reportPath || "").trim() || fallbackFileName;
  const parsed = path.parse(requestedPath);
  const ext = parsed.ext.toLowerCase();
  const fallbackExt = EXCEL_EXTENSIONS.has(path.extname(fallbackFileName).toLowerCase())
    ? path.extname(fallbackFileName).toLowerCase()
    : ".xlsx";

  if (EXCEL_EXTENSIONS.has(ext)) {
    return path.resolve(process.cwd(), requestedPath);
  }

  if (!ext) {
    return path.resolve(process.cwd(), `${requestedPath}${fallbackExt}`);
  }

  return path.resolve(process.cwd(), path.join(parsed.dir, `${parsed.name}${fallbackExt}`));
};

const makeSheetName = (value, fallback = "Sheet") => {
  const cleaned = String(value || fallback)
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 31);
};

const normalizeCell = (value) => {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  if (typeof value?.toHexString === "function") return value.toHexString();
  if (Buffer.isBuffer(value)) return value.toString("base64");

  if (typeof value === "object") {
    try {
      return JSON.stringify(value, (_key, nestedValue) => {
        if (typeof nestedValue?.toHexString === "function") return nestedValue.toHexString();
        if (nestedValue instanceof Date) return nestedValue.toISOString();
        return nestedValue;
      });
    } catch (_error) {
      return String(value);
    }
  }

  return String(value);
};

const collectHeaders = (rows, preferredHeaders = []) => {
  const headers = [];
  for (const header of preferredHeaders) {
    if (header && !headers.includes(header)) headers.push(header);
  }
  for (const row of rows) {
    Object.keys(row || {}).forEach((header) => {
      if (!headers.includes(header)) headers.push(header);
    });
  }
  return headers.length > 0 ? headers : ["Message"];
};

const normalizeRows = (rows = [], preferredHeaders = [], emptyMessage = "No rows") => {
  const sourceRows = Array.isArray(rows) && rows.length > 0 ? rows : [{ Message: emptyMessage }];
  const headers = collectHeaders(sourceRows, preferredHeaders);
  return {
    headers,
    rows: sourceRows.map((row) =>
      headers.reduce((record, header) => {
        record[header] = normalizeCell(row?.[header]);
        return record;
      }, {}),
    ),
  };
};

const applyColumnWidths = (worksheet, rows, headers) => {
  worksheet["!cols"] = headers.map((header) => {
    const width = rows.reduce((maxWidth, row) => {
      const valueLength = String(row?.[header] || "").length;
      return Math.max(maxWidth, valueLength);
    }, String(header).length);
    return { wch: Math.min(Math.max(width + 2, 12), 80) };
  });
};

const appendSheet = (workbook, sheet) => {
  const { headers, rows } = normalizeRows(
    sheet?.rows,
    sheet?.headers,
    sheet?.emptyMessage,
  );
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  applyColumnWidths(worksheet, rows, headers);
  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    makeSheetName(sheet?.name, "Report"),
  );
};

const writeWorkbookReport = ({ reportPath, fallbackFileName, sheets = [] }) => {
  const resolvedPath = normalizeReportPath(reportPath, fallbackFileName);
  const workbook = XLSX.utils.book_new();

  const reportSheets = Array.isArray(sheets) && sheets.length > 0
    ? sheets
    : [{ name: "Report", rows: [{ Message: "No report rows" }] }];

  reportSheets.forEach((sheet) => appendSheet(workbook, sheet));

  const ext = path.extname(resolvedPath).toLowerCase();
  XLSX.writeFile(workbook, resolvedPath, {
    bookType: ext === ".xls" ? "xls" : "xlsx",
  });
  return resolvedPath;
};

module.exports = {
  normalizeReportPath,
  writeWorkbookReport,
};
