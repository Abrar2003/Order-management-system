const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const normalizeText = (value) => String(value ?? "").trim();

const main = async () => {
  const fixturePath = normalizeText(
    process.argv[2] || process.env.QC_HEIC_FIXTURE_PATH || "",
  );
  if (!fixturePath) {
    throw new Error(
      "Provide a real HEIC fixture path: node scripts/validateQcHeicSharp.js /path/to/iphone.heic",
    );
  }

  const absolutePath = path.resolve(fixturePath);
  await fs.access(absolutePath);
  const input = await fs.readFile(absolutePath);
  const image = sharp(input, {
    failOn: "none",
    sequentialRead: true,
    limitInputPixels: 40 * 1024 * 1024,
  }).rotate();
  const metadata = await image.metadata();

  if (!metadata?.width || !metadata?.height) {
    throw new Error("Sharp could not read HEIC dimensions");
  }

  const preview = await sharp(input, {
    failOn: "none",
    sequentialRead: true,
    limitInputPixels: 40 * 1024 * 1024,
  })
    .rotate()
    .resize({
      width: Number(process.env.QC_IMAGE_PREVIEW_MAX_DIMENSION || 1920),
      height: Number(process.env.QC_IMAGE_PREVIEW_MAX_DIMENSION || 1920),
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: Number(process.env.QC_IMAGE_PREVIEW_WEBP_QUALITY || 82) })
    .toBuffer({ resolveWithObject: true });

  const thumbnail = await sharp(input, {
    failOn: "none",
    sequentialRead: true,
    limitInputPixels: 40 * 1024 * 1024,
  })
    .rotate()
    .resize({
      width: Number(process.env.QC_IMAGE_THUMBNAIL_MAX_DIMENSION || 480),
      height: Number(process.env.QC_IMAGE_THUMBNAIL_MAX_DIMENSION || 480),
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: Number(process.env.QC_IMAGE_THUMBNAIL_WEBP_QUALITY || 72) })
    .toBuffer({ resolveWithObject: true });

  console.log("QC HEIC Sharp validation passed.", {
    fixture: absolutePath,
    input: {
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      orientation: metadata.orientation || null,
    },
    preview: {
      width: preview.info.width,
      height: preview.info.height,
      size: preview.data.length,
    },
    thumbnail: {
      width: thumbnail.info.width,
      height: thumbnail.info.height,
      size: thumbnail.data.length,
    },
  });
};

main().catch((error) => {
  console.error("QC HEIC Sharp validation failed:", error?.message || error);
  console.error(
    "The VPS Sharp/libvips/libheif runtime cannot decode this HEIC. Install/upgrade libvips with libheif support or rebuild Sharp against a libvips build with HEIC enabled.",
  );
  process.exitCode = 1;
});
