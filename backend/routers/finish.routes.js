const express = require("express");

const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const upload = require("../config/multer.config");
const finishController = require("../controllers/finish.controller");

const router = express.Router();

router.get(
  "/vendor-items",
  auth,
  authorize("admin", "manager", "dev"),
  finishController.getVendorItemsForFinish,
);

router.post(
  "/",
  auth,
  authorize("admin", "manager", "dev"),
  upload.single("image"),
  finishController.upsertFinish,
);

module.exports = router;
