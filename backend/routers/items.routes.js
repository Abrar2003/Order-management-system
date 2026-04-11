const express = require("express");
const upload = require("../config/multer.config");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const {
  getItems,
  getItemOrderPresence,
  getItemOrdersHistory,
  syncItemsFromOrders,
  updateItem,
  updateItemPis,
  getItemFileUrl,
  getItemPisFileUrl,
  uploadItemFile,
  uploadItemPisFile,
  deleteItemFile,
} = require("../controllers/item.controller");
const { getProductAnalytics } = require("../controllers/product.controller");

const router = express.Router();

router.get(
  "/",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  getItems,
);

router.post(
  "/sync",
  auth,
  authorize("admin", "manager", "dev"),
  syncItemsFromOrders,
);

router.get(
  "/:itemCode/order-presence",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  getItemOrderPresence,
);

router.get(
  "/:itemCode/orders-history",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  getItemOrdersHistory,
);

router.get(
  "/:id/files/:fileType/url",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  getItemFileUrl,
);

router.get(
  "/:itemId/pis-file-url",
  auth,
  authorize("admin", "manager", "QC", "dev", "user"),
  getItemPisFileUrl,
);

router.get("/product-analytics", auth, authorize("admin", "manager", "dev", "user"), getProductAnalytics);

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
  "/:itemId/pis-upload",
  auth,
  authorize("admin", "manager", "dev"),
  upload.single("file"),
  uploadItemPisFile,
);

router.post(
  "/:id/files",
  auth,
  authorize("admin", "manager"),
  upload.single("file"),
  uploadItemFile,
);

router.delete(
  "/:id/files/:fileType",
  auth,
  authorize("admin", "manager"),
  deleteItemFile,
);

module.exports = router;
