const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const sharp = require("sharp");
const {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} = require("@zxing/library");

const execFileAsync = promisify(execFile);

const DEFAULT_SCAN_TIMEOUT_MS = 120000;
const DEFAULT_SCAN_MAX_BUFFER = 10 * 1024 * 1024;
const DEFAULT_PDF_RENDER_DPI = 300;
const DEFAULT_MAX_PDF_SCAN_PAGES = 5;
const DEFAULT_UPSCALE_WIDTH = 2200;
const TEMP_DIR_PREFIX = path.join(process.env.OMS_TEMP_DIR || os.tmpdir(), "oms-barcode-scan-");

const BARCODE_FORMATS = Object.freeze([
  BarcodeFormat.CODE_128,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
]);

const BARCODE_IMAGE_VARIANTS = Object.freeze([
  { label: "auto", rotate: "auto", width: null, invert: false },
  { label: "auto-upscaled", rotate: "auto", width: DEFAULT_UPSCALE_WIDTH, invert: false },
  { label: "auto-inverted", rotate: "auto", width: null, invert: true },
  {
    label: "auto-upscaled-inverted",
    rotate: "auto",
    width: DEFAULT_UPSCALE_WIDTH,
    invert: true,
  },
  { label: "rotate-90-upscaled", rotate: 90, width: DEFAULT_UPSCALE_WIDTH, invert: false },
  {
    label: "rotate-90-upscaled-inverted",
    rotate: 90,
    width: DEFAULT_UPSCALE_WIDTH,
    invert: true,
  },
  { label: "rotate-180-upscaled", rotate: 180, width: DEFAULT_UPSCALE_WIDTH, invert: false },
  {
    label: "rotate-180-upscaled-inverted",
    rotate: 180,
    width: DEFAULT_UPSCALE_WIDTH,
    invert: true,
  },
  { label: "rotate-270-upscaled", rotate: 270, width: DEFAULT_UPSCALE_WIDTH, invert: false },
  {
    label: "rotate-270-upscaled-inverted",
    rotate: 270,
    width: DEFAULT_UPSCALE_WIDTH,
    invert: true,
  },
]);

const PDFINFO_BINARIES = Object.freeze([
  process.env.PDFINFO_BIN,
  "pdfinfo",
  "/usr/bin/pdfinfo",
  "/usr/local/bin/pdfinfo",
]);

const PDFTOPPM_BINARIES = Object.freeze([
  process.env.PDFTOPPM_BIN,
  "pdftoppm",
  "/usr/bin/pdftoppm",
  "/usr/local/bin/pdftoppm",
]);

const BARCODE_SCAN_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(String(process.env.BARCODE_SCAN_TIMEOUT_MS || DEFAULT_SCAN_TIMEOUT_MS), 10)
    || DEFAULT_SCAN_TIMEOUT_MS,
);

const BARCODE_SCAN_MAX_BUFFER = Math.max(
  1024 * 1024,
  Number.parseInt(String(process.env.BARCODE_SCAN_MAX_BUFFER || DEFAULT_SCAN_MAX_BUFFER), 10)
    || DEFAULT_SCAN_MAX_BUFFER,
);

const PDF_RENDER_DPI = Math.max(
  72,
  Number.parseInt(String(process.env.BARCODE_SCAN_PDF_DPI || DEFAULT_PDF_RENDER_DPI), 10)
    || DEFAULT_PDF_RENDER_DPI,
);

const MAX_PDF_SCAN_PAGES = Math.max(
  1,
  Number.parseInt(String(process.env.BARCODE_SCAN_MAX_PDF_PAGES || DEFAULT_MAX_PDF_SCAN_PAGES), 10)
    || DEFAULT_MAX_PDF_SCAN_PAGES,
);

const normalizeText = (value) => String(value ?? "").trim();

const normalizeMimeType = (value = "") => normalizeText(value).toLowerCase();

const normalizeExtension = (value = "") =>
  path.extname(String(value || "")).toLowerCase();

const isPdfFile = (file = {}) => {
  const mimeType = normalizeMimeType(file?.mimetype);
  const extension = normalizeExtension(file?.originalname || file?.path || "");
  return mimeType === "application/pdf" || extension === ".pdf";
};

const isImageFile = (file = {}) => {
  const mimeType = normalizeMimeType(file?.mimetype);
  const extension = normalizeExtension(file?.originalname || file?.path || "");

  return (
    mimeType.startsWith("image/") ||
    [".jpg", ".jpeg", ".png", ".webp"].includes(extension)
  );
};

const createBarcodeScanError = (
  message,
  { statusCode = 400, code = "BARCODE_SCAN_ERROR", details = "" } = {},
) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) {
    error.details = details;
  }
  return error;
};

