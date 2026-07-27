const fs = require("fs/promises");
const path = require("path");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");

const { loadEnvFiles } = require("../config/loadEnv");
const { parsePisUpload } = require("../helpers/pisExcelParser");

const EXCEL_EXTENSIONS = new Set([".xlsx", ".xls"]);

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

const cell = (sheet, row, col) => {
  const address = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  return sheet?.[address] ? sheet[address].v : null;
};

const getMaxRow = (sheet) => {
  const reference = sheet?.["!ref"];
  return reference ? XLSX.utils.decode_range(reference).e.r + 1 : 1;
};

const findRowByLabel = (
  sheet,
  matcher,
  { col = 1, startRow = 1, endRow = getMaxRow(sheet) } = {},
) => {
  for (let row = startRow; row <= endRow; row += 1) {
    if (matcher.test(normalizeText(cell(sheet, row, col)))) {
      return row;
    }
  }
  return null;
};

const deriveCodeFromFilename = (filePath) => {
  const baseName = path.parse(path.basename(filePath)).name;
  const normalizedBaseName = normalizeCode(baseName);
  const digitMatch = normalizedBaseName.match(/\d{3,}/);
  return digitMatch ? digitMatch[0] : normalizedBaseName;
};

const extractItemCodeFromWorkbook = (filePath) => {
  try {
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      return deriveCodeFromFilename(filePath);
    }

    const articleRow = findRowByLabel(sheet, /^article number$/i, {
      col: 6,
      startRow: 1,
      endRow: 20,
    });

    const articleNumber = articleRow ? cell(sheet, articleRow, 10) : "";
    return normalizeCode(articleNumber) || deriveCodeFromFilename(filePath);
  } catch (error) {
    return deriveCodeFromFilename(filePath);
  }
};

const deriveIsaaFolderCode = (folderName) =>
  String(folderName ?? "").trim().match(/^(\d+)/)?.[1] || "";

const evaluateIsaaCandidate = ({ folderCode, articleNumber }) => {
  const parsedArticleNumber = normalizeText(articleNumber);
  if (parsedArticleNumber === folderCode) {
    return { upload: true, reason: "" };
  }

  return {
    upload: false,
    reason: parsedArticleNumber
      ? `PIS article number ${parsedArticleNumber} does not match folder code ${folderCode}`
      : "PIS article number is missing",
  };
};

