const express = require("express");
const upload = require("../config/multer.config");
const {
  uploadOrders,
  getOrders,
  getOrderById
} = require("../controllers/order.controller");

const router = express.Router();

// Upload orders via Excel
router.post("/upload-orders", upload.single("file"), uploadOrders);

// List orders (pagination + sorting)
router.get("/", getOrders);

// Get order by ID
router.get("/:id", getOrderById);

module.exports = router;
