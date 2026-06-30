const fs = require("fs/promises");
const path = require("path");
const XLSX = require("xlsx");

const { loadEnvFiles } = require("../config/loadEnv");

const SHIPPING_MARK_FILE_PATTERN = /^(.+?)_Shippingmark(?:[_\s.-].*)?\.pdf$/i;
const SHIPPING_MARK_CONTENT_TYPE = "application/pdf";
const DEFAULT_API_BASE_URL = "https://api.ghouse-sourcing.com";
const ISSUE_STATUSES = new Set([
  "lookup-failed",
  "missing-item",
  "skipped-existing",
  "upload-failed",
]);

const normalizeText = (value) => String(value ?? "").replace(/\r/g, "").trim();

const normalizeCode = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return /^\d+\.0+$/.test(normalized) ? normalized.replace(/\.0+$/, "") : normalized;
};

const toBoolean = (value, fallback = false) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(normalized);
};

const parseArgs = (argv = []) => {
  const options = {
    folderPath: process.env.SHIPPING_MARKS_UPLOAD_FOLDER || "",
    apiBaseUrl:
      process.env.SHIPPING_MARKS_UPLOAD_API_BASE_URL
      || process.env.OMS_API_BASE_URL
      || "",
    username:
      process.env.SHIPPING_MARKS_UPLOAD_USERNAME
      || process.env.OMS_API_USERNAME
      || "",
    password:
      process.env.SHIPPING_MARKS_UPLOAD_PASSWORD
      || process.env.OMS_API_PASSWORD
      || "",
    token:
      process.env.SHIPPING_MARKS_UPLOAD_TOKEN
      || process.env.OMS_API_TOKEN
      || "",
    reportPath: process.env.SHIPPING_MARKS_UPLOAD_REPORT_PATH || "",
    writeReport: !toBoolean(process.env.SHIPPING_MARKS_UPLOAD_NO_REPORT, false),
    help: false,
    dryRun: toBoolean(process.env.SHIPPING_MARKS_UPLOAD_DRY_RUN, false),
    recursive: toBoolean(process.env.SHIPPING_MARKS_UPLOAD_RECURSIVE, true),
    skipExisting: toBoolean(process.env.SHIPPING_MARKS_UPLOAD_SKIP_EXISTING, false),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "").trim();
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (!arg.startsWith("--") && !options.folderPath) {
      options.folderPath = arg;
      continue;
    }

    const nextValue = argv[index + 1];
    const consumeNext = () => {
      index += 1;
      return String(nextValue || "").trim();
    };

    if (arg === "--folder" && nextValue) {
      options.folderPath = consumeNext();
      continue;
    }
    if (arg.startsWith("--folder=")) {
      options.folderPath = arg.slice("--folder=".length).trim();
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

    if (arg === "--token" && nextValue) {
      options.token = consumeNext();
      continue;
    }
    if (arg.startsWith("--token=")) {
      options.token = arg.slice("--token=".length).trim();
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if ((arg === "--report" || arg === "--report-path") && nextValue) {
      options.reportPath = consumeNext();
      options.writeReport = true;
      continue;
    }
    if (arg.startsWith("--report=")) {
      options.reportPath = arg.slice("--report=".length).trim();
      options.writeReport = true;
      continue;
    }
    if (arg.startsWith("--report-path=")) {
      options.reportPath = arg.slice("--report-path=".length).trim();
      options.writeReport = true;
      continue;
    }
    if (arg === "--no-report") {
      options.writeReport = false;
      continue;
    }
    if (arg === "--skip-existing") {
      options.skipExisting = true;
      continue;
    }
    if (arg === "--replace-existing") {
      options.skipExisting = false;
      continue;
    }
    if (arg === "--no-recursive") {
      options.recursive = false;
      continue;
    }
    if (arg === "--recursive") {
      options.recursive = true;
      continue;
    }
  }

  return options;
};

const resolveApiBaseUrl = (value = "") => {
  const normalizedValue = normalizeText(value);
  if (normalizedValue) {
    return normalizedValue.replace(/\/+$/g, "");
  }

  return DEFAULT_API_BASE_URL;
};

const buildReportTimestamp = () =>
  new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:]/g, "-");

