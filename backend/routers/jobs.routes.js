const express = require("express");

const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");
const jobsController = require("../controllers/jobs.controller");

const router = express.Router();

router.get(
  "/:queueName/:jobId",
  auth,
  authorize("admin", "manager", "dev"),
  jobsController.getJobStatus,
);

router.get(
  "/:queueName",
  auth,
  authorize("admin", "manager", "dev"),
  jobsController.getQueueCounts,
);

router.post(
  "/:queueName/:jobId/retry",
  auth,
  authorize("admin", "manager"),
  jobsController.retryJob,
);

module.exports = router;
