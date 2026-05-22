const express = require("express");
const auth = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const {
  createVendor,
  getVendors,
} = require("../controllers/vendor.controller");

const router = express.Router();

router.get(
  "/",
  auth,
  requirePermission("vendors", "view"),
  getVendors,
);

router.post(
  "/",
  auth,
  requirePermission("vendors", "create"),
  createVendor,
);

module.exports = router;
