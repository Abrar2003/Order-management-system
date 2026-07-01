const fs = require("fs/promises");
const path = require("path");
const ExcelJS = require("exceljs");
const { loadEnvFiles } = require("../config/loadEnv");

const DEFAULT_BRAND = "isaa";
const DEFAULT_API_BASE_URL = "https://api.ghouse-sourcing.com";
const DEFAULT_REPORT_SHEET_NAME = "Summary";
const HEADER_SCAN_ROW_LIMIT = 50;
const API_PAGE_LIMIT = 200;

const ITEM_CODE_ALIASES = [
  "item number",
  "item no",
  "item code",
  "item",
  "article number",
  "article no",
  "article code",
  "sku",
  "code",
];

const SOURCE_COLUMN_ALIASES = Object.freeze({
  description: ["description", "item description", "article name", "name"],
});

const SIMPLE_REPORT_COLUMNS = [
  { key: "itemCode", header: "Item Code", width: 16 },
  { key: "name", header: "Name", width: 40 },
  { key: "sourceRows", header: "Source Rows", width: 16 },
  { key: "sourceCodes", header: "Source Codes", width: 22 },
];

const SUMMARY_COLUMNS = [
  { key: "metric", header: "Metric", width: 30 },
  { key: "value", header: "Value", width: 28 },
];

const LEGACY_REPORT_SHEET_NAME = "By Boo DB Check";
const MATCHES_DB_SHEET_NAME = "Matches DB";
const DB_NOT_IN_SHEET_SHEET_NAME = "In DB Not In Sheet";
const SHEET_NOT_IN_DB_SHEET_NAME = "In Sheet Not In DB";

const usage = () => `
Usage:
  node scripts/createByBooDbComparisonSheet.js <workbook.xlsx> [options]

Options:
  --api-base-url=<url>   Backend base URL. Defaults to https://api.ghouse-sourcing.com.
  --token=<jwt>          Existing backend JWT. Otherwise use username/password.
  --username=<value>     Backend username for /auth/signin.
  --password=<value>     Backend password for /auth/signin.
  --brand=<name>         Brand to compare from the DB. Defaults to "by boo".
  --sheet=<name>         Source worksheet name. Defaults to the first non-report sheet.
  --output=<path>        Output workbook path. Defaults to "<input> - DB Check.xlsx".
  --in-place             Add/replace the report sheet in the input workbook.
  --report-sheet=<name>  Summary sheet name. Defaults to "Summary".
  --help                 Show this help text.
`;

