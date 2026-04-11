const fs = require("fs/promises");
const path = require("path");
const XLSX = require("xlsx");

const { loadEnvFiles } = require("../config/loadEnv");

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

main().catch((error) => {
  console.error("Batch PIS upload failed:", error?.message || error);
  process.exit(1);
});
