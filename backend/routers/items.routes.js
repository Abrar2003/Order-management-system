const express = require("express");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const {
  getItems,
  syncItemsFromOrders,
} = require("../controllers/item.controller");

const router = express.Router();

router.get(
  "/",
  auth,
  authorize("admin", "manager", "QC", "dev", "Dev"),
  getItems,
);

router.post(
  "/sync",
  auth,
  authorize("admin", "manager", "dev", "Dev"),
  syncItemsFromOrders,
);

module.exports = router;