const parseArgs = (argv = process.argv.slice(2)) => {
  const options = {
    apiBaseUrl:
      process.env.BY_BOO_COMPARE_API_BASE_URL ||
      process.env.COLLECTION_COMPARE_API_BASE_URL ||
      process.env.OMS_API_BASE_URL ||
      DEFAULT_API_BASE_URL,
    brand: DEFAULT_BRAND,
    input: "",
    inPlace: false,
    output: "",
    password:
      process.env.BY_BOO_COMPARE_PASSWORD ||
      process.env.COLLECTION_COMPARE_PASSWORD ||
      process.env.OMS_API_PASSWORD ||
      "",
    reportSheet: DEFAULT_REPORT_SHEET_NAME,
    sourceSheet: "",
    token:
      process.env.BY_BOO_COMPARE_TOKEN ||
      process.env.COLLECTION_COMPARE_TOKEN ||
      process.env.OMS_API_TOKEN ||
      "",
    username:
      process.env.BY_BOO_COMPARE_USERNAME ||
      process.env.COLLECTION_COMPARE_USERNAME ||
      process.env.OMS_API_USERNAME ||
      "",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "").trim();
    if (!arg) continue;

    const nextValue = argv[index + 1];
    const consumeNext = () => {
      index += 1;
      return String(nextValue || "").trim();
    };

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--in-place") {
      options.inPlace = true;
      continue;
    }
    if (arg === "--api-base-url" && nextValue) {
      options.apiBaseUrl = consumeNext();
      continue;
    }
    if (arg.startsWith("--api-base-url=")) {
      options.apiBaseUrl = arg.slice("--api-base-url=".length).trim();
      continue;
    }
    if (arg === "--token" && nextValue) {
      options.token = consumeNext();
      continue;
    }
    if (arg.startsWith("--token=")) {
      options.token = arg.slice("--token=".length).trim();
      continue;
    }
    if (arg === "--username" && nextValue) {
      options.username = consumeNext();
      continue;
    }
    if (arg.startsWith("--username=")) {
      options.username = arg.slice("--username=".length).trim();
      continue;
    }
    if (arg === "--password" && nextValue) {
      options.password = consumeNext();
      continue;
    }
    if (arg.startsWith("--password=")) {
      options.password = arg.slice("--password=".length).trim();
      continue;
    }
    if (arg === "--brand" && nextValue) {
      options.brand = consumeNext() || DEFAULT_BRAND;
      continue;
    }
    if (arg.startsWith("--brand=")) {
      options.brand = arg.slice("--brand=".length).trim() || DEFAULT_BRAND;
      continue;
    }
    if (arg === "--sheet" && nextValue) {
      options.sourceSheet = consumeNext();
      continue;
    }
    if (arg.startsWith("--sheet=")) {
      options.sourceSheet = arg.slice("--sheet=".length).trim();
      continue;
    }
    if (arg === "--output" && nextValue) {
      options.output = consumeNext();
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length).trim();
      continue;
    }
    if (arg === "--report-sheet" && nextValue) {
      options.reportSheet = consumeNext() || DEFAULT_REPORT_SHEET_NAME;
      continue;
    }
    if (arg.startsWith("--report-sheet=")) {
      options.reportSheet =
        arg.slice("--report-sheet=".length).trim() || DEFAULT_REPORT_SHEET_NAME;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (!options.input) {
      options.input = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (options.output && options.inPlace) {
    throw new Error("Use either --output or --in-place, not both.");
  }

  return options;
};

const normalizeText = (value) => String(value ?? "").trim();

const resolveApiBaseUrl = (value = "") => {
  const normalized = normalizeText(value) || DEFAULT_API_BASE_URL;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)
    ? normalized
    : `https://${normalized}`;
  return withProtocol.replace(/\/+$/g, "");
};

const readJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const splitSetCookieHeader = (header = "") => {
  const normalized = normalizeText(header);
  if (!normalized) return [];
  return normalized
    .split(/,(?=\s*[^;,]+=)/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const getSetCookieHeaders = (headers) => {
  if (!headers) return [];
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  return splitSetCookieHeader(headers.get?.("set-cookie"));
};

const buildCookieHeader = (headers) =>
  getSetCookieHeaders(headers)
    .map((entry) => entry.split(";")[0])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join("; ");

const apiRequest = async (
  url,
  { method = "GET", headers = {}, body, includeResponse = false } = {},
) => {
  let response = null;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
    });
  } catch (error) {
    const detail = normalizeText(error?.cause?.message || error?.message);
    throw new Error(
      `${method} ${url} failed before response${detail ? `: ${detail}` : ""}`,
    );
  }

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const message =
      normalizeText(payload?.message) ||
      normalizeText(payload?.error) ||
      `${method} ${url} failed with status ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return includeResponse ? { payload, response } : payload;
};

const signIn = async ({ apiBaseUrl, username, password }) => {
  const { payload, response } = await apiRequest(`${apiBaseUrl}/auth/signin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
    includeResponse: true,
  });

  const token = normalizeText(
    payload?.token ||
      payload?.accessToken ||
      payload?.access_token ||
      payload?.data?.token ||
      payload?.data?.accessToken ||
      payload?.data?.access_token,
  );
  if (token) {
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  const cookieHeader = buildCookieHeader(response.headers);
  if (cookieHeader) {
    return {
      Cookie: cookieHeader,
    };
  }

  throw new Error("Auth signin did not return a token or auth cookies");
};

