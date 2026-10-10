const crypto = require("node:crypto");
const mongoose = require("mongoose");

const Order = require("../models/order.model");
const TimberPurchase = require("../models/timberPurchase.model");
const TimberInventoryBalance = require("../models/timberInventoryBalance.model");
const TimberInventoryLedger = require("../models/timberInventoryLedger.model");
const TimberContainerConsumption = require("../models/timberContainerConsumption.model");
const { getVendorAccessOptions } = require("../services/userDataAccess.service");
const { buildVendorAccessCondition, getVendorId, getVendorName } = require("../helpers/vendorRef");
const { normalizeText } = require("../helpers/eudrTimber");
const {
  normalizeContainerNumber,
  consumptionGroupKey,
  parseCftToMilli,
  parseShipmentRefKey,
  receiptCreditDeltas,
  shipmentRefKey,
  toCft,
} = require("../helpers/eudrInventory");
const {
  confirmConsumption,
  createHttpError,
  reverseConsumption,
  runInventoryTransaction,
  syncApprovedPurchaseReceipts,
} = require("../services/eudrInventory.service");

const MAX_LIST_LIMIT = 100;
const ACTIVE_CONSUMPTION_STATUSES = ["DRAFT", "CONFIRMED"];

const buildActor = (user = {}) => ({
  user: user?._id || user?.id || null,
  name: normalizeText(user?.name) || normalizeText(user?.email) || "Unknown",
});

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseDate = (value, label, { required = false } = {}) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    if (required) throw createHttpError(400, `${label} is required`);
    return null;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw createHttpError(400, `${label} is invalid`);
  return date;
};

const dateKey = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "";
};

const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getAccessibleManufacturers = async (user) => getVendorAccessOptions({ user });

const getAccessibleManufacturerIds = async (user) =>
  (await getAccessibleManufacturers(user)).map((vendor) => String(vendor._id));

const assertManufacturerAccess = async (manufacturerId, user) => {
  if (!mongoose.Types.ObjectId.isValid(String(manufacturerId || ""))) {
    throw createHttpError(400, "Select a valid furniture manufacturer");
  }
  const manufacturer = (await getAccessibleManufacturers(user)).find(
    (vendor) => String(vendor._id) === String(manufacturerId),
  );
  if (!manufacturer) throw createHttpError(403, "You do not have access to this manufacturer");
  return manufacturer;
};

const manufacturerSnapshot = (vendor) => ({
  vendor_id: vendor._id,
  name: vendor.name || "Unknown manufacturer",
  country: vendor.country || "",
});

const serializeBalance = (balance = {}, fallbackManufacturer = null) => {
  const raw = balance.toObject ? balance.toObject() : balance;
  const snapshot = raw.manufacturer_snapshot || (fallbackManufacturer ? manufacturerSnapshot(fallbackManufacturer) : null);
  return {
    manufacturer_vendor_id: String(raw.manufacturer_vendor_id || snapshot?.vendor_id || ""),
    manufacturer: snapshot,
    approved_received_cft: toCft(raw.approved_received_units || 0),
    consumed_cft: toCft(raw.consumed_units || 0),
    net_adjustment_cft: toCft(raw.net_adjustment_units || 0),
    available_cft: toCft(raw.available_units || 0),
    approved_received_units: Number(raw.approved_received_units || 0),
    consumed_units: Number(raw.consumed_units || 0),
    net_adjustment_units: Number(raw.net_adjustment_units || 0),
    available_units: Number(raw.available_units || 0),
    last_purchase_date: raw.last_receipt_at || null,
    last_consumption_date: raw.last_consumption_at || null,
    version: Number(raw.version || 0),
  };
};

