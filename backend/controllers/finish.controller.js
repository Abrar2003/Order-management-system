const mongoose = require("mongoose");

const Finish = require("../models/finish.model");
const Item = require("../models/item.model");
const {
  isConfigured: isWasabiConfigured,
  createStorageKey,
  uploadBuffer,
  deleteObject,
  getObjectBuffer,
  getObjectUrl,
} = require("../services/wasabiStorage.service");

const normalizeText = (value) => String(value ?? "").trim();

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

const escapeRegex = (value = "") =>
  String(value)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toStoredImage = (image = {}) => {
  const key = normalizeText(image?.key || image?.public_id);
  const link = normalizeText(image?.link);
  
  // If key exists but link is empty, generate link from key
  const finalLink = link || (key && isWasabiConfigured() ? getObjectUrl(key) : "");
  
  return {
    key,
    originalName: normalizeText(image?.originalName),
    contentType: normalizeText(image?.contentType),
    size: Math.max(0, Number(image?.size || 0) || 0),
    link: finalLink,
    public_id: normalizeText(image?.public_id || image?.key),
  };
};

const normalizeFinishSummary = ({
  finishId = null,
  uniqueCode = "",
  vendor = "",
  vendorCode = "",
  color = "",
  colorCode = "",
} = {}) => ({
  finish_id: finishId && mongoose.Types.ObjectId.isValid(finishId)
    ? new mongoose.Types.ObjectId(finishId)
    : null,
  unique_code: normalizeCode(uniqueCode),
  vendor: normalizeText(vendor),
  vendor_code: normalizeCode(vendorCode),
  color: normalizeText(color),
  color_code: normalizeCode(colorCode),
});

const parseItemCodesInput = (value) => {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => normalizeText(entry)).filter(Boolean))];
  }

  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return [];

  try {
    const parsed = JSON.parse(normalizedValue);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.map((entry) => normalizeText(entry)).filter(Boolean))];
    }
  } catch {
    // fall through to comma split
  }

  return [...new Set(
    normalizedValue
      .split(",")
      .map((entry) => normalizeText(entry))
      .filter(Boolean),
  )];
};

const FINISH_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const FINISH_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const uploadFinishImage = async (file, uniqueCode) => {
  if (!file) return null;
  if (!isWasabiConfigured()) {
    throw new Error("Wasabi storage is not configured");
  }

  const mimeType = normalizeText(file?.mimetype).toLowerCase();
  const extension = normalizeText(
    require("path").extname(String(file?.originalname || "")).toLowerCase(),
  );
  if (!FINISH_IMAGE_MIME_TYPES.has(mimeType) || !FINISH_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error("Only JPG, JPEG, PNG, and WEBP files are allowed for finish images");
  }

  const originalName =
    normalizeText(file?.originalname) || `${normalizeCode(uniqueCode) || "finish"}${extension || ".jpg"}`;
  const uploadResult = await uploadBuffer({
    buffer: file.buffer,
    key: createStorageKey({
      folder: "finish-images",
      originalName,
      extension: extension || ".jpg",
    }),
    originalName,
    contentType: mimeType || "application/octet-stream",
  });

  const imageLink = isWasabiConfigured() ? getObjectUrl(uploadResult.key) : "";
  
  return {
    key: uploadResult.key,
    originalName: uploadResult.originalName,
    contentType: uploadResult.contentType,
    size: uploadResult.size,
    link: imageLink,
    public_id: uploadResult.key,
  };
};

const buildVendorItemMatch = ({ vendor = "", search = "" } = {}) => {
  const normalizedVendor = normalizeText(vendor);
  if (!normalizedVendor) {
    return null;
  }

  const vendorRegex = new RegExp(`^${escapeRegex(normalizedVendor)}$`, "i");
  const match = {
    vendors: vendorRegex,
  };

  const normalizedSearch = normalizeText(search);
  if (!normalizedSearch) return match;

  const searchRegex = new RegExp(escapeRegex(normalizedSearch), "i");
  return {
    $and: [
      match,
      {
        $or: [
          { code: searchRegex },
          { name: searchRegex },
          { description: searchRegex },
        ],
      },
    ],
  };
};

