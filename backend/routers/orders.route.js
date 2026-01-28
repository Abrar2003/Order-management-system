const express = require("express");
const upload = require("../config/multer.config");
const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const {
  uploadOrders,
  getOrders,
  getOrderById,
} = require("../controllers/order.controller");

const router = express.Router();

router.post(
  "/upload-orders",
  authenticate,
  authorize("admin", "manager", "dev"),
  upload.single("file"),
  uploadOrders,
);

// List orders (pagination + sorting)
router.get("/", authenticate, authorize("admin", "manager", "QC", "dev"), getOrders);
// Get order by ID
router.get("/:id", getOrderById);

module.exports = router;
