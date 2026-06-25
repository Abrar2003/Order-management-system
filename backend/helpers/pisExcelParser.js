const fs = require("fs/promises");
const path = require("path");
const ExcelJS = require("exceljs");
const Item = require("../models/item.model");
const {
  BOX_ENTRY_TYPES,
  BOX_PACKAGING_MODES,
} = require("./boxMeasurement");

const ARTICLE_NUMBER_ALIASES = ["article number"];
const DIMENSION_SECTION_ALIASES = ["dimension in cm", "dimensions in cm"];
const MASTER_BARCODE_ALIASES = ["barcode master box", "master box barcode"];
const PCS_BARCODE_ALIASES = ["barcode pcs", "pcs barcode", "barcode pieces"];

const DIMENSION_HEADER_ALIASES = Object.freeze({
  L: ["length"],
  B: ["width"],
  depth: ["depth"],
  height: ["height"],
  thickness: ["thickness"],
  net_weight: ["netto weight kg", "net weight kg", "netto weight", "net weight"],
  gross_weight: ["gross weight kg", "gross weight"],
  quantity: ["quantities in box", "quantity in box", "pcs in box"],
});

const RECOGNIZED_ROW_LABELS = Object.freeze({
  item: ["item"],
  inner: ["inner carton", "inner box"],
  master: ["outer carton", "master carton", "master box", "outer box"],
});

class PisImportError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "PisImportError";
    this.statusCode = statusCode;
  }
}

const normalizeHeader = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const getCellFormattedText = (cell) => {
  if (!cell) return "";

  try {
    const formatted = String(cell.text ?? "").trim();
    if (formatted && formatted !== "[object Object]") return formatted;
  } catch {
    // Some malformed merged cells throw while resolving ExcelJS cell.text.
  }

  try {
    const value = cell.value;
    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
      if (value.result !== null && value.result !== undefined) {
        return String(value.result).trim();
      }
      if (typeof value.text === "string") return value.text.trim();
      if (Array.isArray(value.richText)) {
        return value.richText.map((part) => part?.text || "").join("").trim();
      }
      return "";
    }
    return String(value).trim();
  } catch {
    return "";
  }
};

const normalizedAliases = (aliases = []) =>
  new Set(aliases.map(normalizeHeader).filter(Boolean));

const findLabelCell = (sheet, aliases) => {
  const targets = normalizedAliases(aliases);
  let found = null;

  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (found) return;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (!found && targets.has(normalizeHeader(getCellFormattedText(cell)))) {
        found = cell;
      }
    });
  });

  return found;
};

const getNextNonEmptyCellOnRow = (
  sheet,
  rowNumber,
  startColumn,
  { skipNormalizedValues = [] } = {},
) => {
  const skipped = normalizedAliases(skipNormalizedValues);
  const maxColumn = Math.max(sheet.columnCount || 0, startColumn + 1);

  for (let column = startColumn; column <= maxColumn; column += 1) {
    const cell = sheet.getCell(rowNumber, column);
    const text = getCellFormattedText(cell);
    if (!text || skipped.has(normalizeHeader(text))) continue;
    return cell;
  }

  return null;
};

const getNextNonEmptyValueOnRow = (sheet, rowNumber, startColumn, options) =>
  getCellFormattedText(
    getNextNonEmptyCellOnRow(sheet, rowNumber, startColumn, options),
  );