exports.getVendorItemsForFinish = async (req, res) => {
  try {
    const vendor = normalizeText(req.query.vendor);
    const search = normalizeText(req.query.search);

    if (!vendor) {
      return res.status(200).json({
        success: true,
        vendor,
        items: [],
      });
    }

    const match = buildVendorItemMatch({ vendor, search });
    const items = await Item.find(match)
      .select("code name description brand brand_name vendors finish")
      .sort({ code: 1, name: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      vendor,
      items: (Array.isArray(items) ? items : []).map((item) => ({
        _id: item?._id,
        code: normalizeText(item?.code),
        name: normalizeText(item?.name),
        description: normalizeText(item?.description),
        brand: normalizeText(item?.brand_name || item?.brand),
        vendors: Array.isArray(item?.vendors) ? item.vendors : [],
        finish: Array.isArray(item?.finish) ? item.finish : [],
      })),
    });
  } catch (error) {
    console.error("Get Vendor Items For Finish Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to load vendor items for finish",
    });
  }
};

exports.getFinishImage = async (req, res) => {
  try {
    const requestedUniqueCode = normalizeCode(
      req.query.unique_code || req.query.uniqueCode || "",
    );
    const requestedIdentifier = String(req.query.unique_code || req.query.uniqueCode || "").trim();
    const lookupConditions = [];

    if (requestedUniqueCode) {
      lookupConditions.push({ unique_code: requestedUniqueCode });
    }
    console.log("lookupConditions", lookupConditions)
    console.log("requestedIdentifier", requestedIdentifier)
    if (mongoose.Types.ObjectId.isValid(requestedIdentifier)) {
      lookupConditions.push({
        _id: new mongoose.Types.ObjectId(requestedIdentifier),
      });
    } else if (requestedIdentifier) {
      const normalizedIdentifierCode = normalizeCode(requestedIdentifier);
      if (normalizedIdentifierCode) {
        lookupConditions.push({ unique_code: normalizedIdentifierCode });
      }
    }

    if (lookupConditions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "A valid finish id or unique code is required",
      });
    }

    const finish = await Finish.findOne({
      $or: lookupConditions,
    })
      .select("unique_code image")
      .lean();
      console.log("finish", finish)
    if (!finish) {
      return res.status(404).json({
        success: false,
        message: "Finish not found",
      });
    }

    const storedImage = toStoredImage(finish?.image);
    // console.log("storedImage", storedImage)
    if (!storedImage.key && !storedImage.link) {
      return res.status(404).json({
        success: false,
        message: "Finish image not found",
      });
    }

    let imageBuffer = null;
    let contentType = storedImage.contentType || "image/webp";

    if (storedImage.key) {
      if (!isWasabiConfigured()) {
        return res.status(500).json({
          success: false,
          message: "Wasabi storage is not configured",
        });
      }

      const objectPayload = await getObjectBuffer(storedImage.key);
      imageBuffer = objectPayload?.buffer || null;
      contentType = normalizeText(objectPayload?.contentType) || contentType;
    }
    
    // Fallback to link if key failed or link is available
    if (!imageBuffer && storedImage.link) {
      try {
        const response = await fetch(storedImage.link);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          imageBuffer = Buffer.from(arrayBuffer);
          contentType = normalizeText(response.headers.get("content-type")) || contentType;
        }
      } catch (error) {
        // Link fetch failed, but we'll handle it below
        console.error("Failed to fetch finish image from link:", error?.message);
      }
    }

    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Finish image not found",
      });
    }

    res.setHeader("Content-Type", contentType || "image/webp");
    res.setHeader("Content-Length", String(imageBuffer.length));
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.status(200).send(imageBuffer);
  } catch (error) {
    console.error("Get Finish Image Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch finish image",
    });
  }
};