const resolveAuthHeaders = async (options = {}) => {
  const directToken = normalizeText(options.token);
  if (directToken) {
    return {
      Authorization: `Bearer ${directToken}`,
    };
  }

  const username = normalizeText(options.username);
  const password = normalizeText(options.password);
  if (!username || !password) {
    throw new Error(
      "Provide either --token or both --username and --password for backend authentication",
    );
  }

  return signIn({
    apiBaseUrl: options.apiBaseUrl,
    username,
    password,
  });
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeHeader = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizeAliasSet = (aliases = []) =>
  new Set(aliases.map(normalizeHeader).filter(Boolean));

const getCellText = (cell) => {
  if (!cell) return "";

  const value = cell.value;
  if (value === null || value === undefined) return "";

  try {
    const text = String(cell.text ?? "").trim();
    if (text && text !== "[object Object]") return text;
  } catch {
    // Fall through to raw value handling for malformed or unusual cells.
  }

  if (typeof value === "object") {
    if (value.result !== null && value.result !== undefined) {
      return String(value.result).trim();
    }
    if (typeof value.text === "string") return value.text.trim();
    if (Array.isArray(value.richText)) {
      return value.richText
        .map((part) => part?.text || "")
        .join("")
        .trim();
    }
    if (value.hyperlink && value.text) return String(value.text).trim();
    return "";
  }

  return String(value).trim();
};

const formatItemCode = (value) => {
  let text = String(value ?? "")
    .replace(/\u00a0/g, " ")
    .trim();
  if (!text) return "";

  text = text.replace(/^'+|'+$/g, "").trim();

  if (/^\d+\.0+$/.test(text)) {
    return text.replace(/\.0+$/, "");
  }
  if (/^\d{1,3}(,\d{3})+(\.0+)?$/.test(text)) {
    return text.replace(/,/g, "").replace(/\.0+$/, "");
  }

  return text;
};

const normalizeItemCodeKey = (value) => formatItemCode(value).toLowerCase();

const normalizeBrandKey = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const getBrandValues = (item = {}) => [
  item.brand,
  item.brand_name,
  ...(Array.isArray(item.brands) ? item.brands : []),
];

const itemMatchesBrand = (item = {}, brand = DEFAULT_BRAND) => {
  const target = normalizeBrandKey(brand);
  if (!target) return false;
  return getBrandValues(item).some(
    (value) => normalizeBrandKey(value) === target,
  );
};

const makeSafeSheetName = (name) => {
  const safe = String(name || DEFAULT_REPORT_SHEET_NAME)
    .replace(/[:\\/?*\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (safe || DEFAULT_REPORT_SHEET_NAME).slice(0, 31);
};

const findHeaderCell = (worksheet, aliases = ITEM_CODE_ALIASES) => {
  const targets = normalizeAliasSet(aliases);
  const lastRow = Math.min(worksheet.rowCount, HEADER_SCAN_ROW_LIMIT);

  for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    for (
      let columnNumber = 1;
      columnNumber <= worksheet.columnCount;
      columnNumber += 1
    ) {
      const text = getCellText(row.getCell(columnNumber));
      if (targets.has(normalizeHeader(text))) {
        return {
          rowNumber,
          columnNumber,
          header: text,
        };
      }
    }
  }

  return null;
};

const findColumnByAliases = (headersByColumn, aliases = []) => {
  const targets = normalizeAliasSet(aliases);
  for (const [columnNumber, header] of headersByColumn.entries()) {
    if (targets.has(normalizeHeader(header))) return columnNumber;
  }
  return 0;
};

const getValueFromColumn = (row, columnNumber) =>
  columnNumber > 0 ? getCellText(row.getCell(columnNumber)) : "";

const readSourceRows = (worksheet) => {
  const itemCodeHeader = findHeaderCell(worksheet);
  if (!itemCodeHeader) {
    throw new Error(
      `Could not find an item-code header. Tried: ${ITEM_CODE_ALIASES.join(", ")}`,
    );
  }

  const headerRow = worksheet.getRow(itemCodeHeader.rowNumber);
  const headersByColumn = new Map();
  for (
    let columnNumber = 1;
    columnNumber <= worksheet.columnCount;
    columnNumber += 1
  ) {
    const header = getCellText(headerRow.getCell(columnNumber));
    if (header) headersByColumn.set(columnNumber, header);
  }

  const sourceColumns = {
    description: findColumnByAliases(
      headersByColumn,
      SOURCE_COLUMN_ALIASES.description,
    ),
  };

  const rows = [];
  const duplicateRowsByCode = new Map();
  const firstSeenRowByCode = new Map();

  for (
    let rowNumber = itemCodeHeader.rowNumber + 1;
    rowNumber <= worksheet.rowCount;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber);
    const itemCode = formatItemCode(
      row.getCell(itemCodeHeader.columnNumber).value,
    );
    const itemCodeKey = normalizeItemCodeKey(itemCode);
    if (!itemCodeKey) continue;

    if (firstSeenRowByCode.has(itemCodeKey)) {
      const entries = duplicateRowsByCode.get(itemCodeKey) || [
        firstSeenRowByCode.get(itemCodeKey),
      ];
      entries.push(rowNumber);
      duplicateRowsByCode.set(itemCodeKey, entries);
    } else {
      firstSeenRowByCode.set(itemCodeKey, rowNumber);
    }

    rows.push({
      itemCode,
      itemCodeKey,
      sourceRow: rowNumber,
      sourceDescription: getValueFromColumn(row, sourceColumns.description),
    });
  }

  return {
    rows,
    itemCodeHeader,
    duplicateRowsByCode,
  };
};

const uniqueRowsByCode = (sourceRows = []) => {
  const lookup = new Map();
  for (const row of sourceRows) {
    if (!row?.itemCodeKey || lookup.has(row.itemCodeKey)) continue;
    lookup.set(row.itemCodeKey, row);
  }
  return lookup;
};

const joinUniqueValues = (values = []) => {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result.join(", ");
};

const buildSourceGroupsByCode = (sourceRows = []) => {
  const lookup = new Map();

  for (const row of sourceRows) {
    if (!row?.itemCodeKey) continue;
    const existing = lookup.get(row.itemCodeKey) || {
      itemCode: row.itemCode,
      itemCodeKey: row.itemCodeKey,
      sourceRows: [],
      sourceCodes: [],
      sourceDescription: "",
      firstSourceRow: row.sourceRow,
    };

    existing.sourceRows.push(row.sourceRow);
    existing.sourceCodes.push(row.itemCode);
    if (!existing.sourceDescription && row.sourceDescription) {
      existing.sourceDescription = row.sourceDescription;
    }
    existing.firstSourceRow = Math.min(existing.firstSourceRow, row.sourceRow);
    lookup.set(row.itemCodeKey, existing);
  }

  return lookup;
};

const toSimpleReportRow = ({
  itemCode = "",
  name = "",
  sourceRows = [],
  sourceCodes = [],
} = {}) => ({
  itemCode: formatItemCode(itemCode),
  name: normalizeText(name),
  sourceRows: joinUniqueValues(sourceRows),
  sourceCodes: joinUniqueValues(sourceCodes.map(formatItemCode)),
});

const buildReportRows = ({
  allDbItems = [],
  brandDbItems = [],
  sourceRows = [],
  duplicateRowsByCode = new Map(),
} = {}) => {
  const sourceByCode = buildSourceGroupsByCode(sourceRows);
  const dbByCode = new Map();

  for (const item of allDbItems) {
    const codeKey = normalizeItemCodeKey(item?.code);
    if (!codeKey || dbByCode.has(codeKey)) continue;
    dbByCode.set(codeKey, item);
  }

  const matchedDbRows = [...sourceByCode.values()]
    .filter((sourceGroup) => dbByCode.has(sourceGroup.itemCodeKey))
    .sort((left, right) => left.firstSourceRow - right.firstSourceRow)
    .map((sourceGroup) => {
      const item = dbByCode.get(sourceGroup.itemCodeKey) || {};
      return toSimpleReportRow({
        itemCode: item?.code || sourceGroup.itemCode,
        name: item?.name || item?.description || sourceGroup.sourceDescription,
        sourceRows: sourceGroup.sourceRows,
        sourceCodes: sourceGroup.sourceCodes,
      });
    });

  const dbMissingSheetRows = brandDbItems
    .filter((item) => {
      const codeKey = normalizeItemCodeKey(item?.code);
      return codeKey && !sourceByCode.has(codeKey);
    })
    .sort((left, right) =>
      String(left?.code || "").localeCompare(
        String(right?.code || ""),
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        },
      ),
    )
    .map((item) =>
      toSimpleReportRow({
        itemCode: item?.code,
        name: item?.name || item?.description,
      }),
    );

  const sheetMissingDbRows = [...sourceByCode.values()]
    .filter((sourceGroup) => !dbByCode.has(sourceGroup.itemCodeKey))
    .sort((left, right) => left.firstSourceRow - right.firstSourceRow)
    .map((sourceGroup) =>
      toSimpleReportRow({
        itemCode: sourceGroup.itemCode,
        name: sourceGroup.sourceDescription,
        sourceRows: sourceGroup.sourceRows,
        sourceCodes: sourceGroup.sourceCodes,
      }),
    );

  return {
    rows: [...matchedDbRows, ...dbMissingSheetRows, ...sheetMissingDbRows],
    matchedDbRows,
    dbMissingSheetRows,
    sheetMissingDbRows,
    matchedDbCount: matchedDbRows.length,
    sheetMissingDbCount: sheetMissingDbRows.length,
    dbMissingSheetCount: dbMissingSheetRows.length,
    duplicateSourceCodeCount: duplicateRowsByCode.size,
  };
};