const serializeLedger = (entry = {}) => ({
  _id: String(entry._id || ""),
  manufacturer_vendor_id: String(entry.manufacturer_vendor_id || ""),
  transaction_type: entry.transaction_type || "",
  source_type: entry.source_type || "",
  source_event_key: entry.source_event_key || "",
  timber_purchase_id: String(entry.timber_purchase_id || ""),
  timber_receipt_id: String(entry.timber_receipt_id || ""),
  container_consumption_id: String(entry.container_consumption_id || ""),
  credit_cft: Number(entry.signed_delta_units || 0) > 0 ? toCft(entry.signed_delta_units) : "0",
  debit_cft: Number(entry.signed_delta_units || 0) < 0 ? toCft(Math.abs(entry.signed_delta_units)) : "0",
  balance_after_cft: toCft(entry.balance_after_units || 0),
  signed_delta_units: Number(entry.signed_delta_units || 0),
  balance_after_units: Number(entry.balance_after_units || 0),
  remarks: entry.remarks || "",
  created_by: entry.created_by || null,
  created_at: entry.created_at || null,
  reversal_of_transaction_id: String(entry.reversal_of_transaction_id || ""),
});

const shipmentSnapshot = ({ order, shipment }) => ({
  ref_key: shipmentRefKey(order._id, shipment._id),
  order_id: order._id,
  order_number: String(order.order_id || ""),
  item_code: String(order.item?.item_code || ""),
  shipment_id: shipment._id,
  container_number: String(shipment.container || "").trim(),
  stuffing_date: shipment.stuffing_date || null,
  invoice_number: String(shipment.invoice_number || "").trim(),
  shipment_quantity: Number.isFinite(Number(shipment.quantity)) ? Number(shipment.quantity) : null,
});

const getOrdersWithShipmentReferences = async ({ refKeys = [], container = "", user, session = null }) => {
  const manufacturers = await getAccessibleManufacturers(user);
  const accessCondition = buildVendorAccessCondition({ fields: ["vendor"], vendors: manufacturers });
  const requested = [...new Set((Array.isArray(refKeys) ? refKeys : []).map((key) => String(key || "").trim()).filter(Boolean))];
  const parsed = requested.map(parseShipmentRefKey);
  if (requested.length > 0 && parsed.some((entry) => !entry || !mongoose.Types.ObjectId.isValid(entry.orderId) || !mongoose.Types.ObjectId.isValid(entry.shipmentId))) {
    throw createHttpError(400, "Invalid OMS shipment reference");
  }
  const shipmentMatch = container
    ? { "shipment.container": { $regex: escapeRegex(container), $options: "i" } }
    : requested.length > 0
      ? { _id: { $in: parsed.map((entry) => entry.orderId) } }
      : { "shipment.container": { $exists: true, $ne: "" } };
  const query = Order.find({ $and: [accessCondition, shipmentMatch] })
    .select("order_id item vendor shipment status updatedAt")
    .sort({ updatedAt: -1, _id: -1 })
    .limit(requested.length > 0 ? requested.length : 250);
  if (session) query.session(session);
  const orders = await query.lean();
  const rows = [];

  for (const order of orders) {
    const manufacturerId = getVendorId(order.vendor);
    if (!manufacturerId) continue;
    const manufacturer = manufacturers.find((vendor) => String(vendor._id) === String(manufacturerId));
    if (!manufacturer) continue;
    for (const shipment of Array.isArray(order.shipment) ? order.shipment : []) {
      const ref = shipmentSnapshot({ order, shipment });
      if (requested.length > 0 && !requested.includes(ref.ref_key)) continue;
      if (container && !String(shipment.container || "").toLowerCase().includes(String(container).toLowerCase())) continue;
      rows.push({ order, shipment, manufacturer, manufacturer_id: String(manufacturerId), reference: ref });
    }
  }
  if (requested.length > 0 && rows.length !== requested.length) {
    throw createHttpError(409, "One or more selected OMS shipment rows no longer exist or are not accessible");
  }
  return rows;
};