const parseNumericValue = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;

  const match = normalized.replace(/\u00a0/g, " ").match(/[+-]?\d+(?:[.,]\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBarcodeValue = (cell) => getCellFormattedText(cell).trim();

const findWorksheet = (workbook) =>
  workbook.worksheets.find(
    (sheet) =>
      findLabelCell(sheet, ARTICLE_NUMBER_ALIASES) &&
      findLabelCell(sheet, DIMENSION_SECTION_ALIASES),
  ) || null;

const findHeaderColumns = (sheet, dimensionCell) => {
  const columns = {};
  const aliasEntries = Object.entries(DIMENSION_HEADER_ALIASES).map(
    ([key, aliases]) => [key, normalizedAliases(aliases)],
  );
  const finalHeaderRow = Math.min(sheet.rowCount, dimensionCell.row + 3);

  for (let rowNumber = dimensionCell.row; rowNumber <= finalHeaderRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.eachCell({ includeEmpty: false }, (cell) => {
      const normalized = normalizeHeader(getCellFormattedText(cell));
      for (const [key, aliases] of aliasEntries) {
        if (!columns[key] && aliases.has(normalized)) {
          columns[key] = cell.col;
        }
      }
    });
  }

  return columns;
};

const resolveRowType = (row) => {
  let resolved = "";
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (resolved) return;
    const normalized = normalizeHeader(getCellFormattedText(cell));
    for (const [type, aliases] of Object.entries(RECOGNIZED_ROW_LABELS)) {
      if (normalizedAliases(aliases).has(normalized)) {
        resolved = type;
        break;
      }
    }
  });
  return resolved;
};

const readNumericCell = (sheet, rowNumber, columnNumber) => {
  if (!columnNumber) return null;
  return parseNumericValue(getCellFormattedText(sheet.getCell(rowNumber, columnNumber)));
};

const parseDimensionRows = (sheet, dimensionCell) => {
  const columns = findHeaderColumns(sheet, dimensionCell);
  if (!columns.L || !columns.B || (!columns.depth && !columns.height && !columns.thickness)) {
    throw new PisImportError(422, "PIS dimensions section is missing required headers");
  }

  const itemSizes = [];
  const boxSizes = [];
  const malformedRows = [];
  const scanEndRow = Math.min(sheet.rowCount, dimensionCell.row + 30);

  for (let rowNumber = dimensionCell.row + 1; rowNumber <= scanEndRow; rowNumber += 1) {
    const rowType = resolveRowType(sheet.getRow(rowNumber));
    if (!rowType) continue;

    const L = readNumericCell(sheet, rowNumber, columns.L);
    const B = readNumericCell(sheet, rowNumber, columns.B);
    const H = [
      readNumericCell(sheet, rowNumber, columns.depth),
      readNumericCell(sheet, rowNumber, columns.height),
      readNumericCell(sheet, rowNumber, columns.thickness),
    ].find((value) => value > 0) ?? null;

    if (!(L > 0 && B > 0 && H > 0)) {
      malformedRows.push(rowNumber);
      continue;
    }

    const entry = {
      L,
      B,
      H,
      net_weight: Math.max(
        0,
        readNumericCell(sheet, rowNumber, columns.net_weight) ?? 0,
      ),
      gross_weight: Math.max(
        0,
        readNumericCell(sheet, rowNumber, columns.gross_weight) ?? 0,
      ),
    };

    if (rowType === "item") {
      itemSizes.push({ ...entry, remark: "Item" });
      continue;
    }

    const quantity = Math.max(
      0,
      readNumericCell(sheet, rowNumber, columns.quantity) ?? 0,
    );
    const isInner = rowType === "inner";
    boxSizes.push({
      ...entry,
      remark: isInner ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER,
      box_type: isInner ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER,
      item_count_in_inner: isInner ? quantity : 0,
      box_count_in_master: isInner ? 0 : quantity,
    });
  }

  if (malformedRows.length > 0) {
    throw new PisImportError(
      422,
      `Malformed PIS dimension data in row${malformedRows.length > 1 ? "s" : ""} ${malformedRows.join(", ")}`,
    );
  }
  if (itemSizes.length === 0 && boxSizes.length === 0) {
    throw new PisImportError(422, "PIS dimensions section contains no valid item or carton rows");
  }
  if (itemSizes.length > Item.SIZE_ENTRY_LIMIT || boxSizes.length > Item.SIZE_ENTRY_LIMIT) {
    throw new PisImportError(
      422,
      `PIS dimensions cannot exceed ${Item.SIZE_ENTRY_LIMIT} entries per section`,
    );
  }

  const hasInnerBox = boxSizes.some(
    (entry) => entry?.box_type === BOX_ENTRY_TYPES.INNER,
  );
  const hasMasterBox = boxSizes.some(
    (entry) => entry?.box_type === BOX_ENTRY_TYPES.MASTER,
  );

  return {
    itemSizes,
    boxSizes,
    boxMode:
      hasInnerBox
        ? BOX_PACKAGING_MODES.CARTON
        : hasMasterBox
          ? BOX_PACKAGING_MODES.INDIVIDUAL_MASTER
          : null,
  };
};

