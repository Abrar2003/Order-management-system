const express = require("express");
const multer = require("multer");

const auth = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const {
  cacheRoute,
  invalidateCacheOnSuccess,
} = require("../middlewares/cache.middleware");
const { MEDIUM_CACHE_TTL } = require("../services/cache.service");
const {
  invalidateAllOmsCaches,
} = require("../services/cacheInvalidation.service");
const brandController = require("../controllers/brand.controller");

const router = express.Router();
const invalidateAllOnSuccess = invalidateCacheOnSuccess(invalidateAllOmsCaches);

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

const uploadBrandLogo = (req, res, next) =>
  upload.single("logo")(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Brand logo exceeds the 5MB limit" });
    }

    return res.status(400).json({
      message: error?.message || "Invalid brand logo upload",
    });
  });

// Get all brands
router.get(
  "/",
  auth,
  requirePermission("brands", "view"),
  cacheRoute("options", MEDIUM_CACHE_TTL),
  brandController.getAllBrands,
);

router.get(
  "/logo",
  auth,
  requirePermission("brands", "view"),
  brandController.getBrandLogo,
);

router.get(
  "/:name/logo",
  auth,
  requirePermission("brands", "view"),
  brandController.getBrandLogo,
);

router.get(
  "/:name/calendar",
  auth,
  requirePermission("calendar", "view"),
  cacheRoute("options", MEDIUM_CACHE_TTL),
  brandController.getBrandCalendar,
);

router.post(
    "/create-brand",
    auth,
    requirePermission("brands", "create"),
    uploadBrandLogo,
    invalidateAllOnSuccess,
    brandController.createBrand
)

module.exports = router;