const removeWorksheetIfExists = (workbook, sheetName) => {
  const existing = workbook.getWorksheet(sheetName);
  if (existing) workbook.removeWorksheet(existing.id);
};

const applySimpleSheetFormatting = (worksheet, columns) => {
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF305496" },
  };
  headerRow.alignment = {
    vertical: "middle",
    horizontal: "center",
    wrapText: true,
  };

  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9E2F3" } },
        left: { style: "thin", color: { argb: "FFD9E2F3" } },
        bottom: { style: "thin", color: { argb: "FFD9E2F3" } },
        right: { style: "thin", color: { argb: "FFD9E2F3" } },
      };
      cell.alignment = {
        vertical: "top",
        wrapText: true,
      };
    });
  });
};

const addSimpleReportSheet = ({
  workbook,
  sheetName,
  rows = [],
  tabColor = "FF70AD47",
} = {}) => {
  const worksheet = workbook.addWorksheet(makeSafeSheetName(sheetName), {
    properties: { tabColor: { argb: tabColor } },
  });
  worksheet.columns = SIMPLE_REPORT_COLUMNS.map((column) => ({
    key: column.key,
    width: column.width,
  }));

  const headerRow = worksheet.getRow(1);
  SIMPLE_REPORT_COLUMNS.forEach((column, index) => {
    headerRow.getCell(index + 1).value = column.header;
  });

  rows.forEach((row) => {
    worksheet.addRow(SIMPLE_REPORT_COLUMNS.map((column) => row[column.key] ?? ""));
  });

  applySimpleSheetFormatting(worksheet, SIMPLE_REPORT_COLUMNS);
  return worksheet;
};