const getDecodeHints = () => {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, BARCODE_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
};

const execWithBinaryCandidates = async ({
  candidates = [],
  args = [],
  description = "command",
  allowMissingBinary = false,
} = {}) => {
  const attempted = [];
  let lastError = null;

  for (const binaryPath of [...new Set(
    (Array.isArray(candidates) ? candidates : [candidates])
      .map((candidate) => normalizeText(candidate))
      .filter(Boolean),
  )]) {
    attempted.push(binaryPath);

    try {
      return await execFileAsync(binaryPath, args, {
        timeout: BARCODE_SCAN_TIMEOUT_MS,
        maxBuffer: BARCODE_SCAN_MAX_BUFFER,
      });
    } catch (error) {
      lastError = error;
      if (error?.code === "ENOENT") {
        continue;
      }

      if (
        error?.killed ||
        error?.signal === "SIGTERM" ||
        /timed out/i.test(String(error?.message || ""))
      ) {
        throw createBarcodeScanError(`${description} timed out`, {
          statusCode: 503,
          code: `${description.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_TIMEOUT`,
          details: `Command: ${binaryPath}`,
        });
      }

      throw error;
    }
  }

  if (allowMissingBinary) {
    return null;
  }

  throw createBarcodeScanError(
    `${description} is not available on the server`,
    {
      statusCode: 503,
      code: `${description.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_NOT_FOUND`,
      details: `Attempted: ${attempted.join(", ") || "none"}`,
    },
  );
};

const getPdfPageCount = async (pdfPath = "") => {
  const result = await execWithBinaryCandidates({
    candidates: PDFINFO_BINARIES,
    args: [pdfPath],
    description: "pdfinfo",
    allowMissingBinary: true,
  });

  if (!result) {
    return null;
  }

  const match = String(result.stdout || "").match(/^\s*Pages:\s*(\d+)/mi);
  if (!match) {
    return null;
  }

  const pageCount = Number(match[1]);
  return Number.isInteger(pageCount) && pageCount > 0 ? pageCount : null;
};

const readRenderedPdfPageBuffer = async (outputDir = "", outputPrefix = "") => {
  const normalizedDir = normalizeText(outputDir);
  const normalizedPrefix = path.basename(normalizeText(outputPrefix));
  if (!normalizedDir || !normalizedPrefix) {
    return null;
  }

  const entries = await fs.readdir(normalizedDir).catch(() => []);
  const matches = entries
    .filter((entry) => entry.startsWith(normalizedPrefix))
    .filter((entry) => /\.(png|pnm|ppm|jpg|jpeg)$/i.test(entry))
    .sort((left, right) => left.localeCompare(right));

  if (matches.length === 0) {
    return null;
  }

  const renderedPath = path.join(normalizedDir, matches[0]);
  return fs.readFile(renderedPath);
};

const isPdfPageOutOfRangeError = (error = {}) => {
  const errorText = [
    error?.stderr,
    error?.stdout,
    error?.message,
  ]
    .map((chunk) => String(chunk || "").trim())
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();

  return (
    errorText.includes("page range") ||
    errorText.includes("out of range") ||
    errorText.includes("no page") ||
    errorText.includes("wrong page")
  );
};

const renderPdfPageToBuffer = async ({
  pdfPath = "",
  pageNumber = 1,
  outputDir = "",
} = {}) => {
  const normalizedPdfPath = normalizeText(pdfPath);
  const normalizedOutputDir = normalizeText(outputDir);
  if (!normalizedPdfPath || !normalizedOutputDir) {
    throw createBarcodeScanError("PDF render output directory is missing", {
      statusCode: 500,
      code: "PDF_RENDER_OUTPUT_MISSING",
    });
  }

  const outputPrefix = path.join(normalizedOutputDir, `page-${pageNumber}`);
  await execWithBinaryCandidates({
    candidates: PDFTOPPM_BINARIES,
    args: [
      "-png",
      "-singlefile",
      "-f",
      String(pageNumber),
      "-l",
      String(pageNumber),
      "-r",
      String(PDF_RENDER_DPI),
      normalizedPdfPath,
      outputPrefix,
    ],
    description: "pdftoppm",
  });

  const renderedBuffer = await readRenderedPdfPageBuffer(normalizedOutputDir, outputPrefix);
  if (!renderedBuffer) {
    throw createBarcodeScanError("Rendered PDF page image was not created", {
      statusCode: 500,
      code: "PDF_RENDER_OUTPUT_MISSING",
      details: `Page ${pageNumber}`,
    });
  }

  return renderedBuffer;
};

