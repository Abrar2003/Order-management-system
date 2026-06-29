const express = require("express");
const auth = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const {
  createVendor,
  getVendors,
  updateVendor,
  exportVendors,
} = require("../controllers/vendor.controller");

const router = express.Router();

router.get(
  "/",
  auth,
  requirePermission("vendors", "view"),
  getVendors,
);

router.get(
  "/export",
  auth,
  requirePermission("vendors", "view"),
  exportVendors,
);

router.post(
  "/",
  auth,
  requirePermission("vendors", "create"),
  createVendor,
);

router.put(
  "/:id",
  auth,
  requirePermission("vendors", "edit"),
  updateVendor,
);

module.exports = router;
