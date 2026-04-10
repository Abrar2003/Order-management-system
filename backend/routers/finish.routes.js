const express = require("express");

const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
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
  authorize("admin", "manager", "dev"),
  finishController.getVendorItemsForFinish,
);

router.get(
  "/image",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  finishController.getFinishImage,
);

router.get(
  "/:id/image",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  finishController.getFinishImage,
);

router.post(
  "/",
  auth,
  authorize("admin", "manager", "dev"),
  upload.single("image"),
  finishController.upsertFinish,
);

module.exports = router;
