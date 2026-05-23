const express = require("express");
const auth = require("../middlewares/auth.middleware");
const {
  getLoginPopupSummary,
  getNotifications,
  getSummary,
  patchArchive,
  patchRead,
  patchReadAll,
  postPopupSeen,
} = require("../controllers/notification.controller");

const router = express.Router();

router.use(auth);

router.get("/", getNotifications);
router.get("/summary", getSummary);
router.get("/login-summary", getLoginPopupSummary);
router.patch("/read-all", patchReadAll);
router.patch("/:id/read", patchRead);
router.patch("/:id/archive", patchArchive);
router.post("/popup-seen", postPopupSeen);

module.exports = router;