const scanImageBufferForBarcode = async (inputBuffer = null) => {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
    throw createBarcodeScanError("Uploaded barcode file is empty", {
      statusCode: 400,
      code: "BARCODE_EMPTY_FILE",
    });
  }

  let lastError = null;

  for (const variant of BARCODE_IMAGE_VARIANTS) {
    try {
      let pipeline = sharp(inputBuffer, { failOnError: false });

      if (variant.rotate === "auto") {
        pipeline = pipeline.rotate();
      } else if (Number.isFinite(variant.rotate)) {
        pipeline = pipeline.rotate(variant.rotate);
      }

      if (variant.width) {
        pipeline = pipeline.resize({
          width: variant.width,
          withoutEnlargement: false,
        });
      }

      pipeline = pipeline.greyscale().normalize();

      if (variant.invert) {
        pipeline = pipeline.negate();
      }

      const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
      const luminanceSource = new RGBLuminanceSource(data, info.width, info.height);
      const bitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
      const reader = new MultiFormatReader();
      const result = reader.decode(bitmap, getDecodeHints());

      const rawText = normalizeText(result?.getText?.() || result?.text || "");
      const barcode = rawText.replace(/\D/g, "");
      if (!barcode) {
        throw createBarcodeScanError("Detected barcode does not contain numeric digits", {
          statusCode: 422,
          code: "BARCODE_NUMERIC_REQUIRED",
          details: `Variant: ${variant.label}`,
        });
      }

      const barcodeFormatValue = result?.getBarcodeFormat?.();
      const barcodeFormat =
        typeof barcodeFormatValue === "number"
          ? BarcodeFormat[barcodeFormatValue] || null
          : barcodeFormatValue || null;

      return {
        barcode,
        rawText,
        barcodeFormat,
        variant: variant.label,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw createBarcodeScanError(
    "Could not detect a barcode in the uploaded image.",
    {
      statusCode: 422,
      code: "BARCODE_NOT_FOUND",
      details: lastError?.message || "",
    },
  );
};

const scanPdfBufferForBarcode = async (inputBuffer = null) => {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
    throw createBarcodeScanError("Uploaded barcode file is empty", {
      statusCode: 400,
      code: "BARCODE_EMPTY_FILE",
    });
  }

  const tempDir = await fs.mkdtemp(TEMP_DIR_PREFIX);
  const pdfPath = path.join(tempDir, "barcode-upload.pdf");

  try {
    await fs.writeFile(pdfPath, inputBuffer);

    const pageCount = await getPdfPageCount(pdfPath);
    const pagesToScan = Number.isInteger(pageCount)
      ? Math.min(pageCount, MAX_PDF_SCAN_PAGES)
      : MAX_PDF_SCAN_PAGES;

    let lastError = null;
    for (let pageNumber = 1; pageNumber <= pagesToScan; pageNumber += 1) {
      let renderedBuffer;
      try {
        renderedBuffer = await renderPdfPageToBuffer({
          pdfPath,
          pageNumber,
          outputDir: tempDir,
        });
      } catch (error) {
        if (!Number.isInteger(pageCount) && isPdfPageOutOfRangeError(error)) {
          break;
        }
        throw error;
      }

      try {
        const scanResult = await scanImageBufferForBarcode(renderedBuffer);
        return {
          ...scanResult,
          sourceType: "pdf",
          pageNumber,
        };
      } catch (error) {
        lastError = error;
        if (error?.statusCode && error.statusCode >= 500) {
          throw error;
        }
      }
    }

    throw createBarcodeScanError(
      "Could not detect a barcode in the uploaded PDF.",
      {
        statusCode: 422,
        code: "BARCODE_NOT_FOUND",
        details: lastError?.message || "",
      },
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
};

const scanBarcodeFromUpload = async (file = null) => {
  const fileBuffer = file?.buffer;

  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw createBarcodeScanError("Uploaded barcode file is empty", {
      statusCode: 400,
      code: "BARCODE_EMPTY_FILE",
    });
  }

  if (isPdfFile(file)) {
    return scanPdfBufferForBarcode(fileBuffer);
  }

  if (isImageFile(file)) {
    return {
      ...(await scanImageBufferForBarcode(fileBuffer)),
      sourceType: "image",
    };
  }

  throw createBarcodeScanError(
    "Only JPG, JPEG, PNG, WEBP, and PDF barcode uploads are supported.",
    {
      statusCode: 400,
      code: "BARCODE_UNSUPPORTED_FILE_TYPE",
    },
  );
};

module.exports = {
  scanBarcodeFromUpload,
  scanImageBufferForBarcode,
  scanPdfBufferForBarcode,
};