exports.upsertFinish = async (req, res) => {
  let uploadedImage = null;
  let cleanupUploadedImage = false;

  try {
    const vendor = normalizeText(req.body?.vendor);
    const vendorCode = normalizeCode(req.body?.vendor_code);
    const color = normalizeText(req.body?.color);
    const colorCode = normalizeCode(req.body?.color_code);
    const itemCodes = parseItemCodesInput(req.body?.item_codes);

    if (!vendor) {
      return res.status(400).json({ success: false, message: "Vendor is required" });
    }
    if (!vendorCode) {
      return res.status(400).json({ success: false, message: "Vendor code is required" });
    }
    if (!color) {
      return res.status(400).json({ success: false, message: "Color is required" });
    }
    if (!colorCode) {
      return res.status(400).json({ success: false, message: "Color code is required" });
    }
    if (itemCodes.length === 0) {
      return res.status(400).json({ success: false, message: "Select at least one item" });
    }

    const uniqueCode = normalizeCode(`${vendorCode}-${colorCode}`);
    if (!uniqueCode) {
      return res.status(400).json({ success: false, message: "Unique code could not be generated" });
    }

    const vendorMatch = buildVendorItemMatch({ vendor });
    const selectedItems = await Item.find({
      ...(vendorMatch || {}),
      code: { $in: itemCodes },
    })
      .select("_id code finish vendors")
      .lean();

    const selectedItemCodes = [...new Set(
      (Array.isArray(selectedItems) ? selectedItems : [])
        .map((item) => normalizeText(item?.code))
        .filter(Boolean),
    )];

    if (selectedItemCodes.length !== itemCodes.length) {
      const foundCodeSet = new Set(selectedItemCodes);
      const invalidCodes = itemCodes.filter((code) => !foundCodeSet.has(code));
      return res.status(400).json({
        success: false,
        message: `Some selected items do not belong to vendor ${vendor}: ${invalidCodes.join(", ")}`,
      });
    }

    const existingFinish = await Finish.findOne({ unique_code: uniqueCode });
    const previousImageKey = normalizeText(existingFinish?.image?.key || "");

    if (req.file) {
      uploadedImage = await uploadFinishImage(req.file, uniqueCode);
      cleanupUploadedImage = Boolean(uploadedImage?.key);
    }

    const nextImage = uploadedImage
      ? uploadedImage
      : toStoredImage(existingFinish?.image);

    const finishDoc = existingFinish || new Finish();
    finishDoc.vendor = vendor;
    finishDoc.vendor_code = vendorCode;
    finishDoc.color = color;
    finishDoc.color_code = colorCode;
    finishDoc.unique_code = uniqueCode;
    finishDoc.item_codes = [...selectedItemCodes].sort((left, right) => left.localeCompare(right));
    finishDoc.image = nextImage;
    await finishDoc.save();
    cleanupUploadedImage = false;

    const finishSummary = normalizeFinishSummary({
      finishId: finishDoc._id,
      uniqueCode,
      vendor,
      vendorCode,
      color,
      colorCode,
    });

    await Item.updateMany(
      {
        code: { $nin: selectedItemCodes },
        "finish.unique_code": uniqueCode,
      },
      {
        $pull: {
          finish: { unique_code: uniqueCode },
        },
      },
    );

    await Item.updateMany(
      {
        code: { $in: selectedItemCodes },
        "finish.unique_code": uniqueCode,
      },
      {
        $pull: {
          finish: { unique_code: uniqueCode },
        },
      },
    );

    await Item.updateMany(
      { code: { $in: selectedItemCodes } },
      {
        $push: {
          finish: finishSummary,
        },
      },
    );

    if (uploadedImage?.key && previousImageKey && previousImageKey !== uploadedImage.key) {
      await deleteObject(previousImageKey).catch(() => undefined);
    }

    return res.status(existingFinish ? 200 : 201).json({
      success: true,
      message: existingFinish
        ? "Finish updated and assigned to selected items"
        : "Finish created and assigned to selected items",
      data: {
        _id: finishDoc._id,
        vendor: finishDoc.vendor,
        vendor_code: finishDoc.vendor_code,
        color: finishDoc.color,
        color_code: finishDoc.color_code,
        unique_code: finishDoc.unique_code,
        item_codes: finishDoc.item_codes,
      },
    });
  } catch (error) {
    if (cleanupUploadedImage && uploadedImage?.key) {
      await deleteObject(uploadedImage.key).catch(() => undefined);
    }

    console.error("Upsert Finish Error:", error);
    const duplicateKeyError = Number(error?.code || 0) === 11000;
    return res.status(duplicateKeyError ? 409 : 400).json({
      success: false,
      message: duplicateKeyError
        ? "A finish with this unique code already exists"
        : error?.message || "Failed to save finish",
    });
  }
};
