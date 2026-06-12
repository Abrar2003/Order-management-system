const express = require("express");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const securityController = require("../controllers/security.controller");

const router = express.Router();

router.use(auth);
router.use(authorize("admin", "super admin"));

router.get("/summary", securityController.getSecuritySummary);
router.get("/alerts", securityController.getAlerts);
router.get("/alerts/:id", securityController.getAlertById);
router.patch("/alerts/:id/status", securityController.patchAlertStatus);
router.get("/activity", securityController.getActivity);
router.get("/users/:userId/baseline", securityController.getUserBaseline);
router.post(
  "/users/:userId/recalculate-baseline",
  securityController.postRecalculateUserBaseline,
);

module.exports = router;
