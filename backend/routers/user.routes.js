const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const userController = require("../controllers/user.controller");

// router.use(auth);
// // router.use(authorize("admin"));

/**
 * POST /users
 * Create a user (Admin/Manager)
 */
router.post("/", userController.createUser);

module.exports = router;
