const express = require("express");
const auth = require("../middlewares/auth.middleware");
const upload = require("../config/multer.config");
const { normalizeUserRoleKey } = require("../helpers/userRole");
const controller = require("../controllers/eudrChain.controller");

const router = express.Router();
router.use(auth, (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  return ["admin", "super_admin", "manager"].includes(normalizeUserRoleKey(req.user?.role)) ? next() : res.status(403).json({ message: "EUDR is restricted to admins and managers" });
});
router.get("/container", controller.lookupContainer);
router.get("/directory", controller.directory);
router.get("/directory/:partyId", controller.directoryDetail);
router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:id", controller.get);
router.patch("/:id/declared", controller.updateDeclared);
router.put("/:id/stages/:stageId", controller.saveStage);
router.post("/:id/stages/:stageId/documents", upload.eudrSingle("file"), controller.upload);
router.post("/:id/stages/:stageId/reuse-evidence", controller.reuseEvidence);
router.get("/:id/stages/:stageId/documents/:documentId/url", controller.documentUrl);
router.get("/:id/stages/:stageId/documents/:documentId/content", controller.documentContent);
router.get("/:id/stages/:stageId/documents/:documentId/preview", controller.documentPreview);
router.post("/:id/stages/:stageId/verify", controller.verify);
module.exports = router;
