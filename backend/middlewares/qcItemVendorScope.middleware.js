const mongoose = require("mongoose");
const QC = require("../models/qc.model");
const Item = require("../models/item.model");
const { getQcVendorAccess, canViewQc, isQcRole } = require("../services/qcVendorAccess.service");
const { applyDataAccessMatch } = require("../services/userDataAccess.service");
const { escapeRegex } = require("../helpers/itemQuery");

module.exports = async (req, res, next) => {
  try {
    // Existing QC records keep document access after their request is completed.
    if (req.query.qc_id && (req.params.id || req.params.itemId)) {
      if (!mongoose.Types.ObjectId.isValid(req.params.id || req.params.itemId)) return res.status(400).json({ message: "Invalid item id" });
      if (!mongoose.Types.ObjectId.isValid(req.query.qc_id)) return res.status(400).json({ message: "Invalid QC id" });
      const qc = await QC.findById(req.query.qc_id).populate({
        path: "order", match: applyDataAccessMatch({ archived: { $ne: true }, status: { $ne: "Cancelled" } }, req.user),
        select: "vendor brand",
      });
      if (!qc?.order || !await canViewQc(req.user, qc)) return res.status(403).json({ message: "QC record is not accessible" });
      const code = qc.item?.item_code;
      if (!code || !await Item.exists({ _id: req.params.id || req.params.itemId, code: new RegExp(`^\\s*${escapeRegex(code)}\\s*$`, "i") })) {
        return res.status(404).json({ message: "Item not found for this QC record" });
      }
      req.vendorScope = { restricted: true };
      req.user = { ...req.user, qc_vendor_scope: [qc.order.vendor] };
      return next();
    }
    if (!isQcRole(req.user)) return next();
    if (req.query.vendor !== undefined && typeof req.query.vendor !== "string") {
      return res.status(400).json({ message: "Invalid vendor filter" });
    }
    const vendors = await getQcVendorAccess(req.user);
    const requested = typeof req.query.vendor === "string" ? req.query.vendor.trim() : "";
    const selected = !requested || requested.toLowerCase() === "all"
      ? vendors[0]
      : vendors.find((vendor) => (vendor.vendor_id || vendor.name) === requested || vendor.name.toLowerCase() === requested.toLowerCase());
    if (requested && requested.toLowerCase() !== "all" && !selected) {
      return res.status(403).json({ message: "Vendor is not assigned through an open inspection request.", code: "QC_VENDOR_ACCESS_REVOKED" });
    }
    req.vendorScope = { restricted: true, vendors, selected_vendor_id: selected?.vendor_id || selected?.name || "" };
    req.user = { ...req.user, qc_vendor_scope: selected ? [selected] : [] };
    return next();
  } catch (error) {
    console.error("QC vendor access error:", error);
    return res.status(500).json({ message: "Failed to verify QC vendor access" });
  }
};
