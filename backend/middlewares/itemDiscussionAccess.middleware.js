const auth = require("./auth.middleware");
const { requirePermission } = require("./permission.middleware");
const qcItemVendorScope = require("./qcItemVendorScope.middleware");
const discussions = require("../controllers/itemDiscussion.controller");

// Posting and live subscriptions use the same access rules as reading an item.
module.exports = [
  auth,
  (req, res, next) => requirePermission(req.query.qc_id ? "qc" : "items", "view")(req, res, next),
  qcItemVendorScope,
  discussions.loadItem,
];
