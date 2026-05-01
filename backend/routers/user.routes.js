const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const userController = require("../controllers/user.controller");

router.use(auth);
router.use(requirePermission("users", "create"));

/**
 * POST /users
 * Create a user (permission-gated).
 */
router.post("/", userController.createUser); 

module.exports = router;