const addSummarySheet = ({
  workbook,
  sheetName,
  brand,
  sourceWorksheet,
  sourceRows,
  allDbItems,
  brandDbItems,
  report,
  apiBaseUrl,
} = {}) => {
  const worksheet = workbook.addWorksheet(makeSafeSheetName(sheetName), {
    properties: { tabColor: { argb: "FF4472C4" } },
  });
  worksheet.columns = SUMMARY_COLUMNS.map((column) => ({
    key: column.key,
    width: column.width,
  }));

  const rows = [
    { metric: "Brand", value: brand },
    { metric: "Source Sheet", value: sourceWorksheet.name },
    { metric: "Generated At", value: new Date() },
    { metric: "API Base URL", value: apiBaseUrl },
    { metric: "Unique Source Items", value: uniqueRowsByCode(sourceRows).size },
    { metric: "DB Items Loaded", value: allDbItems.length },
    { metric: "DB Brand Items", value: brandDbItems.length },
    { metric: "Matches DB", value: report.matchedDbCount },
    { metric: "In DB But Not In Sheet", value: report.dbMissingSheetCount },
    { metric: "In Sheet But Not In DB", value: report.sheetMissingDbCount },
    { metric: "Duplicate Source Codes", value: report.duplicateSourceCodeCount },
  ];

  const headerRow = worksheet.getRow(1);
  SUMMARY_COLUMNS.forEach((column, index) => {
    headerRow.getCell(index + 1).value = column.header;
  });
  rows.forEach((row) => {
    worksheet.addRow(SUMMARY_COLUMNS.map((column) => row[column.key] ?? ""));
  });
  worksheet.getColumn(2).numFmt = "General";
  worksheet.getCell(4, 2).numFmt = "yyyy-mm-dd hh:mm";

  applySimpleSheetFormatting(worksheet, SUMMARY_COLUMNS);
  return worksheet;
};

