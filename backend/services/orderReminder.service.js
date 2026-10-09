const Order = require("../models/order.model");
const { applyDataAccessMatch } = require("./userDataAccess.service");
const { deriveOrderStatus } = require("../helpers/orderStatus");

const REMINDER_TYPES = Object.freeze({ QC: "qc", ADMIN: "admin" });
const REMINDER_STATUSES = Object.freeze({ PENDING: "pending", RESOLVED: "resolved" });
const ACTIVE_ORDER_MATCH = { archived: { $ne: true } };

const normalizeText = (value) => String(value ?? "").trim();
const normalizeItemCode = (value) => normalizeText(value).toLowerCase();
const normalizeReminderType = (value) =>
  normalizeText(value).toLowerCase() === REMINDER_TYPES.ADMIN
    ? REMINDER_TYPES.ADMIN
    : REMINDER_TYPES.QC;
const normalizeReminderStatus = (value) =>
  normalizeText(value).toLowerCase() === REMINDER_STATUSES.RESOLVED
    ? REMINDER_STATUSES.RESOLVED
    : REMINDER_STATUSES.PENDING;
const isPendingReminder = (reminder = {}) =>
  normalizeReminderStatus(reminder?.status) === REMINDER_STATUSES.PENDING;
const isPendingAdminReminder = (reminder = {}) =>
  normalizeReminderType(reminder?.type) === REMINDER_TYPES.ADMIN && isPendingReminder(reminder);
const escapeRegex = (value = "") => String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const itemCodeMatch = (itemCodes = []) => ({
  $or: [...new Set((Array.isArray(itemCodes) ? itemCodes : []).map(normalizeText).filter(Boolean))]
    .map((itemCode) => ({
      "item.item_code": { $regex: `^${escapeRegex(itemCode)}$`, $options: "i" },
    })),
});
const toTime = (value) => {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
};
const inspectionTime = (order = {}) => {
  const qc = order?.qc_record || {};
  const records = Array.isArray(qc?.inspection_record) ? qc.inspection_record : [];
  return Math.max(
    toTime(qc?.last_inspected_date),
    ...records.map((record) => Math.max(
      toTime(record?.inspection_date),
      toTime(record?.updatedAt),
      toTime(record?.createdAt),
    )),
  );
};
const shipmentTime = (order = {}) => Math.max(
  0,
  ...(Array.isArray(order?.shipment) ? order.shipment : [])
    .map((shipment) => toTime(shipment?.stuffing_date)),
);

const serializeReminder = ({ reminder = {}, order = {} } = {}) => ({
  _id: String(reminder?._id || ""),
  type: normalizeReminderType(reminder?.type),
  status: normalizeReminderStatus(reminder?.status),
  comment: normalizeText(reminder?.comment),
  image: reminder?.image || null,
  linked_qc: String(reminder?.linked_qc || ""),
  created_by: reminder?.created_by || null,
  createdAt: reminder?.createdAt || null,
  resolved_by: reminder?.resolved_by || null,
  resolvedAt: reminder?.resolvedAt || null,
  order_id: normalizeText(order?.order_id),
  order_db_id: String(order?._id || ""),
});

const selectReminderAnchor = (orders = []) => {
  const inspected = orders
    .map((order) => ({ order, time: inspectionTime(order) }))
    .filter((entry) => entry.time > 0)
    .sort((left, right) => right.time - left.time)[0];
  if (inspected) return { ...inspected, source: "inspected" };

  const shipped = orders
    .map((order) => ({ order, time: shipmentTime(order) }))
    .filter((entry) => entry.time > 0)
    .sort((left, right) => right.time - left.time)[0];
  if (shipped) return { ...shipped, source: "shipped" };

  const open = orders
    .filter((order) => ["Pending", "Under Inspection"].includes(deriveOrderStatus({ orderEntry: order })))
    .sort((left, right) =>
      toTime(left?.order_date || left?.createdAt) - toTime(right?.order_date || right?.createdAt)
      || normalizeText(left?.order_id).localeCompare(normalizeText(right?.order_id)),
    )[0];
  return open ? { order: open, time: 0, source: "open" } : null;
};

const findReminderAnchorForItem = async ({ itemCode, user } = {}) => {
  const normalizedItemCode = normalizeText(itemCode);
  if (!normalizedItemCode) return null;

  const orders = await Order.find(
    applyDataAccessMatch(
      { ...ACTIVE_ORDER_MATCH, ...itemCodeMatch([normalizedItemCode]) },
      user,
    ),
  )
    .select("_id order_id order_date createdAt shipment quantity status qc_record")
    .populate({
      path: "qc_record",
      select: "_id inspector last_inspected_date quantities request_history inspection_record",
      populate: {
        path: "inspection_record",
        select: "inspection_date createdAt updatedAt",
      },
    })
    .lean();

  return selectReminderAnchor(orders);
};

const findPendingAdminReminderWarnings = async ({ targets = [], user } = {}) => {
  const normalizedTargets = (Array.isArray(targets) ? targets : [])
    .map((target) => ({
      itemCode: normalizeText(target?.itemCode || target?.item_code),
      targetOrderId: normalizeText(target?.targetOrderId || target?.order_id),
    }))
    .filter((target) => target.itemCode);
  if (normalizedTargets.length === 0) return [];

  const orders = await Order.find(
    applyDataAccessMatch(
      { ...ACTIVE_ORDER_MATCH, ...itemCodeMatch(normalizedTargets.map((target) => target.itemCode)) },
      user,
    ),
  ).select("_id order_id item reminders").lean();

  return normalizedTargets.flatMap((target) => {
    const itemCode = normalizeItemCode(target.itemCode);
    const targetOrderId = normalizeText(target.targetOrderId).toLowerCase();
    return orders.flatMap((order) => {
      if (normalizeItemCode(order?.item?.item_code) !== itemCode) return [];
      if (normalizeText(order?.order_id).toLowerCase() === targetOrderId) return [];
      return (Array.isArray(order?.reminders) ? order.reminders : [])
        .filter(isPendingAdminReminder)
        .map((reminder) => ({
          ...serializeReminder({ reminder, order }),
          item_code: normalizeText(order?.item?.item_code),
          target_order_id: target.targetOrderId,
        }));
    });
  });
};

const parseAcknowledgedReminderIds = (value) => {
  let values = value;
  if (typeof values === "string") {
    try {
      values = JSON.parse(values);
    } catch {
      values = values.split(",");
    }
  }
  return new Set((Array.isArray(values) ? values : []).map((entry) => normalizeText(entry)).filter(Boolean));
};

const getUnacknowledgedReminderWarnings = ({ warnings = [], acknowledgedReminderIds } = {}) => {
  const acknowledged = acknowledgedReminderIds instanceof Set
    ? acknowledgedReminderIds
    : parseAcknowledgedReminderIds(acknowledgedReminderIds);
  return (Array.isArray(warnings) ? warnings : []).filter(
    (warning) => !acknowledged.has(String(warning?._id || "")),
  );
};

module.exports = {
  ACTIVE_ORDER_MATCH,
  REMINDER_STATUSES,
  REMINDER_TYPES,
  findPendingAdminReminderWarnings,
  findReminderAnchorForItem,
  getUnacknowledgedReminderWarnings,
  isPendingAdminReminder,
  isPendingReminder,
  normalizeReminderStatus,
  normalizeReminderType,
  normalizeText,
  parseAcknowledgedReminderIds,
  serializeReminder,
  selectReminderAnchor,
};
