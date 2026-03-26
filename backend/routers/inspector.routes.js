const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const inspectorController = require("../controllers/inspector.controller");

// 🔐 All routes require authentication and Manager/Admin authorization
router.use(auth);
router.use(authorize("manager", "admin"));

/**
 * GET /inspectors
 * Get all inspectors with pagination and search
 */
router.get("/", inspectorController.getAllInspectors);

/**
 * POST /inspectors/sync
 * Sync missing inspector records for QC users
 */
router.post("/sync", inspectorController.syncInspectors);

/**
 * GET /inspectors/:id
 * Get inspector details by ID
 */
router.get("/:id", inspectorController.getInspectorById);

/**
 * PATCH /inspectors/:id/allocate-labels
 * Allocate QC labels to an inspector (add to existing)
 */
router.patch("/:id/allocate-labels", inspectorController.allocateLabels);

/**
 * PATCH /inspectors/transfer-labels
 * Transfer unused QC labels from one inspector to another
 */
router.patch("/transfer-labels", inspectorController.transferLabels);

/**
 * PATCH /inspectors/:id/replace-labels
 * Replace all allocated labels for an inspector
 */
router.patch("/:id/replace-labels", inspectorController.replaceLabels);

/**
 * DELETE /inspectors/:id/labels
 * Remove specific labels from an inspector
 */
router.delete("/:id/labels", inspectorController.removeLabels);

/**
 * GET /inspectors/:id/label-usage
 * Get label usage statistics for an inspector
 */
router.get("/:id/label-usage", inspectorController.getLabelUsageStats);

module.exports = router;
