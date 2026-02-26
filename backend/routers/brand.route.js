const express = require("express");
const multer = require("multer");

const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const brandController = require("../controllers/brand.controller");

const router = express.Router();

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "image/webp") {
      cb(null, true);
    } else {
      cb(new Error("Only WEBP images are allowed"), false);
    }
  },
  dest: "uploads/",
});

// Get all brands
router.get(
  "/",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  brandController.getAllBrands,
);

router.get(
  "/:name/calendar",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  brandController.getBrandCalendar,
);

router.post(
    "/create-brand",
    auth,
    authorize("admin", "manager", "dev"),
    upload.single("logo"),
    brandController.createBrand
)

module.exports = router;
