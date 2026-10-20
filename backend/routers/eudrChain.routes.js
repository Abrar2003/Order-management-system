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
router.use(async(req,res,next)=>{
  try{
    if(!["GET","HEAD","OPTIONS"].includes(req.method)&&process.env.EUDR_CANONICAL_INVOICES!=="true"&&await require("../services/eudrInventory.service").ledgerEnforced())return res.status(503).json({code:"CANONICAL_ROLLOUT_REQUIRED",message:"Keep canonical invoice ownership enabled while the inventory ledger is active"});
    next();
  }catch(_error){return res.status(503).json({code:"INVENTORY_STATE_UNAVAILABLE",message:"EUDR ledger state could not be checked; no changes were saved"});}
});
router.get("/container", controller.lookupContainer);
router.use(require("../controllers/eudrReview.controller").router);
router.get("/directory", controller.directory);
router.get("/directory/:partyId", controller.directoryDetail);
router.use("/inventory", require("../controllers/eudrInventory.controller").router);
router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:id", controller.get);
router.patch("/:id/declared", controller.updateDeclared);
router.patch("/:id/contribution", controller.updateContribution);
router.put("/:id/stages/:stageId", controller.saveStage);
router.post("/:id/stages/:stageId/documents", upload.eudrSingle("file"), controller.upload);
router.post("/:id/stages/:stageId/reuse-evidence", controller.reuseEvidence);
router.post("/:id/stages/:stageId/reuse-invoice", controller.reuseInvoice);
router.get("/:id/stages/:stageId/documents/:documentId/url", controller.documentUrl);
router.get("/:id/stages/:stageId/documents/:documentId/content", controller.documentContent);
router.get("/:id/stages/:stageId/documents/:documentId/preview", controller.documentPreview);
router.post("/:id/stages/:stageId/verify", controller.verify);
module.exports = router;
