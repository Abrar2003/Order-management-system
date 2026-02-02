const Brand = require("../models/brand.model");


// Get all brands
exports.getAllBrands = async (req, res) => {
  try {
    const brands = await Brand.find({}, "name logo");

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

    const { name } = req.body;
    const newBrand = new Brand({ name, logo: req.file.buffer });
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