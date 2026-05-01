const express = require("express");

const auth = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const upload = require("../config/multer.config");
const finishController = require("../controllers/finish.controller");

const router = express.Router();

// Public endpoint for fetching finish images (no auth required)
router.get(
  "/public/image",
  finishController.getFinishImage,
);

router.get(
  "/vendor-items",
  auth,
  requirePermission("finishes", "view"),
  finishController.getVendorItemsForFinish,
);

router.get(
  "/image",
  auth,
  requirePermission("finishes", "view"),
  finishController.getFinishImage,
);

router.get(
  "/:id/image",
  auth,
  requirePermission("finishes", "view"),
  finishController.getFinishImage,
);

router.post(
  "/",
  auth,
  requirePermission("finishes", "upload"),
  upload.safeSingle("image"),
  finishController.upsertFinish,
);

module.exports = router;
