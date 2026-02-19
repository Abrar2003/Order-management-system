const Brand = require("../models/brand.model");

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Get all brands
exports.getAllBrands = async (req, res) => {
  try {
    const brands = await Brand.find({}, "name logo calendar");

    if (!brands || brands.length === 0) {
      return res.status(200).json({
        message: "No brands found",
        data: [],
      });
    }

    res.status(200).json({
      message: "Brands retrieved successfully",
      data: brands,
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

    // const svgString = fs.readFileSync(req.file.path, "utf-8");

    const name = String(req.body?.name || "").trim();
    const calendar = String(req.body?.calendar || "").trim();

    if (!name) {
      return res.status(400).json({ message: "Brand name is required" });
    }

    const newBrand = new Brand({
      name,
      logo: req.file.buffer,
      calendar: calendar || undefined,
    });
    await newBrand.save();
    res.status(201).json({
      message: "Brand created successfully",
      data: newBrand,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create brand" });
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
