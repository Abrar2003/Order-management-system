const express = require("express");
const auth = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const upload = require("../config/multer.config");
const tests = require("../controllers/tests.controller");

const router = express.Router();

router.get("/", auth, requirePermission("qc", "view"), tests.getTests);
router.post("/", auth, requirePermission("qc", "edit"), upload.safeSingle("testing_guide"), tests.createTest);
router.get("/qc/:qcId", auth, requirePermission("qc", "view"), tests.getQcTests);
router.post(
  "/qc/:qcId/:testId/runs",
  auth,
  requirePermission("qc", "edit"),
  upload.testMediaUpload,
  tests.submitDropTestRun,
);
router.patch("/:id", auth, requirePermission("qc", "edit"), upload.safeSingle("testing_guide"), tests.updateTest);

module.exports = router;
