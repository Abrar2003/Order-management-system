const crypto = require("crypto");
const Order = require("../models/order.model");
const Sample = require("../models/sample.model");
const Item = require("../models/item.model");
const Vendor = require("../models/vendor.model");
const { getVendorId, getVendorName } = require("../helpers/vendorRef");
const { invoiceKey, normalizeIdentifier, parseTimberCft, shipmentMilliCft, toMilliCft } = require("../helpers/timberCft");

const text = (value) => String(value ?? "").trim();
const key = (value) => text(value).toLowerCase();
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const resolveVendor = (raw, vendors) => {
  const id = getVendorId(raw);
  if (id) return vendors.find((vendor) => String(vendor._id) === String(id)) || null;
  const name = key(getVendorName(raw));
  const matches = vendors.filter((vendor) => key(vendor.name) === name);
  return matches.length === 1 ? matches[0] : null;
};

const loadContainer = async (container) => {
  const containerKey = key(container);
  if (!containerKey) throw fail("Container is required");
  const exact = new RegExp(`^${text(container).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  const [orders, samples] = await Promise.all([
    Order.find({ "shipment.container": exact }).select("vendor item.item_code order_id shipment").lean(),
    Sample.find({ "shipment.container": exact }).select("vendor code shipment timber_cft").lean(),
  ]);
  const refs = [...orders.map((order) => order.vendor), ...samples.flatMap((sample) => Array.isArray(sample.vendor) ? sample.vendor : sample.vendor ? [sample.vendor] : [])];
  const ids = [...new Set(refs.map(getVendorId).filter(Boolean))];
  const names = [...new Set(refs.map(getVendorName).filter(Boolean))];
  const vendors = ids.length || names.length
    ? await Vendor.find({ deleted_at: { $exists: false }, $or: [{ _id: { $in: ids } }, ...names.map((name) => ({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }))] }).select("name gst pan").lean()
    : [];
  const codes = [...new Set(orders.map((order) => text(order?.item?.item_code)).filter(Boolean))];
  const items = await Item.find({ code: { $in: codes } }).select("code timber_cft").lean();
  const itemByCode = new Map(items.map((item) => [key(item.code), item]));
  const groups = new Map();
  const unassigned = [];
  const add = (vendor, row) => {
    if (!vendor) { unassigned.push(row); return; }
    const vendorId = String(vendor._id);
    if (!groups.has(vendorId)) groups.set(vendorId, { vendor, rows: [], stuffed_milli_cft: 0, excluded: [] });
    const group = groups.get(vendorId);
    group.rows.push(row);
    if (row.timber_cft == null) group.excluded.push(row);
    else group.stuffed_milli_cft += row.line_milli_cft;
  };
  for (const order of orders) {
    const vendor = resolveVendor(order.vendor, vendors);
    const item = itemByCode.get(key(order?.item?.item_code));
    for (const shipment of order.shipment || []) {
      if (key(shipment.container) !== containerKey || Number(shipment.quantity) <= 0) continue;
      const timberCft = item?.timber_cft ?? null;
      add(vendor, { source: "order", source_id: String(order._id), shipment_id: String(shipment._id), order_id: text(order.order_id), invoice_number: text(shipment.invoice_number), code: text(order?.item?.item_code), quantity: Number(shipment.quantity), timber_cft: timberCft, line_milli_cft: timberCft == null ? null : shipmentMilliCft(timberCft, shipment.quantity) });
    }
  }
  for (const sample of samples) {
    const sampleVendors = Array.isArray(sample.vendor) ? sample.vendor : sample.vendor ? [sample.vendor] : [];
    const vendor = sampleVendors.length === 1 ? resolveVendor(sampleVendors[0], vendors) : null;
    for (const shipment of sample.shipment || []) {
      if (key(shipment.container) !== containerKey || Number(shipment.quantity) <= 0) continue;
      const timberCft = sample.timber_cft ?? null;
      add(vendor, { source: "sample", source_id: String(sample._id), shipment_id: String(shipment._id), order_id: "Sample", invoice_number: text(shipment.invoice_number), code: text(sample.code), quantity: Number(shipment.quantity), timber_cft: timberCft, line_milli_cft: timberCft == null ? null : shipmentMilliCft(timberCft, shipment.quantity) });
    }
  }
  const result = [...groups.values()].map((group) => ({
    ...group,
    vendor: { _id: String(group.vendor._id), name: group.vendor.name, gst: group.vendor.gst || "", pan: group.vendor.pan || "" },
    stuffed_cft: group.stuffed_milli_cft / 1000,
    shipment_signature: hash(group.rows.map((row) => [row.source, row.source_id, row.shipment_id, row.order_id, row.invoice_number, row.code, row.quantity, row.timber_cft]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))),
    vendor_signature: hash([normalizeIdentifier(group.vendor.gst), normalizeIdentifier(group.vendor.pan)]),
  }));
  return { container: text(container), vendors: result, unassigned };
};

const findGroup = (containerData, vendorId) => containerData.vendors.find((group) => group.vendor._id === String(vendorId));
const receiverMatches = (fields, vendor) => normalizeIdentifier(fields.gst) === normalizeIdentifier(vendor.gst) && normalizeIdentifier(fields.pan) === normalizeIdentifier(vendor.pan);
const nextStageKind = (stage, vendor) => stage.kind === "sawmill" ? "transport" : stage.kind === "transport" ? "receiver" : stage.kind === "receiver" ? receiverMatches(stage.fields || {}, vendor) ? "declaration" : "transport" : null;
const externalInvalidation = (stages, group) => {
  if (!group) return { index: 0, reason: "Shipment/vendor link changed" };
  const finalReceiver = stages.findIndex((stage, index) => stage.kind === "receiver" && stages[index + 1]?.kind === "declaration");
  if (finalReceiver >= 0 && stages[finalReceiver].verified_at && stages[finalReceiver].vendor_signature !== group.vendor_signature) return { index: finalReceiver, reason: "Vendor GST/PAN changed" };
  const declaration = stages.findIndex((stage) => stage.kind === "declaration");
  if (declaration >= 0 && stages[declaration].verified_at && stages[declaration].shipment_signature !== group.shipment_signature) return { index: declaration, reason: "Stuffed shipment or Timber_CFT changed" };
  return null;
};

const required = {
  sawmill: ["name", "gst", "pan", "permission_number", "invoice_number", "invoice_date"],
  transport: ["transporter_name", "truck_number", "driver_license_number", "ewaybill_number", "billty_number"],
  receiver: ["name", "gst", "pan", "received_cft", "invoice_number", "invoice_date", "issuer_name", "issuer_gst", "issuer_pan"],
  declaration: [],
};
const documents = {
  sawmill: ["cutting_invoice", "license", "permission"],
  transport: ["weight_slip", "billty", "driver_license", "ewaybill"],
  receiver: ["invoice"],
  declaration: ["declaration"],
};
const allowedFields = {
  sawmill: [...required.sawmill, "cutting_limit_cft"],
  transport: [...required.transport, "truck_registration_number", "gst"],
  receiver: required.receiver,
  declaration: [],
};
const assertStageAvailable = (stages, index) => {
  if (index > 0 && !stages[index - 1].verified_at) throw fail("Verify the preceding stage first", 409);
};
const assertDeclaredCft = (declaredMilliCft, group) => {
  if (declaredMilliCft !== group.stuffed_milli_cft) {
    const difference = Math.abs(declaredMilliCft - group.stuffed_milli_cft) / 1000;
    const direction = declaredMilliCft < group.stuffed_milli_cft ? "below" : "above";
    throw fail(`Declared CFT (${(declaredMilliCft / 1000).toFixed(3)}) does not match stuffed CFT (${group.stuffed_cft.toFixed(3)}): ${difference.toFixed(3)} ${direction}. Enter ${group.stuffed_cft.toFixed(3)} to continue.`, 409);
  }
};
const assertFinalCft = (chain, group, unassigned) => {
  if (unassigned.length) throw fail("Unassigned shipments must be resolved before final declaration", 409);
  assertDeclaredCft(chain.declared_milli_cft, group);
};

const validateStage = (stage) => {
  const fields = stage.fields || {};
  for (const field of required[stage.kind]) if (!text(fields[field])) throw fail(`${field.replace(/_/g, " ")} is required`);
  if (stage.kind === "receiver") parseTimberCft(fields.received_cft);
  if (stage.kind === "sawmill" && text(fields.cutting_limit_cft)) parseTimberCft(fields.cutting_limit_cft);
  const present = new Set(stage.documents.map((document) => document.type));
  for (const type of documents[stage.kind]) if (!present.has(type)) throw fail(`${type.replace(/_/g, " ")} document is required`);
  if (stage.kind === "transport" && text(fields.truck_registration_number) && !present.has("truck_registration")) throw fail("Truck registration document is required when its number is entered");
};

const collectInvoiceKeys = (stages) => {
  const keys = stages.filter((stage) => ["sawmill", "receiver"].includes(stage.kind) && text(stage.fields?.invoice_number) && text(stage.fields?.invoice_date) && text(stage.kind === "sawmill" ? stage.fields?.gst : stage.fields?.issuer_gst)).map((stage) => invoiceKey({ issuer_gst: stage.kind === "sawmill" ? stage.fields?.gst : stage.fields?.issuer_gst, invoice_number: stage.fields?.invoice_number, invoice_date: stage.fields?.invoice_date }));
  if (new Set(keys).size !== keys.length) throw fail("This invoice number is already used by this issuer in this financial year", 409);
  return keys;
};

module.exports = { text, key, fail, loadContainer, findGroup, receiverMatches, nextStageKind, externalInvalidation, required, documents, allowedFields, assertStageAvailable, assertDeclaredCft, assertFinalCft, validateStage, collectInvoiceKeys, toMilliCft };