const validateConsumptionReferences = async ({ refKeys, user, session = null }) => {
  const rows = await getOrdersWithShipmentReferences({ refKeys, user, session });
  if (rows.length === 0) throw createHttpError(400, "Select at least one existing OMS shipment row");
  const manufacturerIds = new Set(rows.map((row) => row.manufacturer_id));
  const containers = new Set(rows.map((row) => normalizeContainerNumber(row.reference.container_number)));
  const stuffingDates = new Set(rows.map((row) => dateKey(row.reference.stuffing_date)));
  if (manufacturerIds.size !== 1) throw createHttpError(400, "Selected OMS shipment rows must belong to one manufacturer");
  if (containers.size !== 1) throw createHttpError(400, "Selected OMS shipment rows must belong to one physical container");
  if (stuffingDates.size !== 1) throw createHttpError(400, "Select shipment rows with the same stuffing date; this container number is ambiguous");

  return {
    manufacturer: rows[0].manufacturer,
    container_number: rows[0].reference.container_number,
    container_number_normalized: normalizeContainerNumber(rows[0].reference.container_number),
    stuffing_date: rows[0].reference.stuffing_date || null,
    refs: rows.map((row) => row.reference),
    ref_keys: rows.map((row) => row.reference.ref_key),
    invoice_numbers: [...new Set(rows.map((row) => row.reference.invoice_number).filter(Boolean))],
    active_shipment_group_key: consumptionGroupKey(rows[0].manufacturer_id, rows[0].reference.container_number, rows[0].reference.stuffing_date),
  };
};

const reconciliationForConsumption = async (consumption, user) => {
  try {
    const current = await validateConsumptionReferences({ refKeys: consumption.oms_shipment_ref_keys, user });
    const expected = new Map((consumption.oms_shipment_refs || []).map((reference) => [reference.ref_key, reference]));
    const changed = current.refs.some((reference) => {
      const previous = expected.get(reference.ref_key);
      return !previous || previous.container_number !== reference.container_number || dateKey(previous.stuffing_date) !== dateKey(reference.stuffing_date) || previous.invoice_number !== reference.invoice_number;
    });
    return { reconciliation_required: changed, reconciliation_message: changed ? "Linked OMS shipment details changed after this record was created." : "" };
  } catch (error) {
    return { reconciliation_required: true, reconciliation_message: error.message || "A linked OMS shipment is no longer available." };
  }
};

const serializeConsumption = async (consumption = {}, user = null) => {
  const raw = consumption.toObject ? consumption.toObject() : consumption;
  const reconciliation = user ? await reconciliationForConsumption(raw, user) : {};
  return {
    _id: String(raw._id || ""),
    manufacturer_vendor_id: String(raw.manufacturer_vendor_id || ""),
    manufacturer: raw.manufacturer_snapshot || null,
    container_number: raw.container_number || "",
    shipment_group_id: raw.shipment_group_id || "",
    oms_shipment_refs: raw.oms_shipment_refs || [],
    stuffing_date: raw.stuffing_date || null,
    invoice_numbers: raw.invoice_numbers || [],
    reported_cft: toCft(raw.reported_cft_units || 0),
    confirmed_cft: toCft(raw.confirmed_cft_units || 0),
    reported_cft_units: Number(raw.reported_cft_units || 0),
    confirmed_cft_units: Number(raw.confirmed_cft_units || 0),
    status: raw.status || "DRAFT",
    inventory_accounting_status: raw.status === "CONFIRMED" ? "ACCOUNTED" : "UNACCOUNTED",
    eudr_evidence_status: "NOT_ASSESSED",
    remarks: raw.remarks || "",
    reported_by: raw.reported_by || null,
    reported_at: raw.reported_at || null,
    confirmed_by: raw.confirmed_by || null,
    confirmed_at: raw.confirmed_at || null,
    reversed_by: raw.reversed_by || null,
    reversed_at: raw.reversed_at || null,
    reversal_reason: raw.reversal_reason || "",
    ...reconciliation,
  };
};

const getInventoryRows = async (user, query = {}) => {
  const [manufacturers, balances] = await Promise.all([
    getAccessibleManufacturers(user),
    TimberInventoryBalance.find({ manufacturer_vendor_id: { $in: await getAccessibleManufacturerIds(user) } }).lean(),
  ]);
  const balanceByManufacturer = new Map(balances.map((balance) => [String(balance.manufacturer_vendor_id), balance]));
  const search = normalizeText(query.search).toLowerCase();
  const availability = normalizeText(query.availability).toLowerCase();
  return manufacturers
    .map((manufacturer) => serializeBalance(balanceByManufacturer.get(String(manufacturer._id)) || { manufacturer_vendor_id: manufacturer._id }, manufacturer))
    .filter((row) => !search || String(row.manufacturer?.name || "").toLowerCase().includes(search))
    .filter((row) => availability !== "positive" || row.available_units > 0)
    .filter((row) => availability !== "zero" || row.available_units === 0)
    .sort((left, right) => String(left.manufacturer?.name || "").localeCompare(String(right.manufacturer?.name || "")));
};

