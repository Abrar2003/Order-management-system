const express = require("express");
const {
  signup,
  signin,
  getUsers,
  changePassword,
} = require("../controllers/auth.controller");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");

const router = express.Router();

router.post("/signup", signup);
router.post("/signin", signin);
router.patch("/change-password", auth, changePassword);
router.get(
  "/",
  auth,
  authorize("admin", "manager", "dev", "QC"),
  getUsers
);

module.exports = router;