const buildReportFilename = () =>
  `shipping-marks-upload-report-${buildReportTimestamp()}.xlsx`;

const isSpreadsheetPath = (value = "") =>
  [".xlsx", ".xls"].includes(path.extname(String(value || "")).toLowerCase());

const resolveReportPath = (value = "") => {
  const normalizedValue = normalizeText(value);
  if (normalizedValue) {
    const resolvedValue = path.resolve(normalizedValue);
    return isSpreadsheetPath(resolvedValue)
      ? resolvedValue
      : path.join(resolvedValue, buildReportFilename());
  }
  return path.resolve(
    __dirname,
    "output",
    buildReportFilename(),
  );
};

const ensureReportParentDirectory = async (reportPath) => {
  const parentDirectory = path.dirname(reportPath);
  const parsedParent = path.parse(parentDirectory);

  if (
    parentDirectory === parsedParent.root
    || parentDirectory === "."
    || !normalizeText(parentDirectory)
  ) {
    return;
  }

  await fs.mkdir(parentDirectory, { recursive: true });
};

const getShippingMarkFileMatch = (filePath) => {
  const fileName = path.basename(filePath);
  const match = fileName.match(SHIPPING_MARK_FILE_PATTERN);
  if (!match) return null;

  const itemCode = normalizeCode(match[1]);
  if (!itemCode) return null;

  return {
    itemCode,
    filePath,
  };
};

const collectShippingMarkFiles = async (targetPath, { recursive = true } = {}) => {
  const resolvedPath = path.resolve(targetPath);
  const stats = await fs.stat(resolvedPath);

  if (stats.isFile()) {
    const match = getShippingMarkFileMatch(resolvedPath);
    return {
      scannedFiles: 1,
      ignoredFiles: match ? 0 : 1,
      files: match ? [match] : [],
    };
  }

  if (!stats.isDirectory()) {
    return {
      scannedFiles: 0,
      ignoredFiles: 0,
      files: [],
    };
  }

  const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
  const result = {
    scannedFiles: 0,
    ignoredFiles: 0,
    files: [],
  };

  for (const entry of entries) {
    const entryPath = path.join(resolvedPath, entry.name);

    if (entry.isDirectory()) {
      if (recursive) {
        const nestedResult = await collectShippingMarkFiles(entryPath, { recursive });
        result.scannedFiles += nestedResult.scannedFiles;
        result.ignoredFiles += nestedResult.ignoredFiles;
        result.files.push(...nestedResult.files);
      }
      continue;
    }

    if (!entry.isFile()) continue;

    result.scannedFiles += 1;
    const match = getShippingMarkFileMatch(entryPath);
    if (match) {
      result.files.push(match);
    } else {
      result.ignoredFiles += 1;
    }
  }

  result.files.sort((left, right) => left.filePath.localeCompare(right.filePath));
  return result;
};

const groupFilesByItemCode = (files = []) => {
  const grouped = new Map();

  for (const file of files) {
    const itemCode = normalizeCode(file?.itemCode);
    if (!itemCode) continue;

    const groupKey = itemCode.toLowerCase();
    const existingGroup = grouped.get(groupKey) || {
      itemCode,
      files: [],
    };
    existingGroup.files.push(file.filePath);
    grouped.set(groupKey, existingGroup);
  }

  return [...grouped.values()].sort((left, right) =>
    left.itemCode.localeCompare(right.itemCode),
  );
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
  const normalizedHeader = normalizeText(header);
  if (!normalizedHeader) return [];
  return normalizedHeader.split(/,(?=\s*[^;,]+=)/g).map((entry) => entry.trim()).filter(Boolean);
};