const parseArgs = (argv = []) => {
  const options = {
    folderPath: process.env.PIS_UPLOAD_FOLDER || "",
    apiBaseUrl:
      process.env.PIS_UPLOAD_API_BASE_URL
      || process.env.OMS_API_BASE_URL
      || "",
    username:
      process.env.PIS_UPLOAD_USERNAME
      || process.env.OMS_API_USERNAME
      || "",
    password:
      process.env.PIS_UPLOAD_PASSWORD
      || process.env.OMS_API_PASSWORD
      || "",
    token:
      process.env.PIS_UPLOAD_TOKEN
      || process.env.OMS_API_TOKEN
      || "",
    help: false,
    dryRun: toBoolean(process.env.PIS_UPLOAD_DRY_RUN, false),
    recursive: toBoolean(process.env.PIS_UPLOAD_RECURSIVE, true),
    isaaLayout: toBoolean(process.env.PIS_UPLOAD_ISAA_LAYOUT, false),
    reportPath: process.env.PIS_UPLOAD_REPORT_PATH || "",
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
    if (arg === "--isaa-layout") {
      options.isaaLayout = true;
      continue;
    }
    if (arg === "--report" && nextValue) {
      options.reportPath = consumeNext();
      continue;
    }
    if (arg.startsWith("--report=")) {
      options.reportPath = arg.slice("--report=".length).trim();
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

  const port = Number.parseInt(String(process.env.PORT || "8008"), 10) || 8008;
  return `http://127.0.0.1:${port}`;
};

const collectWorkbookFiles = async (targetPath, { recursive = true } = {}) => {
  const resolvedPath = path.resolve(targetPath);
  const stats = await fs.stat(resolvedPath);

  if (stats.isFile()) {
    const extension = path.extname(resolvedPath).toLowerCase();
    return EXCEL_EXTENSIONS.has(extension) ? [resolvedPath] : [];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(resolvedPath, entry.name);

    if (entry.isDirectory()) {
      if (recursive) {
        files.push(...(await collectWorkbookFiles(entryPath, { recursive })));
      }
      continue;
    }

    if (!entry.isFile()) continue;
    if (!EXCEL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    files.push(entryPath);
  }

  return files.sort((left, right) => left.localeCompare(right));
};

const collectIsaaWorkbookFiles = async (targetPath) => {
  const rootPath = path.resolve(targetPath);
  const vendors = await fs.readdir(rootPath, { withFileTypes: true });
  const candidates = [];

  for (const vendor of vendors) {
    if (!vendor.isDirectory()) continue;

    const vendorPath = path.join(rootPath, vendor.name);
    const itemFolders = await fs.readdir(vendorPath, { withFileTypes: true });
    for (const itemFolder of itemFolders) {
      if (!itemFolder.isDirectory()) continue;

      const folderCode = deriveIsaaFolderCode(itemFolder.name);
      if (!folderCode) continue;

      const itemFolderPath = path.join(vendorPath, itemFolder.name);
      const files = await fs.readdir(itemFolderPath, { withFileTypes: true });
      for (const file of files) {
        if (
          !file.isFile()
          || path.extname(file.name).toLowerCase() !== ".xlsx"
          || file.name.startsWith("~$")
        ) {
          continue;
        }

        const filePath = path.join(itemFolderPath, file.name);
        candidates.push({
          filePath,
          relativeFilePath: path.relative(rootPath, filePath),
          vendor: vendor.name,
          folder: itemFolder.name,
          folderCode,
          articleNumber: "",
        });
      }
    }
  }

  return candidates.sort((left, right) =>
    left.relativeFilePath.localeCompare(right.relativeFilePath),
  );
};

const toIsaaException = (candidate, reason, action = "skipped") => ({
  vendor: candidate.vendor,
  folder: candidate.folder,
  sourcePath: candidate.relativeFilePath,
  folderCode: candidate.folderCode,
  articleNumber: candidate.articleNumber || "",
  action,
  reason,
});

const validateIsaaCandidate = async (candidate) => {
  try {
    const parsed = await parsePisUpload({
      originalname: path.basename(candidate.filePath),
      path: candidate.filePath,
    });
    const articleNumber = normalizeText(parsed.articleNumber);
    const validation = evaluateIsaaCandidate({
      folderCode: candidate.folderCode,
      articleNumber,
    });

    return {
      ...candidate,
      articleNumber,
      ...validation,
    };
  } catch (error) {
    return {
      ...candidate,
      upload: false,
      reason: normalizeText(error?.message) || "Unable to parse PIS workbook",
    };
  }
};

const defaultIsaaReportPath = () => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(__dirname, "..", "..", "outputs", `isaa-pis-upload-exceptions-${timestamp}.xlsx`);
};

const writeIsaaExceptionReport = async ({ reportPath, exceptions }) => {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Exceptions", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  sheet.mergeCells("A1:G1");
  sheet.getCell("A1").value = "ISAA PIS Upload Exceptions";
  sheet.getCell("A2").value = "Generated";
  sheet.getCell("B2").value = new Date();
  sheet.getCell("B2").numFmt = "yyyy-mm-dd hh:mm";
  sheet.getCell("A3").value = "Exception count";
  sheet.getCell("B3").value = exceptions.length;

  sheet.columns = [
    { header: "Vendor", key: "vendor", width: 28 },
    { header: "Item folder", key: "folder", width: 38 },
    { header: "Source path", key: "sourcePath", width: 68 },
    { header: "Folder code", key: "folderCode", width: 14 },
    { header: "Article number", key: "articleNumber", width: 16 },
    { header: "Action", key: "action", width: 14 },
    { header: "Reason", key: "reason", width: 56 },
  ];
  sheet.getRow(4).values = [
    "Vendor",
    "Item folder",
    "Source path",
    "Folder code",
    "Article number",
    "Action",
    "Reason",
  ];
  exceptions.forEach((exception) => sheet.addRow(exception));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  sheet.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
  sheet.getRow(4).alignment = { vertical: "middle" };
  sheet.autoFilter = "A4:G4";

  await workbook.xlsx.writeFile(reportPath);
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

const apiRequest = async (url, { method = "GET", headers = {}, body } = {}) => {
  const response = await fetch(url, {
    method,
    headers,
    body,
  });
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

  return payload;
};

const signIn = async ({ apiBaseUrl, username, password }) => {
  const payload = await apiRequest(`${apiBaseUrl}/auth/signin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });

  const token = normalizeText(payload?.token);
  if (!token) {
    throw new Error("Auth signin did not return a token");
  }

  return token;
};

const resolveAccessToken = async (options) => {
  const directToken = normalizeText(options.token);
  if (directToken) return directToken;

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

const findItemByCode = async ({ apiBaseUrl, token, code }) => {
  const payload = await apiRequest(
    `${apiBaseUrl}/items?search=${encodeURIComponent(code)}&page=1&limit=50`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
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

const uploadPisWorkbook = async ({ apiBaseUrl, token, itemId, filePath }) => {
  const fileBuffer = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const contentType =
    extension === ".xls"
      ? "application/vnd.ms-excel"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([fileBuffer], { type: contentType }),
    fileName,
  );

  return apiRequest(`${apiBaseUrl}/items/${encodeURIComponent(itemId)}/pis-upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });
};

const runIsaaLayoutUpload = async ({ options, targetPath }) => {
  const candidates = await collectIsaaWorkbookFiles(targetPath);
  if (candidates.length === 0) {
    throw new Error(`No direct item-folder .xlsx files found in ${targetPath}`);
  }

  const summary = {
    total: candidates.length,
    validated: 0,
    uploaded: 0,
    dryRunMatched: 0,
    skipped: 0,
    missingItem: 0,
    failed: 0,
  };
  const exceptions = [];
  const readyCandidates = [];

  console.log(`Backend   : ${options.apiBaseUrl}`);
  console.log(`Target    : ${targetPath}`);
  console.log(`Workbooks : ${candidates.length}`);
  console.log(`Layout    : ISAA vendor/item-folder`);
  console.log(`Mode      : ${options.dryRun ? "dry-run" : "upload"}`);

  for (const candidate of candidates) {
    const validation = await validateIsaaCandidate(candidate);
    if (!validation.upload) {
      summary.skipped += 1;
      exceptions.push(toIsaaException(validation, validation.reason));
      console.warn(`[skipped] ${validation.relativeFilePath} :: ${validation.reason}`);
      continue;
    }

    summary.validated += 1;
    readyCandidates.push(validation);
  }

  if (readyCandidates.length > 0) {
    let token = "";
    try {
      token = await resolveAccessToken(options);
    } catch (error) {
      const reason = `Authentication failed: ${normalizeText(error?.message) || "Unknown error"}`;
      summary.failed += readyCandidates.length;
      readyCandidates.forEach((candidate) => {
        exceptions.push(toIsaaException(candidate, reason, "failed"));
      });
    }

    for (const candidate of token ? readyCandidates : []) {
      let item = null;
      try {
        item = await findItemByCode({
          apiBaseUrl: options.apiBaseUrl,
          token,
          code: candidate.folderCode,
        });
      } catch (error) {
        summary.failed += 1;
        const reason = `Item lookup failed: ${normalizeText(error?.message) || "Unknown error"}`;
        exceptions.push(toIsaaException(candidate, reason, "failed"));
        console.error(`[lookup-failed] ${candidate.relativeFilePath} -> ${candidate.folderCode} :: ${reason}`);
        continue;
      }

      if (!item?._id) {
        summary.missingItem += 1;
        const reason = `No OMS item matches code ${candidate.folderCode}`;
        exceptions.push(toIsaaException(candidate, reason));
        console.warn(`[missing-item] ${candidate.relativeFilePath} -> ${candidate.folderCode}`);
        continue;
      }

      if (options.dryRun) {
        summary.dryRunMatched += 1;
        console.log(`[matched] ${candidate.relativeFilePath} -> ${candidate.folderCode} -> ${item._id}`);
        continue;
      }

      try {
        const response = await uploadPisWorkbook({
          apiBaseUrl: options.apiBaseUrl,
          token,
          itemId: item._id,
          filePath: candidate.filePath,
        });
        summary.uploaded += 1;
        console.log(
          `[uploaded] ${candidate.relativeFilePath} -> ${candidate.folderCode} -> ${item._id} -> ${normalizeText(response?.data?.pis_file?.key)}`,
        );
      } catch (error) {
        summary.failed += 1;
        const reason = `Upload failed: ${normalizeText(error?.message) || "Unknown error"}`;
        exceptions.push(toIsaaException(candidate, reason, "failed"));
        console.error(`[upload-failed] ${candidate.relativeFilePath} -> ${candidate.folderCode} -> ${item._id} :: ${reason}`);
      }
    }
  }

  const reportPath = options.reportPath
    ? path.resolve(options.reportPath)
    : defaultIsaaReportPath();
  await writeIsaaExceptionReport({ reportPath, exceptions });

  console.log("");
  console.log("Summary");
  console.log(`  Total        : ${summary.total}`);
  console.log(`  Validated    : ${summary.validated}`);
  console.log(`  Uploaded     : ${summary.uploaded}`);
  console.log(`  Dry-run hits : ${summary.dryRunMatched}`);
  console.log(`  Skipped      : ${summary.skipped}`);
  console.log(`  Missing item : ${summary.missingItem}`);
  console.log(`  Failed       : ${summary.failed}`);
  console.log(`  Report       : ${reportPath}`);

  if (summary.failed > 0) {
    process.exitCode = 1;
  }

  return { summary, exceptions, reportPath };
};

const printUsage = () => {
  console.log("Usage:");
  console.log(
    "  node scripts/uploadPisFolderViaApi.js --folder <path> [--api-base-url <url>] [--token <jwt>]",
  );
  console.log(
    "  node scripts/uploadPisFolderViaApi.js --folder <path> [--api-base-url <url>] --username <user> --password <pass>",
  );
  console.log("");
  console.log("Options:");
  console.log("  --folder <path>        Folder or single workbook file to process");
  console.log("  --api-base-url <url>   Backend base URL, defaults to http://127.0.0.1:<PORT>");
  console.log("  --token <jwt>          Use an existing backend JWT");
  console.log("  --username <value>     Backend username for /auth/signin");
  console.log("  --password <value>     Backend password for /auth/signin");
  console.log("  --dry-run              Resolve item matches without uploading");
  console.log("  --no-recursive         Only scan the top-level folder");
  console.log("  --isaa-layout          Scan only <vendor>/<item_code item_name>/*.xlsx and validate folder codes");
  console.log("  --report <path>        ISAA exception .xlsx path (defaults to workspace outputs)");
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

  if (options.isaaLayout) {
    await runIsaaLayoutUpload({ options, targetPath });
    return;
  }

  const workbookFiles = await collectWorkbookFiles(targetPath, {
    recursive: options.recursive,
  });

  if (workbookFiles.length === 0) {
    throw new Error(`No .xlsx or .xls files found in ${targetPath}`);
  }

  const token = await resolveAccessToken(options);

  console.log(`Backend   : ${options.apiBaseUrl}`);
  console.log(`Target    : ${targetPath}`);
  console.log(`Workbooks : ${workbookFiles.length}`);
  console.log(`Recursive : ${options.recursive ? "yes" : "no"}`);
  console.log(`Mode      : ${options.dryRun ? "dry-run" : "upload"}`);

  const summary = {
    total: workbookFiles.length,
    uploaded: 0,
    dryRunMatched: 0,
    missingCode: 0,
    missingItem: 0,
    failed: 0,
  };

  for (const filePath of workbookFiles) {
    const relativeFilePath = path.relative(targetPath, filePath) || path.basename(filePath);
    const itemCode = extractItemCodeFromWorkbook(filePath);

    if (!itemCode) {
      summary.missingCode += 1;
      console.warn(`[missing-code] ${relativeFilePath}`);
      continue;
    }

    let item = null;
    try {
      item = await findItemByCode({
        apiBaseUrl: options.apiBaseUrl,
        token,
        code: itemCode,
      });
    } catch (error) {
      summary.failed += 1;
      console.error(
        `[lookup-failed] ${relativeFilePath} -> ${itemCode} :: ${error.message}`,
      );
      continue;
    }

    if (!item?._id) {
      summary.missingItem += 1;
      console.warn(`[missing-item] ${relativeFilePath} -> ${itemCode}`);
      continue;
    }

    if (options.dryRun) {
      summary.dryRunMatched += 1;
      console.log(`[matched] ${relativeFilePath} -> ${itemCode} -> ${item._id}`);
      continue;
    }

    try {
      const response = await uploadPisWorkbook({
        apiBaseUrl: options.apiBaseUrl,
        token,
        itemId: item._id,
        filePath,
      });
      summary.uploaded += 1;
      console.log(
        `[uploaded] ${relativeFilePath} -> ${itemCode} -> ${item._id} -> ${normalizeText(response?.data?.pis_file?.key)}`,
      );
    } catch (error) {
      summary.failed += 1;
      console.error(
        `[upload-failed] ${relativeFilePath} -> ${itemCode} -> ${item._id} :: ${error.message}`,
      );
    }
  }

  console.log("");
  console.log("Summary");
  console.log(`  Total        : ${summary.total}`);
  console.log(`  Uploaded     : ${summary.uploaded}`);
  console.log(`  Dry-run hits : ${summary.dryRunMatched}`);
  console.log(`  Missing code : ${summary.missingCode}`);
  console.log(`  Missing item : ${summary.missingItem}`);
  console.log(`  Failed       : ${summary.failed}`);

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error("Batch PIS upload failed:", error?.message || error);
    process.exit(1);
  });
}

module.exports = {
  collectIsaaWorkbookFiles,
  deriveIsaaFolderCode,
  evaluateIsaaCandidate,
  validateIsaaCandidate,
};
