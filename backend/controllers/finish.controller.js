const mongoose = require("mongoose");

const Finish = require("../models/finish.model");
const Item = require("../models/item.model");
const Vendor = require("../models/vendor.model");
const { applyDataAccessMatch } = require("../services/userDataAccess.service");
const {
  isConfigured: isWasabiConfigured,
  createStorageKey,
  uploadBuffer,
  deleteObject,
  getObjectBuffer,
  getObjectUrl,
} = require("../services/wasabiStorage.service");
const {
  buildVendorsArrayFilter,
  getVendorId,
  normalizeVendorDisplayList,
  normalizeVendorText,
} = require("../helpers/vendorRef");

const normalizeText = (value) => normalizeVendorText(value);

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

const normalizeVendorCodeEntries = (value = []) =>
  (Array.isArray(value) ? value : [])
    .map((entry = {}) => ({
      brand: normalizeText(entry?.brand || entry?.brand_name || entry?.brandName),
      code: normalizeText(entry?.code || entry?.vendor_code || entry?.vendorCode),
    }))
    .filter((entry) => entry.brand && entry.code);

const normalizeDistinctValues = (values = []) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((entry) => normalizeText(entry))
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));

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

  const match = buildVendorsArrayFilter({
    field: "vendors",
    vendorId: normalizedVendor,
    vendorName: normalizedVendor,
  });

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

const serializeFinishItem = (item = {}) => ({
  _id: String(item?._id || ""),
  code: normalizeText(item?.code),
  name: normalizeText(item?.name),
  description: normalizeText(item?.description),
  brand: normalizeText(item?.brand_name || item?.brand),
  vendors: normalizeVendorDisplayList(item?.vendors),
});

const serializeFinish = (finish = {}, itemsByCode = new Map()) => {
  const itemCodes = normalizeDistinctValues(finish?.item_codes);
  const items = itemCodes
    .map((code) => itemsByCode.get(code))
    .filter(Boolean)
    .map(serializeFinishItem);
  const storedImage = toStoredImage(finish?.image);
  const uniqueCode = normalizeCode(finish?.unique_code);
  const imageVersion = normalizeText(storedImage.key || storedImage.public_id || storedImage.link);

  return {
    _id: String(finish?._id || ""),
    unique_code: uniqueCode,
    vendor_id: getVendorId(finish?.vendor),
    vendor: normalizeText(finish?.vendor),
    vendor_code: normalizeCode(finish?.vendor_code),
    color: normalizeText(finish?.color),
    color_code: normalizeCode(finish?.color_code),
    item_codes: itemCodes,
    items,
    brands: normalizeDistinctValues(items.map((item) => item.brand)),
    image: storedImage,
    image_url:
      uniqueCode && (storedImage.key || storedImage.link)
        ? `/finishes/public/image?unique_code=${encodeURIComponent(uniqueCode)}${imageVersion ? `&v=${encodeURIComponent(imageVersion)}` : ""}`
        : "",
    created_at: finish?.createdAt || finish?.created_at || null,
    updated_at: finish?.updatedAt || finish?.updated_at || null,
  };
};

exports.getFinishes = async (req, res) => {
  try {
    const vendorFilter = normalizeText(req.query.vendor);
    const brandFilter = normalizeText(req.query.brand);

    const finishes = await Finish.find({})
      .sort({ updatedAt: -1, unique_code: 1 })
      .lean();
    const itemCodes = normalizeDistinctValues(
      finishes.flatMap((finish) => Array.isArray(finish?.item_codes) ? finish.item_codes : []),
    );

    const items = itemCodes.length > 0
      ? await Item.find(
          applyDataAccessMatch(
            { code: { $in: itemCodes } },
            req.user,
            {
              brandFields: ["brand", "brand_name", "brands"],
              vendorFields: ["vendors"],
            },
          ),
        )
          .select("_id code name description brand brand_name vendors")
          .lean()
      : [];
    const itemsByCode = new Map(
      (Array.isArray(items) ? items : [])
        .map((item) => [normalizeText(item?.code), item])
        .filter(([code]) => Boolean(code)),
    );

    const allRows = finishes
      .map((finish) => serializeFinish(finish, itemsByCode))
      .filter((finish) => finish.item_codes.length === 0 || finish.items.length > 0);
    const rows = allRows.filter((finish) => {
      if (vendorFilter && finish.vendor !== vendorFilter) return false;
      if (brandFilter && !finish.brands.includes(brandFilter)) return false;
      return true;
    });

    return res.status(200).json({
      success: true,
      data: rows,
      filters: {
        brands: normalizeDistinctValues(allRows.flatMap((finish) => finish.brands)),
        vendors: normalizeDistinctValues(allRows.map((finish) => finish.vendor)),
      },
      summary: {
        total_finishes: rows.length,
      },
    });
  } catch (error) {
    console.error("Get Finishes Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to load finishes",
    });
  }
};