const getSetCookieHeaders = (headers) => {
  if (!headers) return [];
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
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
      normalizeText(payload?.message)
      || normalizeText(payload?.error)
      || `${method} ${url} failed with status ${response.status}`;
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
    payload?.token
    || payload?.accessToken
    || payload?.access_token
    || payload?.data?.token
    || payload?.data?.accessToken
    || payload?.data?.access_token,
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

const resolveAuthHeaders = async (options) => {
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

const findItemByCode = async ({ apiBaseUrl, authHeaders, code }) => {
  const payload = await apiRequest(
    `${apiBaseUrl}/items?search=${encodeURIComponent(code)}&page=1&limit=50`,
    {
      headers: {
        ...authHeaders,
      },
    },
  );

  const items = Array.isArray(payload?.data) ? payload.data : [];
  const normalizedCode = normalizeCode(code).toLowerCase();
  const exactMatches = items.filter(
    (item) => normalizeCode(item?.code).toLowerCase() === normalizedCode,
  );

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  if (exactMatches.length > 1) {
    throw new Error(`Multiple exact item matches found for code ${code}`);
  }

  return null;
};

const hasStoredItemFile = (file = {}) =>
  Array.isArray(file)
    ? file.some((entry) => hasStoredItemFile(entry))
    : Boolean(
        normalizeText(file?.key || file?.url || file?.link || file?.public_id),
      );

const hasExistingShippingMarks = (item = {}) =>
  hasStoredItemFile(item?.shipping_marks?.files);

const uploadShippingMarks = async ({ apiBaseUrl, authHeaders, itemId, filePaths }) => {
  const selectedFilePaths = Array.isArray(filePaths) ? filePaths.filter(Boolean) : [];
  const formData = new FormData();
  formData.append("file_type", "shipping_marks");

  for (const filePath of selectedFilePaths) {
    const fileBuffer = await fs.readFile(filePath);
    formData.append(
      selectedFilePaths.length > 1 ? "files" : "file",
      new Blob([fileBuffer], { type: SHIPPING_MARK_CONTENT_TYPE }),
      path.basename(filePath),
    );
  }

  return apiRequest(`${apiBaseUrl}/items/${encodeURIComponent(itemId)}/files`, {
    method: "POST",
    headers: {
      ...authHeaders,
    },
    body: formData,
  });
};

const formatRelativeFileList = (basePath, filePaths = []) =>
  filePaths
    .map((filePath) => path.relative(basePath, filePath) || path.basename(filePath))
    .join(", ");

const getPdfFolderName = (filePath) => {
  const folderName = path.basename(path.dirname(filePath));
  return normalizeText(folderName) || ".";
};

const formatFolderList = (filePaths = []) =>
  [...new Set(filePaths.map(getPdfFolderName).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .join(", ");

const formatDetailRecord = ({
  status = "",
  itemCode = "",
  itemId = "",
  folderList = "",
  relativeFileList = "",
  message = "",
} = {}) => {
  const parts = [
    `[${status}] ${itemCode}${itemId ? ` -> ${itemId}` : ""}`,
    `folder=${folderList || "."}`,
    `files=${relativeFileList}`,
  ];
  if (message) parts.push(`reason=${message}`);
  return parts.join(" :: ");
};

const printDetailSection = (title, records = []) => {
  if (!Array.isArray(records) || records.length === 0) return;

  console.log("");
  console.log(title);
  records.forEach((record) => {
    console.log(`  ${formatDetailRecord(record)}`);
  });
};

const buildReportRow = ({
  status = "",
  itemCode = "",
  itemId = "",
  folderList = "",
  relativeFileList = "",
  fileCount = 0,
  existing = "",
  uploadedFiles = 0,
  message = "",
} = {}) => ({
  Status: status,
  "Item Code": itemCode,
  "Item ID": normalizeText(itemId),
  "PDF Folder": folderList,
  Files: relativeFileList,
  "File Count": Number(fileCount || 0),
  "Existing Shipping Marks": existing,
  "Uploaded Files": Number(uploadedFiles || 0),
  Reason: message,
});

const addSheet = (workbook, sheetName, headers, rows = [], columnWidths = []) => {
  const values = [
    headers,
    ...rows.map((row) => headers.map((header) => row?.[header] ?? "")),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(values);
  sheet["!cols"] = columnWidths.map((width) => ({ wch: width }));
  sheet["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(values.length - 1, 0), c: Math.max(headers.length - 1, 0) },
    }),
  };
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
};

const writeExcelReport = async ({
  reportPath,
  options,
  targetPath,
  scanResult,
  summary,
  detailRows,
}) => {
  const resolvedReportPath = resolveReportPath(reportPath);
  const workbook = XLSX.utils.book_new();
  const generatedAt = new Date().toISOString();

  const summaryRows = [
    { Metric: "Generated At", Value: generatedAt },
    { Metric: "Backend", Value: options.apiBaseUrl },
    { Metric: "Target", Value: targetPath },
    { Metric: "Mode", Value: options.dryRun ? "dry-run" : "upload" },
    { Metric: "Recursive", Value: options.recursive ? "yes" : "no" },
    { Metric: "Skip Existing", Value: options.skipExisting ? "yes" : "no" },
    { Metric: "Scanned Files", Value: scanResult.scannedFiles },
    { Metric: "Ignored Files", Value: scanResult.ignoredFiles },
    { Metric: "Shipping PDFs", Value: scanResult.files.length },
    { Metric: "Item Groups", Value: summary.itemGroups },
    { Metric: "Files Matched", Value: summary.filesMatched },
    { Metric: "Uploaded Groups", Value: summary.uploadedGroups },
    { Metric: "Uploaded Files", Value: summary.uploadedFiles },
    { Metric: "Dry-run Groups", Value: summary.dryRunMatchedGroups },
    { Metric: "Dry-run Files", Value: summary.dryRunMatchedFiles },
    { Metric: "Skipped Existing", Value: summary.skippedExisting },
    { Metric: "Missing Item", Value: summary.missingItem },
    { Metric: "Failed", Value: summary.failed },
  ];
  addSheet(workbook, "Summary", ["Metric", "Value"], summaryRows, [24, 100]);

  const detailHeaders = [
    "Status",
    "Item Code",
    "Item ID",
    "PDF Folder",
    "Files",
    "File Count",
    "Existing Shipping Marks",
    "Uploaded Files",
    "Reason",
  ];
  const safeDetailRows = Array.isArray(detailRows) ? detailRows : [];
  addSheet(
    workbook,
    "Details",
    detailHeaders,
    safeDetailRows,
    [18, 16, 28, 32, 100, 12, 24, 16, 60],
  );
  addSheet(
    workbook,
    "Issues",
    detailHeaders,
    safeDetailRows.filter((row) => ISSUE_STATUSES.has(row?.Status)),
    [18, 16, 28, 32, 100, 12, 24, 16, 60],
  );

  await ensureReportParentDirectory(resolvedReportPath);
  XLSX.writeFile(workbook, resolvedReportPath);
  return resolvedReportPath;
};

const printUsage = () => {
  console.log("Usage:");
  console.log(
    "  node scripts/uploadShippingMarksFolderViaApi.js --folder <path> [--api-base-url <url>] [--token <jwt>]",
  );
  console.log(
    "  node scripts/uploadShippingMarksFolderViaApi.js --folder <path> [--api-base-url <url>] --username <user> --password <pass>",
  );
  console.log("");
  console.log("Options:");
  console.log("  --folder <path>        Folder or single shipping mark PDF to process");
  console.log(`  --api-base-url <url>   Backend base URL, defaults to ${DEFAULT_API_BASE_URL}`);
  console.log("  --token <jwt>          Use an existing backend JWT");
  console.log("  --username <value>     Backend username for /auth/signin");
  console.log("  --password <value>     Backend password for /auth/signin");
  console.log("  --dry-run              Resolve item matches without uploading");
  console.log("  --report <path>        Write Excel report to a custom .xlsx/.xls path");
  console.log("  --no-report            Do not write the Excel report");
  console.log("  --skip-existing        Skip items that already have shipping marks.files");
  console.log("  --replace-existing     Upload even when shipping marks already exist");
  console.log("  --no-recursive         Only scan the top-level folder");
  console.log("");
  console.log("Expected filename:");
  console.log("  {item_code}_Shippingmark....pdf");
};

const main = async () => {
  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
  });

  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (!normalizeText(options.folderPath)) {
    printUsage();
    throw new Error("Folder path is required");
  }

  options.apiBaseUrl = resolveApiBaseUrl(options.apiBaseUrl);
  const targetPath = path.resolve(options.folderPath);
  const scanResult = await collectShippingMarkFiles(targetPath, {
    recursive: options.recursive,
  });
  const groupedFiles = groupFilesByItemCode(scanResult.files);

  if (groupedFiles.length === 0) {
    throw new Error(`No matching {item_code}_Shippingmark*.pdf files found in ${targetPath}`);
  }

  const authHeaders = await resolveAuthHeaders(options);

  console.log(`Backend          : ${options.apiBaseUrl}`);
  console.log(`Target           : ${targetPath}`);
  console.log(`Scanned files    : ${scanResult.scannedFiles}`);
  console.log(`Ignored files    : ${scanResult.ignoredFiles}`);
  console.log(`Shipping PDFs    : ${scanResult.files.length}`);
  console.log(`Item groups      : ${groupedFiles.length}`);
  console.log(`Recursive        : ${options.recursive ? "yes" : "no"}`);
  console.log(`Skip existing    : ${options.skipExisting ? "yes" : "no"}`);
  console.log(`Mode             : ${options.dryRun ? "dry-run" : "upload"}`);

  const summary = {
    itemGroups: groupedFiles.length,
    filesMatched: scanResult.files.length,
    uploadedGroups: 0,
    uploadedFiles: 0,
    dryRunMatchedGroups: 0,
    dryRunMatchedFiles: 0,
    skippedExisting: 0,
    missingItem: 0,
    failed: 0,
  };
  const detailRecords = {
    missingItems: [],
    skippedItems: [],
    failedItems: [],
  };
  const reportRows = [];

  for (const group of groupedFiles) {
    const relativeFileList = formatRelativeFileList(targetPath, group.files);
    const folderList = formatFolderList(group.files);

    let item = null;
    try {
      item = await findItemByCode({
        apiBaseUrl: options.apiBaseUrl,
        authHeaders,
        code: group.itemCode,
      });
    } catch (error) {
      summary.failed += 1;
      detailRecords.failedItems.push({
        status: "lookup-failed",
        itemCode: group.itemCode,
        folderList,
        relativeFileList,
        message: error.message,
      });
      reportRows.push(buildReportRow({
        status: "lookup-failed",
        itemCode: group.itemCode,
        folderList,
        relativeFileList,
        fileCount: group.files.length,
        message: error.message,
      }));
      console.error(
        `[lookup-failed] ${group.itemCode} :: folder=${folderList} :: files=${relativeFileList} :: ${error.message}`,
      );
      continue;
    }

    if (!item?._id) {
      summary.missingItem += 1;
      detailRecords.missingItems.push({
        status: "missing-item",
        itemCode: group.itemCode,
        folderList,
        relativeFileList,
      });
      reportRows.push(buildReportRow({
        status: "missing-item",
        itemCode: group.itemCode,
        folderList,
        relativeFileList,
        fileCount: group.files.length,
        message: "No exact item match found",
      }));
      console.warn(`[missing-item] ${group.itemCode} :: folder=${folderList} :: files=${relativeFileList}`);
      continue;
    }

    const hasExistingFiles = hasExistingShippingMarks(item);

    if (options.skipExisting && hasExistingFiles) {
      summary.skippedExisting += 1;
      detailRecords.skippedItems.push({
        status: "skipped-existing",
        itemCode: group.itemCode,
        itemId: item._id,
        folderList,
        relativeFileList,
      });
      reportRows.push(buildReportRow({
        status: "skipped-existing",
        itemCode: group.itemCode,
        itemId: item._id,
        folderList,
        relativeFileList,
        fileCount: group.files.length,
        existing: "yes",
        message: "--skip-existing enabled",
      }));
      console.log(
        `[skipped-existing] ${group.itemCode} -> ${item._id} :: folder=${folderList} :: files=${relativeFileList}`,
      );
      continue;
    }

    if (options.dryRun) {
      summary.dryRunMatchedGroups += 1;
      summary.dryRunMatchedFiles += group.files.length;
      reportRows.push(buildReportRow({
        status: "matched",
        itemCode: group.itemCode,
        itemId: item._id,
        folderList,
        relativeFileList,
        fileCount: group.files.length,
        existing: hasExistingFiles ? "yes" : "no",
      }));
      console.log(
        `[matched] ${group.itemCode} -> ${item._id} :: existing=${hasExistingFiles ? "yes" : "no"} :: ${relativeFileList}`,
      );
      continue;
    }

    try {
      const response = await uploadShippingMarks({
        apiBaseUrl: options.apiBaseUrl,
        authHeaders,
        itemId: item._id,
        filePaths: group.files,
      });
      const uploadedFiles = Array.isArray(response?.data?.files)
        ? response.data.files.length
        : group.files.length;
      summary.uploadedGroups += 1;
      summary.uploadedFiles += uploadedFiles;
      reportRows.push(buildReportRow({
        status: "uploaded",
        itemCode: group.itemCode,
        itemId: item._id,
        folderList,
        relativeFileList,
        fileCount: group.files.length,
        existing: hasExistingFiles ? "yes" : "no",
        uploadedFiles,
      }));
      console.log(
        `[uploaded] ${group.itemCode} -> ${item._id} -> ${uploadedFiles} file(s) :: ${relativeFileList}`,
      );
    } catch (error) {
      summary.failed += 1;
      detailRecords.failedItems.push({
        status: "upload-failed",
        itemCode: group.itemCode,
        itemId: item._id,
        folderList,
        relativeFileList,
        message: error.message,
      });
      reportRows.push(buildReportRow({
        status: "upload-failed",
        itemCode: group.itemCode,
        itemId: item._id,
        folderList,
        relativeFileList,
        fileCount: group.files.length,
        existing: hasExistingFiles ? "yes" : "no",
        message: error.message,
      }));
      console.error(
        `[upload-failed] ${group.itemCode} -> ${item._id} :: folder=${folderList} :: files=${relativeFileList} :: ${error.message}`,
      );
    }
  }

  console.log("");
  console.log("Summary");
  console.log(`  Item groups       : ${summary.itemGroups}`);
  console.log(`  Files matched     : ${summary.filesMatched}`);
  console.log(`  Uploaded groups   : ${summary.uploadedGroups}`);
  console.log(`  Uploaded files    : ${summary.uploadedFiles}`);
  console.log(`  Dry-run groups    : ${summary.dryRunMatchedGroups}`);
  console.log(`  Dry-run files     : ${summary.dryRunMatchedFiles}`);
  console.log(`  Skipped existing  : ${summary.skippedExisting}`);
  console.log(`  Missing item      : ${summary.missingItem}`);
  console.log(`  Failed            : ${summary.failed}`);

  printDetailSection("Missing Items", detailRecords.missingItems);
  printDetailSection("Skipped Items", detailRecords.skippedItems);
  printDetailSection("Failed Items", detailRecords.failedItems);

  if (options.writeReport) {
    const reportOutputPath = await writeExcelReport({
      reportPath: options.reportPath,
      options,
      targetPath,
      scanResult,
      summary,
      detailRows: reportRows,
    });
    console.log("");
    console.log(`Excel report      : ${reportOutputPath}`);
  }

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error("Batch shipping marks upload failed:", error?.message || error);
  process.exitCode = 1;
});
