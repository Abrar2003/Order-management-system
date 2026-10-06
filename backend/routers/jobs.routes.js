const express = require("express");

const auth = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const jobsController = require("../controllers/jobs.controller");

const router = express.Router();

router.get(
  "/qc-update-followups",
  auth,
  requirePermission("jobs", "view"),
  jobsController.listQcUpdateFollowUps,
);
router.post(
  "/qc-update-followups/:id/retry",
  auth,
  requirePermission("jobs", "manage"),
  jobsController.retryQcUpdateFollowUp,
);

router.get(
  "/:queueName/:jobId",
  auth,
  requirePermission("jobs", "view"),
  jobsController.getJobStatus,
);

router.get(
  "/:queueName",
  auth,
  requirePermission("jobs", "view"),
  jobsController.getQueueCounts,
);

router.post(
  "/:queueName/:jobId/retry",
  auth,
  requirePermission("jobs", "manage"),
  jobsController.retryJob,
);

module.exports = router;
