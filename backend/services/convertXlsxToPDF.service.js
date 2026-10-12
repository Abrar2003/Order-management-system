const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { pathToFileURL } = require("url");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { renderPdf } = require("./pdfRenderer");

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_EXEC_BUFFER = 10 * 1024 * 1024;
const LIBREOFFICE_BINARY_CANDIDATES = Object.freeze([
  process.env.LIBREOFFICE_BIN,
  process.env.LIBREOFFICE_BINARY,
  process.env.SOFFICE_BIN,
  process.env.SOFFICE_PATH,
  "soffice",
  "libreoffice",
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
  "/usr/lib/libreoffice/program/soffice",
  "/snap/bin/libreoffice",
  "C:/Program Files/LibreOffice/program/soffice.exe",
]);

const createConversionError = (
  message,
  { code = "PDF_CONVERSION_ERROR", statusCode, details = "" } = {},
) => {
  const error = new Error(message);
  error.code = code;
  if (Number.isInteger(statusCode)) {
    error.statusCode = statusCode;
  }
  if (details) {
    error.details = details;
  }
  return error;
};

const sanitizeBaseName = (value = "", fallback = "spreadsheet") => {
  const safeValue = String(value || "")
    .trim()
    .replace(/\.[^.]+$/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return safeValue || fallback;
};

const normalizeOriginalName = (value = "", fallbackExtension = ".xlsx") => {
  const originalName = path.basename(String(value || "").trim()) || "spreadsheet.xlsx";
  const extension = path.extname(originalName).toLowerCase() || fallbackExtension;
  return `${sanitizeBaseName(path.parse(originalName).name, "spreadsheet")}${extension}`;
};

const readHtmlOutput = async (outputDir, expectedHtmlName) => {
  const expectedHtmlPath = path.join(outputDir, expectedHtmlName);
  const expectedStats = await fs.stat(expectedHtmlPath).catch(() => null);
  if (expectedStats?.isFile()) {
    return {
      htmlPath: expectedHtmlPath,
      htmlFileName: expectedHtmlName,
      htmlStats: expectedStats,
    };
  }

  const outputEntries = await fs.readdir(outputDir).catch(() => []);
  const htmlEntries = outputEntries.filter(
    (entry) => [".html", ".htm"].includes(path.extname(entry).toLowerCase()),
  );

  if (htmlEntries.length === 0) {
    throw createConversionError("Spreadsheet HTML preview was not created", {
      code: "HTML_OUTPUT_MISSING",
    });
  }

  const htmlFileName = htmlEntries.includes(expectedHtmlName)
    ? expectedHtmlName
    : htmlEntries[0];
  const htmlPath = path.join(outputDir, htmlFileName);
  const htmlStats = await fs.stat(htmlPath);

  return {
    htmlPath,
    htmlFileName,
    htmlStats,
  };
};

const readPdfOutput = async (outputDir, expectedPdfName) => {
  const expectedPdfPath = path.join(outputDir, expectedPdfName);
  const expectedStats = await fs.stat(expectedPdfPath).catch(() => null);
  if (expectedStats?.isFile() && expectedStats.size > 0) {
    return {
      pdfPath: expectedPdfPath,
      pdfFileName: expectedPdfName,
      pdfStats: expectedStats,
    };
  }

  const outputEntries = await fs.readdir(outputDir).catch(() => []);
  const pdfEntries = outputEntries.filter(
    (entry) => path.extname(entry).toLowerCase() === ".pdf",
  );
  if (pdfEntries.length === 0) {
    throw createConversionError("Spreadsheet PDF was not created", {
      code: "PDF_OUTPUT_MISSING",
    });
  }

  for (const pdfFileName of pdfEntries) {
    const pdfPath = path.join(outputDir, pdfFileName);
    const pdfStats = await fs.stat(pdfPath).catch(() => null);
    if (pdfStats?.isFile() && pdfStats.size > 0) {
      return { pdfPath, pdfFileName, pdfStats };
    }
  }

  throw createConversionError("Generated spreadsheet PDF is empty", {
    code: "EMPTY_GENERATED_PDF",
  });
};

const cleanupConversionArtifacts = async ({
  inputFilePath = "",
  workDir = "",
  profileDir = "",
} = {}) => {
  const cleanupTargets = [
    { targetPath: inputFilePath, recursive: false },
    { targetPath: workDir, recursive: true },
    { targetPath: profileDir, recursive: true },
  ].filter(({ targetPath }) => Boolean(String(targetPath || "").trim()));

  const results = await Promise.allSettled(
    cleanupTargets.map(({ targetPath, recursive }) =>
      fs.rm(targetPath, { recursive, force: true }),
    ),
  );

  const failures = results
    .map((result, index) => ({
      result,
      targetPath: cleanupTargets[index]?.targetPath,
    }))
    .filter(({ result }) => result.status === "rejected");

  if (failures.length > 0) {
    throw createConversionError("Spreadsheet conversion cleanup failed", {
      code: "PDF_CLEANUP_FAILED",
      details: failures
        .map(
          ({ result, targetPath }) =>
            `${targetPath}: ${result.reason?.message || String(result.reason)}`,
        )
        .join("; "),
    });
  }
};

const getLibreOfficeBinaryCandidates = () => [...new Set(
  LIBREOFFICE_BINARY_CANDIDATES
    .map((candidate) => String(candidate || "").trim())
    .filter(Boolean),
)];

const sandboxCommand = async (binaryPath, args, workDir) => {
  if (process.platform !== "linux") throw createConversionError("Private Office previews require the Linux conversion sandbox", { statusCode: 503 });
  const mounts = [];
  for (const dir of ["/usr", "/bin", "/lib", "/lib64", "/etc/fonts", "/etc/libreoffice", "/var/cache/fontconfig"]) {
    if (await fs.stat(dir).catch(() => null)) mounts.push("--ro-bind", dir, dir);
  }
  return { command: "/usr/bin/prlimit", args: ["--as=2147483648", "--cpu=60", "--nofile=256", "--fsize=52428800", "--", "/usr/bin/bwrap", "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv", ...mounts, "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--bind", workDir, workDir, "--setenv", "HOME", workDir, "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "LANG", "C.UTF-8", "--setenv", "SAL_USE_VCLPLUGIN", "svp", "--chdir", workDir, "--", binaryPath, ...args] };
};
const runLibreOfficeConversion = async (args, { timeoutMs, sandboxDir } = {}) => {
  const attemptedCommands = [];
  const binaryCandidates = getLibreOfficeBinaryCandidates();

  for (const binaryPath of binaryCandidates) {
    attemptedCommands.push(binaryPath);

    try {
      const invocation = sandboxDir ? await sandboxCommand(binaryPath, args, sandboxDir) : { command: binaryPath, args };
      await execFileAsync(invocation.command, invocation.args, {
        timeout: timeoutMs,
        maxBuffer: MAX_EXEC_BUFFER,
        ...(sandboxDir ? { env: { PATH: "/usr/bin:/bin" } } : {}),
      });

      return binaryPath;
    } catch (error) {
      if (sandboxDir) throw createConversionError(error?.killed || error?.signal ? "Office preview timed out. Download the original or try a smaller file." : "Office preview conversion is unavailable or this file is corrupt/password-protected. Ask an admin to check LibreOffice and the sandbox.", { statusCode: error?.statusCode || 503, code: "OFFICE_PREVIEW_FAILED" });
      if (error?.code === "ENOENT") {
        continue;
      }

      if (
        error?.killed
        || error?.signal === "SIGTERM"
        || /timed out/i.test(String(error?.message || ""))
      ) {
        throw createConversionError("Spreadsheet conversion timed out", {
          code: "SOFFICE_TIMEOUT",
          details: `LibreOffice command: ${binaryPath}`,
        });
      }

      const commandOutput = [error?.stdout, error?.stderr]
        .map((chunk) => String(chunk || "").trim())
        .filter(Boolean)
        .join(" | ");

      throw createConversionError(
        "Uploaded spreadsheet could not be converted to PDF",
        {
          code: "SOFFICE_CONVERSION_FAILED",
          statusCode: 400,
          details: [
            `LibreOffice command: ${binaryPath}`,
            commandOutput,
          ]
            .filter(Boolean)
            .join(" | "),
        },
      );
    }
  }

  throw createConversionError(
    "LibreOffice command is not available on the server. Install LibreOffice or set LIBREOFFICE_BIN to the executable path.",
    {
      code: "SOFFICE_NOT_FOUND",
      details: [
        `Attempted: ${attemptedCommands.join(", ") || "none"}`,
        `PATH: ${String(process.env.PATH || "").trim() || "(empty)"}`,
      ].join(" | "),
    },
  );
};

async function convertExcelToPdf(inputOrOptions = {}) {
  const options =
    typeof inputOrOptions === "string"
      ? { inputFilePath: inputOrOptions }
      : inputOrOptions || {};

  const timeoutMs = Math.max(
    1000,
    Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS,
  );
  const inputFileName = normalizeOriginalName(
    options.originalName || options.inputFilePath,
  );
  const inputExtension = path.extname(inputFileName).toLowerCase() || ".xlsx";
  const jobId = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  const workDir = path.join(os.tmpdir(), `xlsx-pdf-${jobId}`);
  const inputDir = path.join(workDir, "input");
  const outputDir = path.join(workDir, "output");
  const profileDir = path.join(os.tmpdir(), `libreoffice-profile-${jobId}`);
  const stagedInputPath = path.join(
    inputDir,
    `${sanitizeBaseName(path.parse(inputFileName).name, "spreadsheet")}${inputExtension}`,
  );
  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });

  try {
    if (Buffer.isBuffer(options.buffer)) {
      if (options.buffer.length === 0) {
        throw createConversionError("Spreadsheet upload is empty", {
          code: "EMPTY_SPREADSHEET_UPLOAD",
          statusCode: 400,
        });
      }

      await fs.writeFile(stagedInputPath, options.buffer);
    } else if (options.inputFilePath) {
      await fs.copyFile(options.inputFilePath, stagedInputPath);
    } else {
      throw createConversionError("Spreadsheet input is required", {
        code: "MISSING_SPREADSHEET_INPUT",
        statusCode: 400,
      });
    }

    const inputStats = await fs.stat(stagedInputPath);
    if (!inputStats.isFile() || inputStats.size <= 0) {
      throw createConversionError("Spreadsheet upload is empty", {
        code: "EMPTY_SPREADSHEET_INPUT",
        statusCode: 400,
      });
    }

    const commonArgs = [
      "--headless",
      "--nologo",
      "--nodefault",
      "--nofirststartwizard",
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    ];
    const htmlArgs = [
      ...commonArgs,
      "--convert-to",
      "html:HTML",
      "--outdir",
      outputDir,
      stagedInputPath,
    ];

    let libreOfficeCommand = await runLibreOfficeConversion(htmlArgs, { timeoutMs });
    let pdfBuffer;
    let pdfPath = "";
    let conversionMode = "html_chromium";

    try {
      const htmlOutput = await readHtmlOutput(
        outputDir,
        `${path.parse(path.basename(stagedInputPath)).name}.html`,
      );
      const spreadsheetHtml = await fs.readFile(htmlOutput.htmlPath, "utf8");
      pdfBuffer = await renderPdf({
        html: spreadsheetHtml,
        format: "A4",
        landscape: true,
        margin: {
          top: "8mm",
          right: "8mm",
          bottom: "8mm",
          left: "8mm",
        },
        basePath: outputDir,
        extraCss: `
          table { break-inside: auto !important; }
          tr { break-inside: avoid !important; page-break-inside: avoid !important; }
        `,
      });
    } catch (error) {
      if (error?.code !== "HTML_OUTPUT_MISSING") throw error;

      console.warn(
        "Spreadsheet HTML preview was not created; falling back to direct PDF conversion",
      );
      const pdfArgs = [
        ...commonArgs,
        "--convert-to",
        "pdf",
        "--outdir",
        outputDir,
        stagedInputPath,
      ];
      libreOfficeCommand = await runLibreOfficeConversion(pdfArgs, { timeoutMs });
      const pdfOutput = await readPdfOutput(
        outputDir,
        `${path.parse(path.basename(stagedInputPath)).name}.pdf`,
      );
      pdfPath = pdfOutput.pdfPath;
      pdfBuffer = await fs.readFile(pdfOutput.pdfPath);
      conversionMode = "libreoffice_pdf";
    }

    if (pdfBuffer.length <= 0) {
      throw createConversionError("Generated PDF is empty", {
        code: "EMPTY_GENERATED_PDF",
      });
    }

    return {
      workDir,
      inputDir,
      outputDir,
      profileDir,
      inputFilePath: stagedInputPath,
      pdfPath,
      pdfFileName: `${path.parse(inputFileName).name}.pdf`,
      libreOfficeCommand,
      conversionMode,
      pdfBuffer,
      size: pdfBuffer.length,
      cleanup: async () =>
        cleanupConversionArtifacts({
          inputFilePath: stagedInputPath,
          workDir,
          profileDir,
        }),
    };
  } catch (error) {
    try {
      await cleanupConversionArtifacts({
        inputFilePath: stagedInputPath,
        workDir,
        profileDir,
      });
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
    }

    throw error;
  }
}

async function convertOfficeToPdf({ buffer, originalName, runOffice = runLibreOfficeConversion, timeoutMs = 60000 }) {
  const { fileMime } = require("./eudrFiles.service");
  const extension = path.extname(String(originalName)).toLowerCase();
  if (![".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt"].includes(extension) || !fileMime(originalName) || !Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 50 * 1024 * 1024) throw createConversionError("Unsupported or oversized Office document", { statusCode: 400 });
  if ([".docx", ".xlsx"].includes(extension)) {
    try {
      const zip = new (require("adm-zip"))(buffer);
      if (zip.getEntries().some((entry) => /vbaProject|macros\/|externalLinks\/|embeddings\//i.test(entry.entryName))) throw new Error("Active content is not allowed");
    } catch { throw createConversionError("This Office document is invalid or contains active content. Upload a non-macro document or PDF.", { statusCode: 400 }); }
  }
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "eudr-preview-"));
  try {
    const profileDir = path.join(workDir, "profile");
    const outputDir = path.join(workDir, "output");
    await fs.mkdir(path.join(profileDir, "user"), { recursive: true });
    await fs.mkdir(outputDir);
    await fs.writeFile(path.join(profileDir, "user", "registrymodifications.xcu"), '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop><prop oor:name="DisableActiveContent" oor:op="fuse"><value>true</value></prop><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item><item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>1</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop><prop oor:name="Field" oor:op="fuse"><value>false</value></prop></item></oor:items>');
    const input = path.join(workDir, `document${extension}`);
    await fs.writeFile(input, buffer);
    // Calc's single-page-per-sheet export includes sheets even when saved print areas would hide cells.
    const filter = [".xls", ".xlsx", ".csv"].includes(extension) ? 'pdf:calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"true"}}' : "pdf:writer_pdf_Export";
    await runOffice(["--headless", "--nologo", "--nodefault", "--nofirststartwizard", `-env:UserInstallation=${pathToFileURL(profileDir).href}`, "--convert-to", filter, "--outdir", outputDir, input], { timeoutMs, sandboxDir: workDir });
    const output = await readPdfOutput(outputDir, "document.pdf").catch(() => { throw createConversionError("No preview was created. This file may be corrupt, encrypted or password-protected. Download the original or upload a PDF.", { statusCode: 422 }); });
    if (output.pdfStats.size > 50 * 1024 * 1024) throw createConversionError("Converted preview is too large", { statusCode: 413 });
    const result = await fs.readFile(output.pdfPath);
    if (result.subarray(0, 5).toString() !== "%PDF-") throw createConversionError("Office preview could not be rendered", { statusCode: 422 });
    return result;
  } finally { await fs.rm(workDir, { recursive: true, force: true }); }
}

module.exports = { convertExcelToPdf, convertOfficeToPdf, runLibreOfficeConversion, sandboxCommand };