const getGeneratedSheetNames = (summarySheetName) => [
  MATCHES_DB_SHEET_NAME,
  DB_NOT_IN_SHEET_SHEET_NAME,
  SHEET_NOT_IN_DB_SHEET_NAME,
  makeSafeSheetName(summarySheetName),
];

const removeGeneratedSheets = (workbook, summarySheetName) => {
  const sheetNames = new Set([
    ...getGeneratedSheetNames(summarySheetName),
    LEGACY_REPORT_SHEET_NAME,
  ]);
  sheetNames.forEach((sheetName) => removeWorksheetIfExists(workbook, sheetName));
};

const createReportSheets = ({
  workbook,
  reportSheetName,
  brand,
  sourceWorksheet,
  sourceRows,
  allDbItems,
  brandDbItems,
  report,
  apiBaseUrl,
} = {}) => {
  removeGeneratedSheets(workbook, reportSheetName);

  addSimpleReportSheet({
    workbook,
    sheetName: MATCHES_DB_SHEET_NAME,
    rows: report.matchedDbRows,
    tabColor: "FF70AD47",
  });
  addSimpleReportSheet({
    workbook,
    sheetName: DB_NOT_IN_SHEET_SHEET_NAME,
    rows: report.dbMissingSheetRows,
    tabColor: "FFFFC000",
  });
  addSimpleReportSheet({
    workbook,
    sheetName: SHEET_NOT_IN_DB_SHEET_NAME,
    rows: report.sheetMissingDbRows,
    tabColor: "FFED7D31",
  });
  addSummarySheet({
    workbook,
    sheetName: reportSheetName,
    brand,
    sourceWorksheet,
    sourceRows,
    allDbItems,
    brandDbItems,
    report,
    apiBaseUrl,
  });
};

const resolveInputPath = (input) => {
  if (!input) throw new Error("Workbook path is required.");
  return path.resolve(process.cwd(), input);
};

const resolveOutputPath = ({ inputPath, output, inPlace }) => {
  if (inPlace) return inputPath;
  if (output) return path.resolve(process.cwd(), output);

  const parsed = path.parse(inputPath);
  return path.join(
    parsed.dir,
    `${parsed.name} - DB Check${parsed.ext || ".xlsx"}`,
  );
};

const saveWorkbook = async (workbook, outputPath, inputPath) => {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  if (path.resolve(outputPath) !== path.resolve(inputPath)) {
    await workbook.xlsx.writeFile(outputPath);
    return;
  }

  const tempPath = `${outputPath}.tmp-${Date.now()}.xlsx`;
  await workbook.xlsx.writeFile(tempPath);
  await fs.copyFile(tempPath, outputPath);
  await fs.unlink(tempPath).catch(() => {});
};

const selectSourceWorksheet = (workbook, sourceSheetName, reportSheetName) => {
  if (sourceSheetName) {
    const worksheet = workbook.getWorksheet(sourceSheetName);
    if (!worksheet)
      throw new Error(`Source sheet not found: ${sourceSheetName}`);
    return worksheet;
  }

  const generatedSheetNames = new Set([
    ...getGeneratedSheetNames(reportSheetName),
    LEGACY_REPORT_SHEET_NAME,
  ]);
  const worksheet = workbook.worksheets.find(
    (candidate) => !generatedSheetNames.has(candidate.name),
  );
  if (!worksheet) throw new Error("No source worksheet found.");
  return worksheet;
};

