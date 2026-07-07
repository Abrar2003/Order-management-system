const express = require("express");
const auth = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const { userHasPermission } = require("../services/permission.service");
const {
  createVendor,
  getVendors,
  updateVendor,
  exportVendors,
  getVendorBrandOptions,
} = require("../controllers/vendor.controller");

const router = express.Router();

const requireVendorBrandOptionsAccess = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const permissionResults = await Promise.all(
      ["view", "create", "edit"].map((action) =>
        userHasPermission(req.user, "vendors", action),
      ),
    );
    const allowed = permissionResults.some(Boolean);

    if (!allowed) {
      return res.status(403).json({
        message: "Permission denied: vendors view, create, or edit is required.",
      });
    }

    return next();
  } catch (error) {
    console.error("Vendor brand options permission check error:", error);
    return res.status(500).json({ message: "Failed to verify permissions" });
  }
};

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

router.get(
  "/brand-options",
  auth,
  requireVendorBrandOptionsAccess,
  getVendorBrandOptions,
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