exports.getFinishVendorOptions = async (_req, res) => {
  try {
    const vendors = await Vendor.find({
      $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
    })
      .select("_id name vendor_code is_active")
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: (Array.isArray(vendors) ? vendors : [])
        .map((vendor) => ({
          _id: String(vendor?._id || ""),
          name: normalizeText(vendor?.name),
          vendor_code: normalizeVendorCodeEntries(vendor?.vendor_code),
          is_active: vendor?.is_active !== false,
        }))
        .filter((vendor) => vendor._id && vendor.name),
    });
  } catch (error) {
    console.error("Get Finish Vendor Options Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to load vendors for finish",
    });
  }
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

    const match = applyDataAccessMatch(
      buildVendorItemMatch({ vendor, search }),
      req.user,
      {
        brandFields: ["brand", "brand_name", "brands"],
        vendorFields: ["vendors"],
      },
    );
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
        vendors: normalizeVendorDisplayList(item?.vendors),
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
    const finishId = normalizeText(req.body?.finish_id ?? req.body?.finishId ?? req.body?._id);
    const vendorId = normalizeText(req.body?.vendor_id ?? req.body?.vendorId);
    const vendorName = normalizeText(req.body?.vendor);
    const vendor = vendorId || vendorName;
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
    if (finishId && !mongoose.Types.ObjectId.isValid(finishId)) {
      return res.status(400).json({ success: false, message: "Invalid finish id" });
    }

    const vendorMatch = buildVendorItemMatch({ vendor: vendorName || vendor });
    const selectedItems = await Item.find(
      applyDataAccessMatch(
        {
          ...(vendorMatch || {}),
          code: { $in: itemCodes },
        },
        req.user,
        {
          brandFields: ["brand", "brand_name", "brands"],
          vendorFields: ["vendors"],
        },
      ),
    )
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
        message: `Some selected items do not belong to vendor ${vendorName || vendor}: ${invalidCodes.join(", ")}`,
      });
    }

    const existingFinish = finishId
      ? await Finish.findById(finishId)
      : await Finish.findOne({ unique_code: uniqueCode });
    if (finishId && !existingFinish) {
      return res.status(404).json({ success: false, message: "Finish not found" });
    }
    const duplicateFinish = await Finish.findOne({
      unique_code: uniqueCode,
      ...(existingFinish?._id ? { _id: { $ne: existingFinish._id } } : {}),
    })
      .select("_id")
      .lean();
    if (duplicateFinish) {
      return res.status(409).json({
        success: false,
        message: "A finish with this unique code already exists",
      });
    }
    const previousUniqueCode = normalizeCode(existingFinish?.unique_code);
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
      vendor: finishDoc.vendor || vendorName || vendor,
      vendorCode,
      color,
      colorCode,
    });

    await Item.updateMany(
      { "finish.finish_id": finishDoc._id },
      { $pull: { finish: { finish_id: finishDoc._id } } },
    );
    if (previousUniqueCode) {
      await Item.updateMany(
        { "finish.unique_code": previousUniqueCode },
        { $pull: { finish: { unique_code: previousUniqueCode } } },
      );
    }
    await Item.updateMany(
      { "finish.unique_code": uniqueCode },
      { $pull: { finish: { unique_code: uniqueCode } } },
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

exports.deleteFinish = async (req, res) => {
  try {
    const finishId = normalizeText(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(finishId)) {
      return res.status(400).json({ success: false, message: "Invalid finish id" });
    }

    const finish = await Finish.findById(finishId);
    if (!finish) {
      return res.status(404).json({ success: false, message: "Finish not found" });
    }

    const uniqueCode = normalizeCode(finish.unique_code);
    await Item.updateMany(
      { "finish.finish_id": finish._id },
      { $pull: { finish: { finish_id: finish._id } } },
    );
    if (uniqueCode) {
      await Item.updateMany(
        { "finish.unique_code": uniqueCode },
        { $pull: { finish: { unique_code: uniqueCode } } },
      );
    }

    await Finish.deleteOne({ _id: finish._id });
    const imageKey = normalizeText(finish?.image?.key || "");
    if (imageKey) {
      await deleteObject(imageKey).catch(() => undefined);
    }

    return res.status(200).json({
      success: true,
      message: "Finish deleted",
    });
  } catch (error) {
    console.error("Delete Finish Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to delete finish",
    });
  }
};
