const express = require("express");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const {
  getItems,
  getItemOrdersHistory,
  syncItemsFromOrders,
  updateItem,
  updateItemPis,
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

module.exports = router;