const fetchProductDatabasePage = async ({
  apiBaseUrl,
  authHeaders,
  page = 1,
  limit = API_PAGE_LIMIT,
} = {}) => {
  const url = new URL(`${apiBaseUrl}/items/product-database`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));

  const payload = await apiRequest(url.toString(), {
    headers: {
      ...authHeaders,
    },
  });

  return {
    rows: Array.isArray(payload?.rows) ? payload.rows : [],
    pagination: payload?.pagination || {},
  };
};

const loadDbItems = async ({ apiBaseUrl, authHeaders, brand }) => {
  const allDbItems = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await fetchProductDatabasePage({
      apiBaseUrl,
      authHeaders,
      page,
      limit: API_PAGE_LIMIT,
    });
    allDbItems.push(...result.rows);

    totalPages = parsePositiveInt(result.pagination?.totalPages, totalPages);
    if (result.rows.length === 0) break;
    page += 1;
  } while (page <= totalPages);

  const brandDbItems = allDbItems.filter((item) =>
    itemMatchesBrand(item, brand),
  );

  return {
    allDbItems,
    brandDbItems,
  };
};

const main = async () => {
  const rawArgs = process.argv.slice(2);
  const helpRequested = rawArgs.includes("--help") || rawArgs.includes("-h");
  if (!helpRequested) {
    loadEnvFiles({
      cwd: path.resolve(__dirname, ".."),
    });
  }

  const options = parseArgs(rawArgs);
  if (options.help) {
    console.log(usage().trim());
    return;
  }
  options.apiBaseUrl = resolveApiBaseUrl(options.apiBaseUrl);

  const inputPath = resolveInputPath(options.input);
  const outputPath = resolveOutputPath({
    inputPath,
    output: options.output,
    inPlace: options.inPlace,
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);
  const sourceWorksheet = selectSourceWorksheet(
    workbook,
    options.sourceSheet,
    options.reportSheet,
  );
  const source = readSourceRows(sourceWorksheet);

  const authHeaders = await resolveAuthHeaders(options);
  const dbItems = await loadDbItems({
    apiBaseUrl: options.apiBaseUrl,
    authHeaders,
    brand: options.brand,
  });
  const report = buildReportRows({
    allDbItems: dbItems.allDbItems,
    brandDbItems: dbItems.brandDbItems,
    sourceRows: source.rows,
    duplicateRowsByCode: source.duplicateRowsByCode,
  });

  createReportSheets({
    workbook,
    reportSheetName: options.reportSheet,
    brand: options.brand,
    sourceWorksheet,
    sourceRows: source.rows,
    allDbItems: dbItems.allDbItems,
    brandDbItems: dbItems.brandDbItems,
    report,
    apiBaseUrl: options.apiBaseUrl,
  });

  await saveWorkbook(workbook, outputPath, inputPath);

  console.log("By Boo DB comparison sheet created.");
  console.log(
    JSON.stringify(
      {
        input: inputPath,
        output: outputPath,
        api_base_url: options.apiBaseUrl,
    source_sheet: sourceWorksheet.name,
    brand: options.brand,
    source_rows: source.rows.length,
    unique_source_items: uniqueRowsByCode(source.rows).size,
    db_items_loaded: dbItems.allDbItems.length,
    db_brand_items: dbItems.brandDbItems.length,
    matched_db_items: report.matchedDbCount,
    sheet_items_missing_in_db: report.sheetMissingDbCount,
    db_items_missing_in_sheet: report.dbMissingSheetCount,
    duplicate_source_codes: report.duplicateSourceCodeCount,
      },
      null,
      2,
    ),
  );
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildReportRows,
  createReportSheets,
  formatItemCode,
  itemMatchesBrand,
  normalizeBrandKey,
  normalizeHeader,
  normalizeItemCodeKey,
  parseArgs,
  readSourceRows,
};