exports.listInventory = async (req, res) => {
  try {
    const rows = await getInventoryRows(req.user, req.query);
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(MAX_LIST_LIMIT, parsePositiveInt(req.query.limit, 25));
    const pendingPurchaseCount = await TimberPurchase.countDocuments({
      manufacturer_vendor_id: { $in: await getAccessibleManufacturerIds(req.user) },
      verification_status: { $in: ["DRAFT", "SUBMITTED", "NEEDS_INFORMATION"] },
    });
    const totals = rows.reduce((summary, row) => ({
      approved_received_units: summary.approved_received_units + row.approved_received_units,
      consumed_units: summary.consumed_units + row.consumed_units,
      net_adjustment_units: summary.net_adjustment_units + row.net_adjustment_units,
      available_units: summary.available_units + row.available_units,
    }), { approved_received_units: 0, consumed_units: 0, net_adjustment_units: 0, available_units: 0 });
    return res.json({
      success: true,
      data: rows.slice((page - 1) * limit, page * limit),
      summary: {
        total_approved_received_cft: toCft(totals.approved_received_units),
        total_confirmed_consumed_cft: toCft(totals.consumed_units),
        remaining_unallocated_cft: toCft(totals.available_units),
        pending_purchase_verification_count: pendingPurchaseCount,
      },
      pagination: { page, limit, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / limit)) },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to load timber inventory" });
  }
};

