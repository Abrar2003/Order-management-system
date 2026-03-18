const express = require("express");
const router = express.Router();
const emailLogsController = require("../controllers/emailLogs.controller");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");

// Get filter options (brands and vendors)
router.get("/filters/options", auth, emailLogsController.getFilterOptions);

// Get all options for creating a new email log
router.get("/create/options", auth, emailLogsController.getCreateOptions);

// Get all email logs with filters
router.get("/", auth, emailLogsController.getAllEmailLogs);

// Get email logs by order_id
router.get("/:order_id", auth, emailLogsController.getEmailLogsByOrderId);

// Create email log
router.post("/", auth, authorize("admin", "manager", "dev"), emailLogsController.createEmailLog);

// Update email log
router.patch("/:id", auth, authorize("admin", "manager", "dev"), emailLogsController.updateEmailLog);

// Delete email log
router.delete("/:id", auth, authorize("admin", "manager", "dev"), emailLogsController.deleteEmailLog);

module.exports = router;
