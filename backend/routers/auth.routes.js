const express = require("express");
const {
  signup,
  signin,
  getUsers,
  changePassword,
  forceChangeUserPassword,
} = require("../controllers/auth.controller");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const createRateLimiter = require("../middlewares/rateLimit.middleware");

const router = express.Router();
const authRateLimit = createRateLimiter({
  keyPrefix: "auth",
  maxRequests: process.env.AUTH_RATE_LIMIT_MAX_REQUESTS || 20,
  windowMs: process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000,
  message: "Too many authentication attempts. Please try again later.",
});

router.post("/signup", authRateLimit, signup);
router.post("/signin", authRateLimit, signin);
router.patch("/change-password", auth, changePassword);
router.patch(
  "/force-change-password",
  authRateLimit,
  auth,
  authorize("admin", "manager", "dev"),
  forceChangeUserPassword,
);
router.get(
  "/",
  auth,
  authorize("admin", "manager", "dev", "user"),
  getUsers
);

module.exports = router;
