const express = require("express");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const controller = require("../controllers/employeeReport.controller");

const router = express.Router();

router.get("/me", auth, requirePermission("reports", "view"), controller.getMyEmployeeReport);
router.get("/management", auth, authorize("admin"), controller.getEmployeeManagement);
router.patch("/employees/:employeeId/department", auth, authorize("admin"), controller.updateEmployeeDepartment);
router.put("/assignments/:taskKey", auth, authorize("admin"), controller.updateTaskAssignment);

module.exports = router;
