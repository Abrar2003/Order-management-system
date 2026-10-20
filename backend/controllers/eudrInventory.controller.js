const express = require("express");
const I = require("../services/eudrInventory.service");
const { M, Q } = I;
const { normalizeUserRoleKey } = require("../helpers/userRole");
const storage = require("../services/wasabiStorage.service");
const files = require("../services/eudrFiles.service");
const chainDocuments = require("./eudrChain.controller");
const fail = (res, e) => res.status(e.statusCode || (e.name === "ValidationError" ? 400 : 500)).json({ code: typeof e.code === "string" ? e.code : "INVENTORY_REQUEST_FAILED", message: e.message, details: I.publicRecord(e.details) });
const run = handler => async (req, res) => { try { await handler(req, res); } catch (e) { fail(res, e); } };
const pagination = query => ({ page: Math.max(1, Math.min(100000, Number.parseInt(query.page, 10) || 1)), limit: Math.max(1, Math.min(100, Number.parseInt(query.limit, 10) || 25)) });
const regex = value => new RegExp(String(value).slice(0,100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const sensitive = (req, _res, next) => ["admin", "super_admin"].includes(normalizeUserRoleKey(req.user?.role)) ? next() : next(Q.error("FORBIDDEN", "Inventory corrections and reversals require an administrator", null, 403));
const send = (res, data, status = 200) => res.status(status).json({ data: I.publicRecord(data) });

async function lineage(lotId, session) {
  const graph = await I.component([I.objectId(lotId)], session);
  const sourceIds = graph.lots.map(l => l.source_batch).filter(Boolean);
  const sources = await M.SourceBatch.find({ _id: { $in: sourceIds } }).session(session).lean();
  const invoices = await M.Invoice.find({ _id: { $in: graph.lots.map(l => l.invoice).filter(Boolean) } }).session(session).lean();
  const byId = new Map(graph.lots.map(l => [String(l._id), l]));
  const documents = await I.networkEvidence(graph,sources,invoices,session);
  let reconciliation;
  try {
    const selected=byId.get(String(lotId)),eligible=selected&&["COMMITTED","ON_HOLD"].includes(selected.status);
    const holder=graph.lots.filter(l=>l.owner===selected?.owner&&l.material===selected?.material&&["COMMITTED","ON_HOLD"].includes(l.status)).map(l=>String(l._id));
    reconciliation=Q.reconcile(graph,[...(eligible?[String(lotId)]:[]),...(holder.length?[holder]:[])]);
    let position=0;reconciliation.ranges=[eligible?reconciliation.ranges[position++]:null,holder.length?reconciliation.ranges[position]:null];
  } catch(e) { reconciliation = { feasible: false, code: e.code, message: e.message, details: e.details }; }
  return { ...graph, sources, invoices, documents, potential_origins: I.potentialOrigins(graph,sources,lotId), reconciliation };
}
const router = express.Router();
router.use((req,res,next)=>{
  if(["POST","PATCH","PUT","DELETE"].includes(req.method)&&req.path!=="/reconcile"&&process.env.EUDR_CANONICAL_INVOICES!=="true")return fail(res,Q.error("CANONICAL_ROLLOUT_REQUIRED","Canonical invoice ownership must be enabled before inventory mutations",null,503));
  next();
});
router.get("/state", run(async (_req,res) => send(res, await M.State.findById("global").lean() || { registry_ready: false })));
router.get("/batches", run(async (req,res) => {
  const { page, limit } = pagination(req.query), query = {};
  if (req.query.status) query.status = String(req.query.status);
  if (req.query.verification) query["verification.status"] = String(req.query.verification);
  if (req.query.vendor) query.owner = (await I.party({ kind: "vendor", id: req.query.vendor })).identity;
  if (req.query.party) query.owner = (await I.party({ kind: "party", id: req.query.party })).identity;
  if (req.query.owner) query.owner = String(req.query.owner).slice(0,100);
  if (req.query.material) query.material = String(req.query.material);
  if (req.query.species) query.species = I.objectId(req.query.species);
  if (req.query.search) {
    const pattern = regex(req.query.search), invoices = await M.Invoice.find({ $or: [{ number: pattern }, { "issuer_snapshot.name": pattern }, { "buyer_snapshot.name": pattern }] }).select("_id").limit(4001).lean();
    if (invoices.length > 4000) throw Q.error("SEARCH_TOO_BROAD", "Narrow the invoice or party search", null, 400);
    query.$or = [{ identity_key: pattern }, { "holder_snapshot.name": pattern }, { owner: pattern }, { invoice: { $in: invoices.map(i => i._id) } }];
  }
  if (req.query.mode) {
    const transfers = await M.Transfer.find({ mode: String(req.query.mode) }).select("output_lot").limit(4001).lean();
    if (transfers.length > 4000) throw Q.error("SEARCH_TOO_BROAD", "Narrow the allocation mode search", null, 400);
    query._id = { $in: transfers.map(t => t.output_lot) };
  }
  if (req.query.container) {
    const commitments = await M.Commitment.find({ container_key: String(req.query.container).trim().toLowerCase() }).select("inputs").limit(4001).lean();
    const ids = commitments.flatMap(c => c.inputs.map(i => i.lot));
    query._id = { $in: query._id ? ids.filter(i => query._id.$in.some(x => String(x) === String(i))) : ids };
  }
  let total = await M.Lot.countDocuments(query);
  let rows = await M.Lot.find(query).sort({ createdAt: -1, _id: -1 }).skip(req.query.quantity ? 0 : (page - 1) * limit).limit(req.query.quantity ? 2001 : limit).lean();
  if (req.query.quantity && rows.length > 2000) throw Q.error("SEARCH_TOO_BROAD", "Narrow the registry search before filtering quantity feasibility", null, 400);
  const cache = new Map();
  for (const lot of rows) {
    try {
      let graph = cache.get(String(lot._id));
      if (!graph) { graph = await I.component([lot._id]); graph.lots.forEach(l=>cache.set(String(l._id),graph)); }
      const result = Q.reconcile(graph,[String(lot._id)]);
      lot.quantity_range = result.ranges[0];
      lot.quantity_status = !result.feasible ? "CONFLICT_DETECTED" : lot.quantity_range.uncommitted_max_milli === 0 ? "FULLY_COMMITTED" : "QUANTITY_FEASIBLE";
      if(["DRAFT","RESERVED"].includes(lot.status)){lot.quantity_status="VERIFICATION_PENDING";lot.quantity_range=null;}
      if(["CANCELLED","REJECTED","SUPERSEDED"].includes(lot.status)){lot.quantity_status="NON_SPENDABLE";lot.quantity_range=null;}
      lot.linked_transaction_count = graph.operations.filter(o=>o.inputs?.some(i=>String(i.lot)===String(lot._id))||String(o.output_lot)===String(lot._id)).length;
      lot.source_allocation_mode = graph.operations.find(o=>String(o._id)===String(lot.incoming_operation))?.mode;
      graph.originBatches ||= await M.SourceBatch.find({_id:{$in:graph.lots.map(l=>l.source_batch).filter(Boolean)}}).select("origins").lean();
      lot.potential_source_count = I.potentialOrigins(graph,graph.originBatches,lot._id).length;
    } catch(e) { lot.quantity_status = "REVIEW_REQUIRED"; lot.quantity_error = e.code; }
  }
  if (req.query.quantity) { rows = rows.filter(l=>l.quantity_status===req.query.quantity); total=rows.length; rows=rows.slice((page-1)*limit,page*limit); }
  const invoices = await M.Invoice.find({ _id: { $in: rows.map(l => l.invoice).filter(Boolean) } }).select("number date identity_key").lean();
  for (const lot of rows) lot.invoice_detail = invoices.find(i => String(i._id) === String(lot.invoice));
  res.json({ data: I.publicRecord(rows), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));
router.post("/batches", run(async (req,res) => send(res, await I.createSource(req.body, req.user), 201)));
router.get("/batches/:id", run(async (req,res) => {
  const lot = await M.Lot.findById(I.objectId(req.params.id)).lean(); if (!lot) throw Q.error("NOT_FOUND", "Batch not found", null, 404);
  const network = await lineage(req.params.id);
  const audit = await M.Audit.find({ entity: { $in: [lot._id, lot.source_batch, lot.incoming_operation, lot.invoice].filter(Boolean) } }).sort({ createdAt: -1 }).limit(50).lean();
  send(res, { ...lot, network, audit });
}));
router.get("/batches/:id/lineage", run(async (req,res) => send(res, await lineage(req.params.id))));
router.get("/batches/:id/commitments", run(async (req,res) => {
  const { page, limit } = pagination(req.query), query = { "inputs.lot": I.objectId(req.params.id) };
  send(res, await M.Commitment.find(query).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).lean());
}));
for (const [resource, Model] of Object.entries({ invoices: M.Invoice, transfers: M.Transfer, mixes: M.Mix })) {
  router.get(`/${resource}`, run(async (req,res) => {
    const { page, limit } = pagination(req.query), query = req.query.search ? { [resource === "invoices" ? "number" : "identity_key"]: regex(req.query.search) } : {};
    const total = await Model.countDocuments(query); res.json({ data: I.publicRecord(await Model.find(query).sort({ createdAt:-1 }).skip((page-1)*limit).limit(limit).lean()), pagination: { page, limit, total, pages: Math.ceil(total/limit) } });
  }));
  router.get(`/${resource}/:id`, run(async (req,res) => { const record = await Model.findById(I.objectId(req.params.id)).lean(); if (!record) throw Q.error("NOT_FOUND", "Inventory record not found", null, 404); send(res, record); }));
}
router.post("/invoices", run(async (req,res) => send(res, await I.registerInvoice(req.body, req.user), 201)));
router.post("/transfers", run(async (req,res) => send(res, await I.createTransfer(req.body, req.user), 201)));
router.patch("/transfers/:id", run(async (req,res) => send(res, await I.editDraft(req.params.id, req.body, req.user))));
router.post("/transfers/:id/reserve", run(async (req,res) => send(res, await I.reserveTransfer(req.params.id, req.user))));
router.post("/mixes", run(async (req,res) => send(res, await I.createMix(req.body, req.user), 201)));
router.post("/:resource/:id/verify", run(async (req,res) => send(res, await I.verify(req.params.resource, req.params.id, req.body, req.user))));
router.patch("/:resource/:id/correction", sensitive, run(async (req,res) => send(res, await I.correct(req.params.resource, req.params.id, req.body, req.user))));
router.post("/:resource/:id/cancel", sensitive, run(async (req,res) => send(res, await I.cancel(req.params.resource, req.params.id, req.body, req.user))));
router.post("/commitments", run(async (req,res) => send(res, await I.reserve(req.body, req.user), 201)));
router.post("/commitments/:id/release", sensitive, run(async (req,res) => send(res, await I.release(req.params.id, req.body, req.user))));
router.post("/reconcile", run(async (req,res) => {
  if (!Array.isArray(req.body.lot_ids) || !req.body.lot_ids.length || req.body.lot_ids.length > 50) throw Q.error("INVALID_INPUTS", "Select 1–50 lot references", null, 400);
  const graph = await I.component(req.body.lot_ids.map(I.objectId));
  if (req.body.proposal) {
    const owner = graph.lots.find(l=>String(l._id)===String(req.body.lot_ids[0]))?.owner;
    const material = graph.lots.find(l=>String(l._id)===String(req.body.lot_ids[0]))?.material;
    graph.operations.push({_id:"proposal",seller:owner,quantity_milli:I.cft(req.body.proposal.quantity_cft),date:Q.date(req.body.proposal.date),input_material:material,species:graph.lots.find(l=>String(l._id)===String(req.body.lot_ids[0]))?.species,mode:req.body.proposal.mode||"UNKNOWN",inputs:I.inputs(req.body.proposal.inputs||req.body.lot_ids.map(lot=>({lot}))),status:"RESERVED"});
  }
  send(res, Q.reconcile(graph, req.body.ranges || [req.body.lot_ids]));
}));
router.post("/migration/review-network", sensitive, run(async(req,res)=>send(res,await I.reviewLegacyNetwork(req.body,req.user))));
router.get("/conflicts", run(async (req,res) => {
  const { page, limit } = pagination(req.query);
  send(res, await M.Audit.find({ event: { $in: ["quantity_conflict", "downstream_invalidated"] } }).sort({ createdAt:-1 }).skip((page-1)*limit).limit(limit).lean());
}));
router.get("/audit", run(async (req,res) => {
  const { page, limit } = pagination(req.query), query = req.query.entity ? { entity: I.objectId(req.query.entity) } : {};
  send(res, await M.Audit.find(query).sort({ createdAt:-1 }).skip((page-1)*limit).limit(limit).lean());
}));
router.get("/documents", run(async (req,res) => {
  const { page, limit } = pagination(req.query), query = req.query.search ? { name: regex(req.query.search) } : {};
  send(res, await M.Document.find(query).sort({ createdAt:-1 }).skip((page-1)*limit).limit(limit).lean());
}));
const purposes = new Set(["invoice", "production", "license", "permission", "forest_image", "receipt", "weight_slip", "billty", "driver_license", "ewaybill", "truck_registration", "transformation", "mix", "correction", "reversal", "buyer_gst", "buyer_pan"]);
exports.uploadDocument = run(async (req,res) => {
  const f = req.file, purpose = req.body?.purpose;
  if (!f || !files.fileMime(f.originalname) || !purposes.has(purpose)) throw Q.error("INVALID_DOCUMENT", "Choose a supported file and evidence purpose", null, 400);
  if (purpose === "forest_image") await files.assertForestImage(f);
  const sha256 = files.sha256(f.buffer), existing = await M.Document.findOne({ sha256 }).lean();
  if (existing) throw Q.error("DOCUMENT_REUSE_AVAILABLE", "The same file already exists; link its canonical document after confirming identity", { document: I.publicRecord(existing) });
  const storageKey = storage.createStorageKey({ folder: "eudr/inventory", originalName: f.originalname });
  await storage.uploadBuffer({ buffer: f.buffer, key: storageKey, originalName: f.originalname, contentType: files.fileMime(f.originalname) });
  // Retain orphaned uploads after failed metadata writes for recovery; never delete a possibly shared object.
  const result = await I.withInventory(req.user, async (session,state) => {
    const duplicate = await M.Document.findOne({ sha256 }).session(session);
    if (duplicate) return duplicate;
    const doc = new M.Document({ key: storageKey, name: String(f.originalname).normalize("NFC").replace(/[\\/\x00-\x1f]/g,"_"), sha256, content_type: files.fileMime(f.originalname), size: f.size, purpose, created_by: req.user?._id || req.user?.id });
    await doc.save({ session }); await I.audit(session, req.user, "document_registered", "documents", doc._id, state.revision); return doc;
  }); send(res, result, 201);
});
router.post("/documents", require("../config/multer.config").eudrSingle("file"), exports.uploadDocument);
for (const action of ["url", "content", "preview"]) router.get(`/documents/:id/${action}`, run(async (req,res) => {
  const doc = await M.Document.findById(I.objectId(req.params.id)); if (!doc) throw Q.error("NOT_FOUND", "Document not found", null, 404);
  req.inventoryDocument = doc; await chainDocuments[`document${action[0].toUpperCase()}${action.slice(1)}`](req,res);
}));
router.use((e,_req,res,_next) => fail(res,e));
exports.router = router;
exports.lineage = lineage;
exports.pagination = pagination;
