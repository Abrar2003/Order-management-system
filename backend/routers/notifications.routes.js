const express = require("express");
const auth = require("../middlewares/auth.middleware");
const {
  getNotifications,
  getSummary,
  patchArchive,
  patchRead,
  patchReadAll,
} = require("../controllers/notification.controller");

const router = express.Router();

router.use(auth);

router.get("/", getNotifications);
router.get("/summary", getSummary);
router.patch("/read-all", patchReadAll);
router.patch("/:id/read", patchRead);
router.patch("/:id/archive", patchArchive);

module.exports = router;