const getValueBesideLabel = (sheet, labelCell, aliases) => {
  if (!labelCell) return "";
  return getNextNonEmptyValueOnRow(sheet, labelCell.row, labelCell.col + 1, {
    skipNormalizedValues: aliases,
  });
};

const parsePisWorkbook = (workbook) => {
  const sheet = findWorksheet(workbook);
  if (!sheet) {
    throw new PisImportError(
      422,
      "No worksheet contains both article number and Dimension in cm",
    );
  }

  const articleCell = findLabelCell(sheet, ARTICLE_NUMBER_ALIASES);
  const dimensionCell = findLabelCell(sheet, DIMENSION_SECTION_ALIASES);
  const articleNumber = String(
    getValueBesideLabel(sheet, articleCell, ARTICLE_NUMBER_ALIASES) ?? "",
  ).trim();
  if (!articleNumber) {
    throw new PisImportError(422, "PIS article number is missing");
  }

  const masterBarcodeCell = findLabelCell(sheet, MASTER_BARCODE_ALIASES);
  const pcsBarcodeCell = findLabelCell(sheet, PCS_BARCODE_ALIASES);
  const masterValueCell = masterBarcodeCell
    ? getNextNonEmptyCellOnRow(sheet, masterBarcodeCell.row, masterBarcodeCell.col + 1, {
        skipNormalizedValues: MASTER_BARCODE_ALIASES,
      })
    : null;
  const pcsValueCell = pcsBarcodeCell
    ? getNextNonEmptyCellOnRow(sheet, pcsBarcodeCell.row, pcsBarcodeCell.col + 1, {
        skipNormalizedValues: PCS_BARCODE_ALIASES,
      })
    : null;
  const dimensions = parseDimensionRows(sheet, dimensionCell);
  const masterBarcode = parseBarcodeValue(masterValueCell);
  const pcsBarcode = parseBarcodeValue(pcsValueCell);

  if (
    !masterBarcode &&
    !pcsBarcode &&
    dimensions.itemSizes.length === 0 &&
    dimensions.boxSizes.length === 0
  ) {
    throw new PisImportError(422, "The workbook contains no valid PIS data");
  }

  return {
    articleNumber,
    sheetName: sheet.name,
    masterBarcode,
    pcsBarcode,
    ...dimensions,
  };
};

const loadPisWorkbook = async (file = {}) => {
  const extension = path.extname(String(file.originalname || file.path || "")).toLowerCase();
  if (extension !== ".xlsx") {
    throw new PisImportError(400, "Only .xlsx files are supported for PIS uploads");
  }

  const workbook = new ExcelJS.Workbook();
  try {
    if (file.buffer) {
      await workbook.xlsx.load(file.buffer);
    } else if (file.path) {
      await fs.access(file.path);
      await workbook.xlsx.readFile(file.path);
    } else {
      throw new PisImportError(400, "Uploaded PIS file is unavailable");
    }
  } catch (error) {
    if (error instanceof PisImportError) throw error;
    throw new PisImportError(400, "Unable to read the uploaded PIS workbook");
  }

  return workbook;
};

const parsePisUpload = async (file) => parsePisWorkbook(await loadPisWorkbook(file));

module.exports = {
  PisImportError,
  findLabelCell,
  getCellFormattedText,
  getNextNonEmptyValueOnRow,
  loadPisWorkbook,
  normalizeHeader,
  parseBarcodeValue,
  parseNumericValue,
  parsePisUpload,
  parsePisWorkbook,
};
