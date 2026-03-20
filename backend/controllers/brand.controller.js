const Brand = require("../models/brand.model");
const {
  isConfigured: isWasabiConfigured,
  createStorageKey,
  getSignedObjectUrl,
  uploadBuffer,
} = require("../services/wasabiStorage.service");

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeBrandLogo = async (brand = {}) => {
  const legacyStorageKey = String(brand?.logo_storage_key || "").trim();
  const storedLogo = brand?.logo_file && typeof brand.logo_file === "object"
    ? brand.logo_file
    : {};
  const legacyLogoUrl = String(brand?.logo_url || "").trim();
  const storageKey = String(storedLogo?.key || legacyStorageKey || "").trim();
  const originalName = String(storedLogo?.originalName || "").trim();
  const contentType = String(
    storedLogo?.contentType || brand?.logo_content_type || "image/webp",
  ).trim() || "image/webp";
  const size = Number(storedLogo?.size || brand?.logo_size || 0);

  if (storageKey && isWasabiConfigured()) {
    try {
      return {
        key: storageKey,
        originalName,
        contentType,
        size: Number.isFinite(size) ? size : 0,
        url: await getSignedObjectUrl(storageKey, {
          expiresIn: 24 * 60 * 60,
          filename: originalName,
        }),
      };
    } catch (error) {
      console.error("Brand logo signed URL generation failed:", {
        storageKey,
        error: error?.message || String(error),
      });
    }
  }

  if (legacyLogoUrl) {
    return {
      key: "",
      originalName,
      contentType,
      size: Number.isFinite(size) ? size : 0,
      url: legacyLogoUrl,
    };
  }

  const rawLogo = brand?.logo;
  const logoBuffer = Buffer.isBuffer(rawLogo)
    ? rawLogo
    : Array.isArray(rawLogo?.data)
      ? Buffer.from(rawLogo.data)
      : rawLogo?.type === "Buffer" && Array.isArray(rawLogo?.data)
        ? Buffer.from(rawLogo.data)
        : null;

  if (!logoBuffer) {
    return null;
  }

  return {
    data: logoBuffer,
    contentType,
    size: Number.isFinite(size) && size > 0 ? size : logoBuffer.length,
  };
};

const toBrandResponse = async (brandDoc = {}) => ({
  ...brandDoc,
  logo: await normalizeBrandLogo(brandDoc),
});

// Get all brands
exports.getAllBrands = async (req, res) => {
  try {
    const brands = await Brand.find(
      {},
      "name logo logo_file logo_url logo_storage_key logo_content_type logo_size calendar",
    ).lean();

    if (!brands || brands.length === 0) {
      return res.status(200).json({
        message: "No brands found",
        data: [],
      });
    }

    res.status(200).json({
      message: "Brands retrieved successfully",
      data: await Promise.all(brands.map((brand) => toBrandResponse(brand))),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to retrieve brands",
      error: error.message,
    });
  }
};

exports.createBrand = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No logo file uploaded" });
    }

    const name = String(req.body?.name || "").trim();
    const calendar = String(req.body?.calendar || "").trim();

    if (!name) {
      return res.status(400).json({ message: "Brand name is required" });
    }

    const logoPayload = {
      logo: req.file.buffer,
      logo_content_type: req.file.mimetype || "image/webp",
      logo_size: Number(req.file.size || req.file.buffer?.length || 0),
      logo_url: "",
      logo_storage_key: "",
    };

    if (isWasabiConfigured()) {
      const storageKey = createStorageKey({
        folder: "brands/logos",
        originalName: req.file.originalname || `${name}.webp`,
        extension: ".webp",
      });

      const uploadedLogo = await uploadBuffer({
        buffer: req.file.buffer,
        key: storageKey,
        contentType: req.file.mimetype || "image/webp",
      });

      logoPayload.logo = null;
      logoPayload.logo_file = {
        key: uploadedLogo.key,
        originalName: req.file.originalname || `${name}.webp`,
        contentType: uploadedLogo.contentType,
        size: uploadedLogo.size,
      };
      logoPayload.logo_url = "";
      logoPayload.logo_storage_key = uploadedLogo.key;
      logoPayload.logo_content_type = uploadedLogo.contentType;
      logoPayload.logo_size = uploadedLogo.size;
    }

    const newBrand = new Brand({
      name,
      ...logoPayload,
      calendar: calendar || undefined,
    });

    await newBrand.save();

    res.status(201).json({
      message: "Brand created successfully",
      data: await toBrandResponse(newBrand.toObject()),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to create brand",
      details: error.message,
    });
  }
};

exports.getBrandCalendar = async (req, res) => {
  try {
    const brandName = String(req.params?.name || req.query?.brand || "").trim();
    if (!brandName) {
      return res.status(400).json({ message: "brand is required" });
    }

    const brandDoc =
      (await Brand.findOne({ name: brandName }).select("name calendar").lean()) ||
      (await Brand.findOne({
        name: { $regex: `^${escapeRegex(brandName)}$`, $options: "i" },
      })
        .select("name calendar")
        .lean());

    if (!brandDoc) {
      return res.status(404).json({ message: "Brand not found" });
    }

    const calendarId = String(brandDoc?.calendar || "").trim();
    if (!calendarId) {
      return res.status(404).json({
        message: "Calendar is not configured for this brand",
      });
    }

    const timezone = String(req.query?.timezone || "UTC").trim() || "UTC";
    const embedUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(calendarId)}&ctz=${encodeURIComponent(timezone)}`;

    return res.status(200).json({
      brand: brandDoc.name,
      calendarId,
      embedUrl,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Failed to fetch brand calendar",
      error: error.message,
    });
  }
};
