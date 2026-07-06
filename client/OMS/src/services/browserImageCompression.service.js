const DEFAULT_MAX_DIMENSION = 2200;
const DEFAULT_QUALITY = 0.78;

const COMPRESSIBLE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif"]);
const HEIC_EXTENSIONS = [".heic", ".heif"];

const normalizeText = (value) => String(value ?? "").trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();

export const isHeicOrHeifFile = (file = {}) => {
  const type = normalizeKey(file?.type);
  const name = normalizeKey(file?.name);
  return HEIC_MIME_TYPES.has(type) || HEIC_EXTENSIONS.some((extension) => name.endsWith(extension));
};

const loadImageBitmap = async (file) => {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Browser could not decode image"));
      img.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const canvasToBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Browser image compression failed"));
        return;
      }
      resolve(blob);
    }, type, quality);
  });

const withExtension = (fileName = "qc-image", extension = ".jpg") => {
  const baseName = normalizeText(fileName).replace(/\.[^.]+$/g, "") || "qc-image";
  return `${baseName}${extension}`;
};

export const compressBrowserQcImage = async ({
  file,
  maxDimension = DEFAULT_MAX_DIMENSION,
  quality = DEFAULT_QUALITY,
} = {}) => {
  if (!file || !(file instanceof File)) {
    throw new Error("A browser File is required for QC image compression");
  }

  const inputType = normalizeKey(file.type);
  if (isHeicOrHeifFile(file)) {
    return {
      file,
      optimized: false,
      bytesSaved: 0,
      skippedCompressionReason: "heic_source",
    };
  }
  if (!COMPRESSIBLE_MIME_TYPES.has(inputType)) {
    return {
      file,
      optimized: false,
      bytesSaved: 0,
      skippedCompressionReason: "unsupported_browser_compression",
    };
  }

  let image = null;
  try {
    image = await loadImageBitmap(file);
    const width = Number(image.width || image.naturalWidth || 0);
    const height = Number(image.height || image.naturalHeight || 0);
    if (!width || !height) {
      throw new Error("Browser could not read image dimensions");
    }

    const scale = Math.min(1, Number(maxDimension || DEFAULT_MAX_DIMENSION) / Math.max(width, height));
    const outputWidth = Math.max(1, Math.round(width * scale));
    const outputHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d", { alpha: inputType === "image/png" });
    if (!context) {
      throw new Error("Browser canvas is unavailable");
    }

    context.drawImage(image, 0, 0, outputWidth, outputHeight);
    const outputType = inputType === "image/jpeg" ? "image/jpeg" : "image/webp";
    const outputExtension = outputType === "image/jpeg" ? ".jpg" : ".webp";
    const blob = await canvasToBlob(canvas, outputType, Number(quality || DEFAULT_QUALITY));
    if (!blob || blob.size <= 0 || blob.size >= file.size) {
      return {
        file,
        optimized: false,
        bytesSaved: 0,
        skippedCompressionReason: "compressed_not_smaller",
      };
    }

    return {
      file: new File([blob], withExtension(file.name, outputExtension), {
        type: outputType,
        lastModified: Date.now(),
      }),
      optimized: true,
      bytesSaved: Math.max(0, file.size - blob.size),
      skippedCompressionReason: "",
    };
  } catch (error) {
    return {
      file,
      optimized: false,
      bytesSaved: 0,
      skippedCompressionReason: error?.message || "compression_failed",
    };
  } finally {
    if (image && typeof image.close === "function") {
      image.close();
    }
  }
};
