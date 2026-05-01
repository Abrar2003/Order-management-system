const express = require("express");
const auth = require("../middlewares/auth.middleware");
const {
  requireAdminOnlyPermissionManagement,
} = require("../middlewares/permission.middleware");
const {
  getMyPermissions,
  getPermissions,
  resetRolePermissionDefaults,
  updateRolePermissions,
} = require("../controllers/permission.controller");

const router = express.Router();

router.get("/me", auth, getMyPermissions);

router.use(auth, requireAdminOnlyPermissionManagement);

router.get("/", getPermissions);
router.patch("/:role", updateRolePermissions);
router.post("/reset/:role", resetRolePermissionDefaults);

module.exports = router;