exports.getInventory = async (req, res) => {
  try {
    const manufacturer = await assertManufacturerAccess(req.params.manufacturerId, req.user);
    const balance = await TimberInventoryBalance.findOne({ manufacturer_vendor_id: manufacturer._id }).lean();
    const [purchases, consumptions, ledger] = await Promise.all([
      TimberPurchase.find({ manufacturer_vendor_id: manufacturer._id }).sort({ invoice_date: -1, created_at: -1 }).limit(100).lean(),
      TimberContainerConsumption.find({ manufacturer_vendor_id: manufacturer._id }).sort({ stuffing_date: -1, created_at: -1 }).limit(100).lean(),
      TimberInventoryLedger.find({ manufacturer_vendor_id: manufacturer._id }).sort({ created_at: -1 }).limit(100).lean(),
    ]);
    return res.json({
      success: true,
      data: {
        balance: serializeBalance(balance || { manufacturer_vendor_id: manufacturer._id }, manufacturer),
        purchases: purchases.map((purchase) => ({
          _id: String(purchase._id), purchase_number: purchase.purchase_number, invoice_number: purchase.invoice_number,
          supplier: purchase.supplier_snapshot || null, invoice_date: purchase.invoice_date || null,
          invoiced_cft: toCft(purchase.purchased_cft_milli || 0), approved_received_cft: purchase.verification_status === "APPROVED" ? toCft(purchase.received_cft_milli || 0) : "0",
          verification_status: purchase.verification_status,
        })),
        consumptions: await Promise.all(consumptions.map((consumption) => serializeConsumption(consumption, req.user))),
        ledger: ledger.map(serializeLedger),
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to load manufacturer timber inventory" });
  }
};

exports.listInventoryLedger = async (req, res) => {
  try {
    const manufacturer = await assertManufacturerAccess(req.params.manufacturerId, req.user);
    const match = { manufacturer_vendor_id: manufacturer._id };
    const transactionType = normalizeText(req.query.transaction_type);
    if (transactionType) match.transaction_type = transactionType;
    const from = parseDate(req.query.date_from, "From date");
    const to = parseDate(req.query.date_to, "To date");
    if (from || to) {
      match.created_at = {};
      if (from) match.created_at.$gte = from;
      if (to) { to.setUTCHours(23, 59, 59, 999); match.created_at.$lte = to; }
    }
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(MAX_LIST_LIMIT, parsePositiveInt(req.query.limit, 50));
    const [entries, total] = await Promise.all([
      TimberInventoryLedger.find(match).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      TimberInventoryLedger.countDocuments(match),
    ]);
    return res.json({ success: true, data: entries.map(serializeLedger), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to load timber ledger" });
  }
};

exports.listInventoryPurchases = async (req, res) => {
  try {
    const manufacturer = await assertManufacturerAccess(req.params.manufacturerId, req.user);
    const purchases = await TimberPurchase.find({ manufacturer_vendor_id: manufacturer._id }).sort({ invoice_date: -1, created_at: -1 }).lean();
    return res.json({ success: true, data: purchases.map((purchase) => ({
      _id: String(purchase._id), purchase_number: purchase.purchase_number, invoice_number: purchase.invoice_number,
      supplier: purchase.supplier_snapshot || null, invoice_date: purchase.invoice_date || null,
      invoiced_cft: toCft(purchase.purchased_cft_milli || 0), received_cft: toCft(purchase.received_cft_milli || 0),
      verification_status: purchase.verification_status, documents: (purchase.documents || []).map((document) => ({ _id: String(document._id), category: document.category, original_name: document.original_name })),
    })) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to load timber purchases" });
  }
};

exports.listInventoryConsumptions = async (req, res) => {
  try {
    const manufacturer = await assertManufacturerAccess(req.params.manufacturerId, req.user);
    const consumptions = await TimberContainerConsumption.find({ manufacturer_vendor_id: manufacturer._id }).sort({ stuffing_date: -1, created_at: -1 }).lean();
    return res.json({ success: true, data: await Promise.all(consumptions.map((consumption) => serializeConsumption(consumption, req.user))) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to load timber consumptions" });
  }
};

exports.getContainerCandidates = async (req, res) => {
  try {
    const rows = await getOrdersWithShipmentReferences({ container: normalizeText(req.query.container || req.query.search), user: req.user });
    const activeRefs = rows.map((row) => row.reference.ref_key);
    const groupKeys = rows.map((row) => consumptionGroupKey(row.manufacturer_id, row.reference.container_number, row.reference.stuffing_date));
    const claimed = await TimberContainerConsumption.find({
      status: { $in: ACTIVE_CONSUMPTION_STATUSES },
      $or: [{ oms_shipment_ref_keys: { $in: activeRefs } }, { active_shipment_group_key: { $in: groupKeys } }],
    }).select("oms_shipment_ref_keys active_shipment_group_key").lean();
    const claimedKeys = new Set(claimed.flatMap((consumption) => consumption.oms_shipment_ref_keys || []));
    const claimedGroups = new Set(claimed.map((consumption) => consumption.active_shipment_group_key).filter(Boolean));
    const groups = new Map();
    for (const row of rows) {
      if (claimedKeys.has(row.reference.ref_key) || claimedGroups.has(consumptionGroupKey(row.manufacturer_id, row.reference.container_number, row.reference.stuffing_date))) continue;
      const key = [row.manufacturer_id, normalizeContainerNumber(row.reference.container_number), dateKey(row.reference.stuffing_date)].join("|");
      const group = groups.get(key) || {
        manufacturer_vendor_id: row.manufacturer_id,
        manufacturer: manufacturerSnapshot(row.manufacturer),
        container_number: row.reference.container_number,
        stuffing_date: row.reference.stuffing_date || null,
        shipment_refs: [],
      };
      group.shipment_refs.push(row.reference);
      groups.set(key, group);
    }
    const candidates = [...groups.values()].map((group) => ({
      ...group,
      invoice_numbers: [...new Set(group.shipment_refs.map((ref) => ref.invoice_number).filter(Boolean))],
      ambiguous_container: [...groups.values()].filter((candidate) => candidate.manufacturer_vendor_id === group.manufacturer_vendor_id && normalizeContainerNumber(candidate.container_number) === normalizeContainerNumber(group.container_number)).length > 1,
    })).slice(0, MAX_LIST_LIMIT);
    return res.json({ success: true, data: candidates });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to load OMS container candidates" });
  }
};

const assertNoActiveReferenceConflict = async (refKeys, groupKey, exceptId = "") => {
  const conflict = await TimberContainerConsumption.findOne({
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    status: { $in: ACTIVE_CONSUMPTION_STATUSES },
    $or: [{ oms_shipment_ref_keys: { $in: refKeys } }, { active_shipment_group_key: groupKey }],
  }).lean();
  if (conflict) throw createHttpError(409, "An active timber consumption record already uses one of the selected OMS shipment rows");
};

const consumptionInput = async (body, user) => {
  const refKeys = body?.oms_shipment_ref_keys || body?.shipment_ref_keys;
  if (!Array.isArray(refKeys) || refKeys.length === 0) throw createHttpError(400, "Select at least one OMS shipment row");
  const refs = await validateConsumptionReferences({ refKeys, user });
  return {
    ...refs,
    reported_cft_units: parseCftToMilli(body?.reported_cft),
    remarks: normalizeText(body?.remarks),
  };
};

exports.createConsumption = async (req, res) => {
  try {
    const input = await consumptionInput(req.body || {}, req.user);
    await assertNoActiveReferenceConflict(input.ref_keys, input.active_shipment_group_key);
    const consumption = await TimberContainerConsumption.create({
      manufacturer_vendor_id: input.manufacturer._id,
      manufacturer_snapshot: manufacturerSnapshot(input.manufacturer),
      container_number: input.container_number,
      container_number_normalized: input.container_number_normalized,
      shipment_group_id: crypto.randomUUID(),
      active_shipment_group_key: input.active_shipment_group_key,
      oms_shipment_refs: input.refs,
      oms_shipment_ref_keys: input.ref_keys,
      stuffing_date: input.stuffing_date,
      invoice_numbers: input.invoice_numbers,
      reported_cft_units: input.reported_cft_units,
      remarks: input.remarks,
      reported_by: buildActor(req.user),
      reported_at: new Date(),
    });
    return res.status(201).json({ success: true, data: await serializeConsumption(consumption, req.user) });
  } catch (error) {
    const status = error.code === 11000 ? 409 : error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.code === 11000 ? "An active timber consumption record already uses one of the selected OMS shipment rows" : error.message || "Failed to create timber consumption draft" });
  }
};

const getConsumptionOrThrow = async (id, user) => {
  if (!mongoose.Types.ObjectId.isValid(String(id || ""))) throw createHttpError(400, "Invalid consumption id");
  const consumption = await TimberContainerConsumption.findById(id);
  if (!consumption) throw createHttpError(404, "Timber consumption not found");
  await assertManufacturerAccess(consumption.manufacturer_vendor_id, user);
  return consumption;
};

exports.getConsumption = async (req, res) => {
  try {
    const consumption = await getConsumptionOrThrow(req.params.id, req.user);
    return res.json({ success: true, data: await serializeConsumption(consumption, req.user) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to load timber consumption" });
  }
};

exports.listConsumptions = async (req, res) => {
  try {
    const allowedIds = await getAccessibleManufacturerIds(req.user);
    const match = { manufacturer_vendor_id: { $in: allowedIds } };
    if (mongoose.Types.ObjectId.isValid(String(req.query.manufacturer_vendor_id || ""))) match.manufacturer_vendor_id = req.query.manufacturer_vendor_id;
    if (normalizeText(req.query.status)) match.status = normalizeText(req.query.status);
    const consumptions = await TimberContainerConsumption.find(match).sort({ stuffing_date: -1, created_at: -1 }).limit(MAX_LIST_LIMIT).lean();
    return res.json({ success: true, data: await Promise.all(consumptions.map((consumption) => serializeConsumption(consumption, req.user))) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to load timber consumptions" });
  }
};

exports.updateConsumption = async (req, res) => {
  try {
    const consumption = await getConsumptionOrThrow(req.params.id, req.user);
    if (consumption.status !== "DRAFT") throw createHttpError(409, "Only draft timber consumption can be edited");
    const body = req.body || {};
    if (body.oms_shipment_ref_keys || body.shipment_ref_keys) {
      const input = await consumptionInput({ ...body, reported_cft: body.reported_cft ?? toCft(consumption.reported_cft_units) }, req.user);
      await assertNoActiveReferenceConflict(input.ref_keys, input.active_shipment_group_key, consumption._id);
      Object.assign(consumption, {
        manufacturer_vendor_id: input.manufacturer._id,
        manufacturer_snapshot: manufacturerSnapshot(input.manufacturer),
        container_number: input.container_number,
        container_number_normalized: input.container_number_normalized,
        active_shipment_group_key: input.active_shipment_group_key,
        oms_shipment_refs: input.refs,
        oms_shipment_ref_keys: input.ref_keys,
        stuffing_date: input.stuffing_date,
        invoice_numbers: input.invoice_numbers,
        reported_cft_units: input.reported_cft_units,
        remarks: input.remarks,
      });
    } else {
      if (Object.prototype.hasOwnProperty.call(body, "reported_cft")) consumption.reported_cft_units = parseCftToMilli(body.reported_cft);
      if (Object.prototype.hasOwnProperty.call(body, "remarks")) consumption.remarks = normalizeText(body.remarks);
    }
    await consumption.save();
    return res.json({ success: true, data: await serializeConsumption(consumption, req.user) });
  } catch (error) {
    const status = error.code === 11000 ? 409 : error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.code === 11000 ? "An active timber consumption record already uses one of the selected OMS shipment rows" : error.message || "Failed to update timber consumption" });
  }
};

const respondInventoryError = (res, error, fallback) => {
  const details = error.details ? {
    available_cft: toCft(error.details.available_units || 0),
    requested_cft: toCft(error.details.requested_units || 0),
    shortfall_cft: toCft(error.details.shortfall_units || 0),
  } : undefined;
  return res.status(error.statusCode || 500).json({ success: false, message: error.message || fallback, ...(details ? { details } : {}) });
};

exports.confirmConsumption = async (req, res) => {
  try {
    const actor = buildActor(req.user);
    const result = await runInventoryTransaction(async (session) => {
      const consumption = await TimberContainerConsumption.findById(req.params.id).session(session);
      if (!consumption) throw createHttpError(404, "Timber consumption not found");
      await assertManufacturerAccess(consumption.manufacturer_vendor_id, req.user);
      if (consumption.status === "DRAFT") await validateConsumptionReferences({ refKeys: consumption.oms_shipment_ref_keys, user: req.user, session });
      return confirmConsumption({ consumption, actor, session });
    });
    return res.json({ success: true, data: await serializeConsumption(result.consumption, req.user), idempotent: result.idempotent });
  } catch (error) {
    return respondInventoryError(res, error, "Failed to confirm timber consumption");
  }
};

exports.reverseConsumption = async (req, res) => {
  try {
    const reason = normalizeText(req.body?.reason);
    if (!reason) throw createHttpError(400, "A reversal reason is required");
    const actor = buildActor(req.user);
    const result = await runInventoryTransaction(async (session) => {
      const consumption = await TimberContainerConsumption.findById(req.params.id).session(session);
      if (!consumption) throw createHttpError(404, "Timber consumption not found");
      await assertManufacturerAccess(consumption.manufacturer_vendor_id, req.user);
      return reverseConsumption({ consumption, actor, reason, session });
    });
    return res.json({ success: true, data: await serializeConsumption(result.consumption, req.user), idempotent: result.idempotent });
  } catch (error) {
    return respondInventoryError(res, error, "Failed to reverse timber consumption");
  }
};

const buildReconciliation = async (user) => {
  const allowedIds = await getAccessibleManufacturerIds(user);
  const purchases = await TimberPurchase.find({ manufacturer_vendor_id: { $in: allowedIds }, verification_status: "APPROVED" }).lean();
  const purchaseIds = purchases.map((purchase) => purchase._id);
  const ledger = purchaseIds.length > 0
    ? await TimberInventoryLedger.find({ timber_purchase_id: { $in: purchaseIds }, transaction_type: { $in: ["RECEIPT_CREDIT", "RECEIPT_CORRECTION"] } }).lean()
    : [];
  const ledgerByPurchase = new Map();
  ledger.forEach((entry) => {
    const key = String(entry.timber_purchase_id);
    ledgerByPurchase.set(key, [...(ledgerByPurchase.get(key) || []), entry]);
  });
  const proposed = purchases.flatMap((purchase) => receiptCreditDeltas({ deliveryEntries: purchase.delivery_entries, ledgerEntries: ledgerByPurchase.get(String(purchase._id)) || [] }).map((delta) => ({
    manufacturer_vendor_id: String(purchase.manufacturer_vendor_id), manufacturer: purchase.manufacturer_snapshot || null,
    purchase_id: String(purchase._id), purchase_number: purchase.purchase_number, invoice_number: purchase.invoice_number,
    receipt_id: delta.receiptId, receipt_date: delta.receipt.delivery_date || null,
    delta_cft: toCft(delta.deltaUnits), action: delta.priorTransactionCount === 0 ? "RECEIPT_CREDIT" : "RECEIPT_CORRECTION",
  })));
  const balances = await TimberInventoryBalance.find({ manufacturer_vendor_id: { $in: allowedIds } }).lean();
  const ledgerTotals = await TimberInventoryLedger.aggregate([
    { $match: { manufacturer_vendor_id: { $in: allowedIds.map((id) => new mongoose.Types.ObjectId(id)) } } },
    { $group: { _id: "$manufacturer_vendor_id", available_units: { $sum: "$signed_delta_units" } } },
  ]);
  const ledgerTotalByManufacturer = new Map(ledgerTotals.map((entry) => [String(entry._id), Number(entry.available_units || 0)]));
  const mismatches = balances.filter((balance) => ledgerTotalByManufacturer.get(String(balance.manufacturer_vendor_id)) !== Number(balance.available_units || 0)).map((balance) => ({
    manufacturer_vendor_id: String(balance.manufacturer_vendor_id), expected_available_cft: toCft(ledgerTotalByManufacturer.get(String(balance.manufacturer_vendor_id)) || 0), cached_available_cft: toCft(balance.available_units || 0),
  }));
  return { proposed, mismatches };
};

exports.getReconciliation = async (req, res) => {
  try {
    return res.json({ success: true, data: await buildReconciliation(req.user) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to reconcile timber inventory" });
  }
};

exports.backfillApprovedReceipts = async (req, res) => {
  try {
    const dryRun = req.body?.confirm !== true;
    const reconciliation = await buildReconciliation(req.user);
    if (dryRun) return res.json({ success: true, dry_run: true, data: reconciliation });
    const purchaseIds = [...new Set(reconciliation.proposed.map((entry) => entry.purchase_id))];
    const purchases = await TimberPurchase.find({ _id: { $in: purchaseIds }, verification_status: "APPROVED" });
    const posted = [];
    for (const purchase of purchases) {
      posted.push(...await runInventoryTransaction((session) => syncApprovedPurchaseReceipts({ purchase, actor: buildActor(req.user), session })));
    }
    return res.json({ success: true, dry_run: false, posted_count: posted.filter((entry) => !entry.idempotent).length, data: await buildReconciliation(req.user) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to backfill approved timber receipts" });
  }
};

exports.exportInventory = async (req, res) => {
  try {
    const rows = await getInventoryRows(req.user, req.query);
    const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [
      ["Manufacturer", "Approved Received CFT", "Consumed CFT", "Net Adjustments CFT", "Remaining Unallocated CFT"],
      ...rows.map((row) => [row.manufacturer?.name || "", row.approved_received_cft, row.consumed_cft, row.net_adjustment_cft, row.available_cft]),
    ].map((row) => row.map(quote).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=timber-inventory-summary.csv");
    return res.send(csv);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to export timber inventory" });
  }
};

exports.__test__ = {
  dateKey,
  serializeBalance,
  shipmentSnapshot,
};
