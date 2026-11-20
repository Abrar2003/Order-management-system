const mongoose = require("mongoose");
const QC = require("../models/qc.model");
const { normalizeUserRoleKey } = require("../helpers/userRole");
const { getVendorId, getVendorName } = require("../helpers/vendorRef");
const { applyDataAccessMatch, isUserAllowedData } = require("./userDataAccess.service");

const isQcRole = (user) => normalizeUserRoleKey(user?.role) === "qc";
const ownsQc = (user, qc) => Boolean(user?._id || user?.id) &&
  String(qc?.inspector?._id || qc?.inspector || "") === String(user?._id || user?.id);

const getQcVendorAccess = async (user) => {
  if (!isQcRole(user)) return null;
  const inspector = String(user?._id || user?.id || "");
  if (!mongoose.Types.ObjectId.isValid(inspector)) return [];
  const requests = await QC.find({ inspector })
    .select("inspector request_history order")
    .populate({
      path: "order",
      match: applyDataAccessMatch({ archived: { $ne: true }, status: { $ne: "Cancelled" } }, user),
      select: "vendor brand",
    })
    .lean();
  const vendors = new Map();
  for (const qc of requests) {
    const current = qc.request_history?.[qc.request_history.length - 1];
    if (!qc.order || current?.status !== "open" ||
        String(current?.inspector?._id || current?.inspector || "") !== inspector) continue;
    const name = getVendorName(qc.order.vendor);
    const vendor_id = getVendorId(qc.order.vendor);
    if (!name || !isUserAllowedData(user, { brands: [qc.order.brand], vendors: [qc.order.vendor] })) continue;
    vendors.set(vendor_id || name.toLowerCase(), { vendor_id, name });
  }
  return [...vendors.values()].sort((a, b) => a.name.localeCompare(b.name));
};

const matchesVendor = (vendor, allowed) => {
  const id = getVendorId(vendor);
  if (id && allowed.vendor_id) return id === allowed.vendor_id;
  return getVendorName(vendor).toLowerCase() === allowed.name.toLowerCase();
};

const canViewQc = async (user, qc) => {
  if (!isQcRole(user) || ownsQc(user, qc)) return true;
  const vendors = await getQcVendorAccess(user);
  return vendors.some((vendor) => matchesVendor(qc?.order?.vendor || qc?.order_meta?.vendor, vendor));
};

module.exports = { getQcVendorAccess, canViewQc, isQcRole, ownsQc };
