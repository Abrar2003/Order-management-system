const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { pathToFileURL } = require("url");
const { execFile } = require("child_process");
const { promisify } = require("util");

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

const readPdfOutput = async (outputDir, expectedPdfName) => {
  const expectedPdfPath = path.join(outputDir, expectedPdfName);
  const expectedStats = await fs.stat(expectedPdfPath).catch(() => null);
  if (expectedStats?.isFile()) {
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
    throw createConversionError("Generated PDF file was not created", {
      code: "PDF_OUTPUT_MISSING",
    });
  }

  const pdfFileName = pdfEntries.includes(expectedPdfName)
    ? expectedPdfName
    : pdfEntries[0];
  const pdfPath = path.join(outputDir, pdfFileName);
  const pdfStats = await fs.stat(pdfPath);

  return {
    pdfPath,
    pdfFileName,
    pdfStats,
  };
};

const cleanupConversionArtifacts = async ({
  inputFilePath = "",
  pdfPath = "",
  workDir = "",
  profileDir = "",
} = {}) => {
  const cleanupTargets = [
    { targetPath: inputFilePath, recursive: false },
    { targetPath: pdfPath, recursive: false },
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

const runLibreOfficeConversion = async (args, { timeoutMs }) => {
  const attemptedCommands = [];
  const binaryCandidates = getLibreOfficeBinaryCandidates();

  for (const binaryPath of binaryCandidates) {
    attemptedCommands.push(binaryPath);

    try {
      await execFileAsync(binaryPath, args, {
        timeout: timeoutMs,
        maxBuffer: MAX_EXEC_BUFFER,
      });

      return binaryPath;
    } catch (error) {
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
  let pdfPath = "";

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

    const args = [
      "--headless",
      "--nologo",
      "--nodefault",
      "--nofirststartwizard",
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      "--convert-to",
      "pdf:calc_pdf_Export",
      "--outdir",
      outputDir,
      stagedInputPath,
    ];

    const libreOfficeCommand = await runLibreOfficeConversion(args, { timeoutMs });

    const pdfOutput = await readPdfOutput(
      outputDir,
      `${path.parse(path.basename(stagedInputPath)).name}.pdf`,
    );

    pdfPath = pdfOutput.pdfPath;
    if (!pdfOutput.pdfStats.isFile() || pdfOutput.pdfStats.size <= 0) {
      throw createConversionError("Generated PDF is empty", {
        code: "EMPTY_GENERATED_PDF",
      });
    }

    const pdfBuffer = await fs.readFile(pdfPath);
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
      pdfFileName: pdfOutput.pdfFileName,
      libreOfficeCommand,
      pdfBuffer,
      size: pdfBuffer.length,
      cleanup: async () =>
        cleanupConversionArtifacts({
          inputFilePath: stagedInputPath,
          pdfPath,
          workDir,
          profileDir,
        }),
    };
  } catch (error) {
    try {
      await cleanupConversionArtifacts({
        inputFilePath: stagedInputPath,
        pdfPath,
        workDir,
        profileDir,
      });
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
    }

    throw error;
  }
}

module.exports = { convertExcelToPdf };
