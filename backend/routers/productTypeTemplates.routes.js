const express = require("express");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const {
  archiveProductTypeTemplate,
  createProductTypeTemplate,
  getProductTypeTemplateByKey,
  getProductTypeTemplates,
  updateProductTypeTemplate,
  updateProductTypeTemplateStatus,
} = require("../controllers/productTypeTemplate.controller");

const router = express.Router();

router.get(
  "/",
  auth,
  requirePermission("product_type_templates", "view"),
  getProductTypeTemplates,
);

router.get(
  "/:key",
  auth,
  requirePermission("product_type_templates", "view"),
  getProductTypeTemplateByKey,
);

router.post(
  "/",
  auth,
  authorize("admin"),
  requirePermission("product_type_templates", "create"),
  createProductTypeTemplate,
);

router.put(
  "/:id",
  auth,
  authorize("admin"),
  requirePermission("product_type_templates", "edit"),
  updateProductTypeTemplate,
);

router.patch(
  "/:id/status",
  auth,
  authorize("admin"),
  requirePermission("product_type_templates", "edit"),
  updateProductTypeTemplateStatus,
);

router.delete(
  "/:id",
  auth,
  authorize("admin"),
  requirePermission("product_type_templates", "delete"),
  archiveProductTypeTemplate,
);

module.exports = router;
