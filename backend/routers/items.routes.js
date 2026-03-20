const express = require("express");
const upload = require("../config/multer.config");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const {
  getItems,
  getItemOrdersHistory,
  syncItemsFromOrders,
  updateItem,
  updateItemPis,
  getItemFileUrl,
  uploadItemFile,
} = require("../controllers/item.controller");

const router = express.Router();

router.get(
  "/",
  auth,
  authorize("admin", "manager", "QC", "dev"),
  getItems,
);

router.post(
  "/sync",
  auth,
  authorize("admin", "manager", "dev"),
  syncItemsFromOrders,
);

router.get(
  "/:itemCode/orders-history",
  auth,
  authorize("admin", "manager", "QC", "dev"),
  getItemOrdersHistory,
);

router.get(
  "/:id/files/:fileType/url",
  auth,
  authorize("admin", "manager", "QC", "dev"),
  getItemFileUrl,
);

router.patch(
  "/:id",
  auth,
  authorize("admin", "manager", "dev"),
  updateItem,
);

router.patch(
  "/:id/pis",
  auth,
  authorize("admin", "manager", "dev"),
  updateItemPis,
);

router.post(
  "/:id/files",
  auth,
  authorize("admin", "manager", "QC", "dev"),
  upload.single("file"),
  uploadItemFile,
);

module.exports = router;
