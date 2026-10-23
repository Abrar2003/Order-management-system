const crypto = require("node:crypto");
const mongoose = require("mongoose");
const Order = require("../models/order.model");
const Sample = require("../models/sample.model");
const Item = require("../models/item.model");
const Vendor = require("../models/vendor.model");
const Species = require("../models/woodSpecies.model");
const { applyDataAccessMatch, isUserAllowedData } = require("../services/userDataAccess.service");
const { getVendorId, getVendorName } = require("../helpers/vendorRef");
const { fail } = require("./eudrV2.auth");
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalize = value => String(value || "").trim().toUpperCase();
const key = number => "c_" + Buffer.from(normalize(number)).toString("base64url");
function numberFromKey(value) {
  if (typeof value !== "string" || !/^c_[A-Za-z0-9_-]{1,110}$/.test(value)) throw fail("CONTAINER_KEY_INVALID", "Invalid container key", 400);
  const number = Buffer.from(value.slice(2), "base64url").toString("utf8");
  if (!number || number.length > 80 || key(number) !== value) throw fail("CONTAINER_KEY_INVALID", "Invalid container key", 400);
  return number;
}
const stable = value => value instanceof Date ? value.toISOString() : value?.toHexString ? value.toHexString() : Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
const checksum = value => crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
function lines(user, pattern, sample = false) {
  return [
    { $match: applyDataAccessMatch({ shipment: { $elemMatch: { container: pattern, quantity: { $gt: 0 } } } }, user) },
    { $unwind: "$shipment" },
    { $match: { "shipment.container": pattern, "shipment.quantity": { $gt: 0 } } },
    { $project: { _id: 0, source: { $literal: sample ? "sample" : "order" }, sourceId: "$_id", brand: 1, vendor: 1,
      itemCode: sample ? "$code" : "$item.item_code", description: sample ? "$description" : "$item.description",
      shipment: { _id: "$shipment._id", container: "$shipment.container", invoice_number: "$shipment.invoice_number", stuffing_date: "$shipment.stuffing_date", quantity: "$shipment.quantity" },
      ...(sample ? { timber_cft: 1, hs_code: 1, species_composition: 1 } : {}) } },
  ];
}
const sourcePipeline = (user, pattern) => [...lines(user, pattern), { $unionWith: { coll: "samples", pipeline: lines(user, pattern, true) } }];
async function search(user, query, page = 1, limit = 25) {
  if (typeof query !== "string" || !query.trim() || query.length > 80) throw fail("QUERY_INVALID", "Enter a container search of 1–80 characters", 400);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fail("PAGINATION_INVALID", "Page must be 1–1000 and limit 1–100", 400);
  const result = await Order.aggregate([...sourcePipeline(user, new RegExp(escape(query.trim()), "i")),
    { $group: { _id: { source: "$source", id: "$sourceId", shipment: "$shipment._id" }, line: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$line" } },
    { $group: { _id: { $toUpper: { $trim: { input: "$shipment.container" } } }, stuffingDate: { $min: "$shipment.stuffing_date" },
      invoices: { $addToSet: "$shipment.invoice_number" }, vendors: { $addToSet: "$vendor" }, shipmentLineCount: { $sum: 1 } } },
    { $sort: { _id: 1 } }, { $facet: { rows: [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: "count" }] } },
  ]).option({ maxTimeMS: 5000, allowDiskUse: false });
  const data = result[0];
  return { containers: data.rows.map(row => ({ key: key(row._id), number: row._id,
    stuffingDate: row.stuffingDate?.toISOString().slice(0, 10) || null,
    exportInvoiceNumbers: row.invoices.filter(Boolean).sort().slice(0, 100),
    vendors: row.vendors.flatMap(value => Array.isArray(value) ? value : [value]).map(value => ({ id: getVendorId(value) || null, name: getVendorName(value) })).slice(0, 100),
    shipmentLineCount: row.shipmentLineCount })), pagination: { page, limit, total: data.total[0]?.count || 0 } };
}
async function snapshot(user, containerKey) {
  const number = numberFromKey(containerKey);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const rows = await Order.aggregate([...lines(user, number), { $limit: 10001 }]).collation({ locale: "en", strength: 2 }).session(session).option({ maxTimeMS: 5000 });
      rows.push(...await Sample.aggregate([...lines(user, number, true), { $limit: 10001 }]).collation({ locale: "en", strength: 2 }).session(session).option({ maxTimeMS: 5000 }));
      if (!rows.length) throw fail("CONTAINER_NOT_FOUND", "No authorized stuffed shipment lines were found", 404);
      if (rows.length > 10000) throw fail("CONTAINER_TOO_LARGE", "Container exceeds the supported 10000 shipment lines", 413);
      const refs = rows.flatMap(row => Array.isArray(row.vendor) ? row.vendor : [row.vendor]);
      const ids = [...new Set(refs.map(getVendorId).filter(Boolean))];
      const names = [...new Set(refs.filter(ref => !getVendorId(ref)).map(getVendorName).filter(Boolean))];
      const vendorMatch = [...(ids.length ? [{ _id: { $in: ids } }] : []), ...(names.length ? [{ name: { $in: names.map(name => new RegExp("^" + escape(name) + "$", "i")) } }] : [])];
      const vendors = vendorMatch.length ? await Vendor.find({ $or: vendorMatch, deleted_at: null }).select("_id name gst pan").session(session).lean() : [];
      const codes = [...new Set(rows.filter(row => row.source === "order").map(row => row.itemCode).filter(Boolean))];
      const items = codes.length ? await Item.find({ code: { $in: codes } }).select("_id code description name timber_cft hs_code species_composition").session(session).lean() : [];
      result = normalizeSnapshot(containerKey, number, rows, vendors, items, user);
      if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw fail("CONTAINER_TOO_LARGE", "Snapshot exceeds the EUDR 2 MB response limit", 413);
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally { await session.endSession(); }
  return result;
}
function normalizeSnapshot(containerKey, number, rows, vendors, masters, user) {
  const groups = new Map(), shipments = new Map(), dates = new Set();
  const byId = new Map(vendors.map(v => [String(v._id), v])), byName = new Map(), byCode = new Map(masters.map(item => [item.code, item]));
  for (const vendor of vendors) { const name = vendor.name.trim().toLowerCase(); byName.set(name, [...(byName.get(name) || []), vendor]); }
  for (const row of rows) {
    const refs = Array.isArray(row.vendor) ? row.vendor : [row.vendor];
    const resolved = refs.map(ref => {
      const id = getVendorId(ref), name = getVendorName(ref);
      const found = id ? (byId.has(id) ? [byId.get(id)] : []) : (byName.get(name.toLowerCase()) || []);
      if (found.length !== 1) throw fail("SOURCE_VENDOR_UNRESOLVED", "A shipment vendor must be resolved in OMS before export", 409);
      return found[0];
    });
    const unique = [...new Map(resolved.map(vendor => [String(vendor._id), vendor])).values()];
    if (unique.length !== 1) throw fail("SOURCE_VENDOR_AMBIGUOUS", "A shipment has multiple possible exporters; correct its ownership in OMS", 409);
    const vendor = unique[0];
    if (!isUserAllowedData(user, { brands: [row.brand], vendors: [vendor.name] })) continue;
    if (!row.shipment._id || !row.sourceId) throw fail("SOURCE_ID_MISSING", "A stuffed line requires stable OMS identifiers", 409);
    const quantity = row.shipment.quantity;
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw fail("SOURCE_QUANTITY_INVALID", "Stuffed quantities must be positive whole product units", 409);
    const invoice = String(row.shipment.invoice_number || "").trim();
    const groupKey = "g_" + checksum([String(vendor._id), invoice, String(row.brand || "").trim().toLowerCase()]);
    const master = row.source === "sample" ? { ...row, _id: row.sourceId } : byCode.get(row.itemCode);
    const cft = master?.timber_cft;
    const date = row.shipment.stuffing_date ? new Date(row.shipment.stuffing_date).toISOString().slice(0, 10) : null;
    if (date) dates.add(date);
    const item = { shipmentKey: `${row.source}:${row.sourceId}:${row.shipment._id}`, source: row.source,
      sourceId: String(row.sourceId), shipmentId: String(row.shipment._id), stuffingDate: date, brand: row.brand || "",
      itemId: master?._id ? String(master._id) : "", itemCode: row.itemCode || "", description: master?.description || master?.name || row.description || "",
      quantity, finishedCftPerUnit: cft == null ? null : Number(cft).toFixed(6), hsCode: master?.hs_code || "",
      speciesComposition: (master?.species_composition || []).map(part => ({ speciesId: String(part.species), shareBps: part.share_bp })).sort((a, b) => a.speciesId.localeCompare(b.speciesId)) };
    const facts = checksum([groupKey, item]);
    if (shipments.has(item.shipmentKey)) {
      if (shipments.get(item.shipmentKey) !== facts) throw fail("SOURCE_SHIPMENT_CONFLICT", "Conflicting duplicate shipment identities exist in OMS", 409);
      continue;
    }
    shipments.set(item.shipmentKey, facts);
    if (!groups.has(groupKey)) groups.set(groupKey, { key: groupKey, exportInvoiceNumber: invoice, brand: row.brand || "",
      vendor: { id: String(vendor._id), name: vendor.name, gstin: vendor.gst || "", pan: vendor.pan || "" }, items: [] });
    groups.get(groupKey).items.push(item);
  }
  if (!groups.size) throw fail("CONTAINER_NOT_FOUND", "No authorized stuffed shipment groups were found", 404);
  const normalized = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
  normalized.forEach(group => group.items.sort((a, b) => a.shipmentKey.localeCompare(b.shipmentKey)));
  const container = { key: containerKey, number, stuffingDate: dates.size === 1 ? [...dates][0] : null, stuffingDates: [...dates].sort() };
  if (normalized.length === 1) container.exportInvoiceNumber = normalized[0].exportInvoiceNumber;
  const facts = { container, groups: normalized }, hash = checksum(facts);
  return { revision: "sha256:" + hash, hash, ...facts };
}
async function speciesCatalog() {
  const rows = await Species.find({ active: true }).select("_id name scientific_name active").sort({ _id: 1 }).limit(10001).lean();
  if (rows.length > 10000) throw fail("CATALOG_TOO_LARGE", "Species catalog exceeds the supported limit", 413);
  const species = rows.map(row => ({ id: String(row._id), name: row.name, commonName: row.name, scientificName: row.scientific_name, active: row.active }));
  return { revision: "sha256:" + checksum(species), species };
}
module.exports = { search, snapshot, normalizeSnapshot, speciesCatalog, key, numberFromKey, checksum };
