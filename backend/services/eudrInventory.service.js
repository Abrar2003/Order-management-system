const crypto = require("node:crypto");
const reviewRecords=require("./eudrReviewRecords.service");
const reviewEnabled=require("../helpers/timberSpecies").enabled;
const mongoose = require("mongoose");
const M = require("../models/eudrInventory.model");
const Chain = require("../models/eudrChain.model");
const Party = require("../models/eudrParty.model");
const Vendor = require("../models/vendor.model");
const Allocation = require("../models/eudrAllocation.model");
const Q = require("./eudrQuantity.service");
const { normalizeIdentifier, invoiceKey, financialYear } = require("../helpers/timberCft");
const { isTransactionUnsupportedError } = require("../helpers/transactionalController");
const { loadContainer, findGroup, key, contributionMilliCft } = require("./eudrChain.service");
const originSignature=rows=>rows.map(o=>({plot:o.plot,plot_ref:o.plot_ref?String(o.plot_ref):undefined,latitude:o.latitude,longitude:o.longitude,species:o.species,permission:o.permission}));
const text = value => String(value ?? "").trim();
const objectId = value => { if (!mongoose.isValidObjectId(value)) throw Q.error("INVALID_REFERENCE", "A valid record reference is required", null, 400); return String(value); };
const stable = value => value instanceof Date ? value.toISOString() : value instanceof mongoose.Types.ObjectId ? String(value) : Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
const digest = value => crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const transferHash=record=>digest({
  ...Object.fromEntries(["kind","seller","buyer","invoice","line_id","fulfillment","quantity_milli","output_quantity_milli","date","receipt_date","dispatch_date","mode","input_material","output_material","discrepancy_note","species","transport"].map(k=>[k,record[k]])),
  inputs:(record.inputs||[]).map(i=>i.toObject?.()||i),
  documents:(record.documents||[]).map(String).sort(),
  transport_facts:record.transport,
  transport:(record.transport_documents||[]).map(String).sort(),
  receipt:(record.receipt_documents||[]).map(String).sort(),
});
const cft = (value, positive = true) => {
  const v = text(value);
  if (v.length > 32 || !/^\d+(?:\.\d{1,3})?$/.test(v)) throw Q.error("INVALID_QUANTITY", "CFT requires a decimal with at most three places", null, 400);
  const [whole, fraction = ""] = v.split(".");
  const milli = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  if (milli > BigInt(Number.MAX_SAFE_INTEGER) || (positive && milli === 0n)) throw Q.error("INVALID_QUANTITY", "CFT is outside the supported range", null, 400);
  return Number(milli);
};
const publicRecord = value => {
  if (value?.toObject) value = value.toObject();
  if (Array.isArray(value)) return value.map(publicRecord);
  if (value instanceof Date || value instanceof mongoose.Types.ObjectId) return value;
  if(value&&typeof value==="object"&&!reviewEnabled()&&Object.hasOwn(value,"legacy_species"))value={...value,species:value.legacy_species,legacy_species:undefined};
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k,v]) => k !== "key" && (reviewEnabled() || !["species_allocations","transport","document_checks","plot_ref","production_reference_key","legacy_species","production_proof_index_transitioned","review_layer_ready"].includes(k)) && (reviewEnabled() || k!=="species" || v!=null)).map(([k,v]) => [k, publicRecord(v)]));
  return value;
};
const actor = user => user?._id || user?.id;
const ledgerEnforced=async()=>process.env.EUDR_CANONICAL_INVOICES==="true"||process.env.EUDR_INVENTORY_REQUIRED==="true"||Boolean((await M.State.findById("global").select("inventory_enforced").lean())?.inventory_enforced);
const audit = (session, user, event, type, entity, revision, detail = {}) => M.Audit.create([{ event, entity_type: type, entity, revision, actor: actor(user), actor_name: text(user?.name), ...detail }], { session });
let indexesReady;
const ensureIndexes = () => {
  indexesReady ||= (async () => {
    for (const model of Object.values(M)) if (model?.createIndexes) { await model.createCollection(); await model.createIndexes(); }
    await Allocation.createCollection();
    const state=await M.State.findById("global").lean();
    if(!state?.production_proof_index_transitioned)await M.SourceBatch.collection.createIndex({production_documents:1},{unique:true,sparse:true,name:"production_documents_1"});
    await M.State.updateOne({ _id: "global" }, { $setOnInsert: { revision: 0 } }, { upsert: true });
  })().catch(e => { indexesReady = null; throw e; });
  return indexesReady;
};
async function withInventory(user, operation, { preparation = false } = {}) {
  if (mongoose.connection.$supportsTransactions === false) throw Q.error("MONGODB_TRANSACTIONS_REQUIRED", "Inventory changes require MongoDB transactions", null, 503);
  if(!preparation&&process.env.EUDR_CANONICAL_INVOICES!=="true")throw Q.error("CANONICAL_ROLLOUT_REQUIRED","Enable canonical invoice ownership on every writer before inventory mutations",null,503);
  await ensureIndexes();
  let attempts = 0;
  try {
    return await mongoose.connection.transaction(async session => {
      if (++attempts > 5) throw Q.error("CONCURRENT_MODIFICATION", "Inventory changed repeatedly; retry the request", null, 409);
      if (attempts > 1) await new Promise(resolve => setTimeout(resolve, 20 * 2 ** (attempts - 2)));
      // shortcut: one global lock limits write throughput; partition only with safe cross-graph locking.
      const state = await M.State.findOneAndUpdate({ _id: "global" }, { $inc: { revision: 1 } }, { new: true, session });
      if (!preparation && !state.registry_ready) throw Q.error("MIGRATION_REQUIRED", "Prepare and reconcile the canonical registry before inventory writes", null, 503);
      if(reviewEnabled()&&!preparation&&!state.review_layer_ready)throw Q.error("REVIEW_MIGRATION_REQUIRED","Apply and validate the review-layer migration before enabling review writes",null,503);
      const result = await operation(session, state);
      await audit(session, user, "inventory_revision_advanced", "state", undefined, state.revision);
      return result;
    }, { timeoutMS: 15000, maxCommitTimeMS: 10000, readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } catch (e) {
    if (isTransactionUnsupportedError(e)) throw Q.error("MONGODB_TRANSACTIONS_REQUIRED", "No inventory changes saved: MongoDB transactions are unavailable", null, 503);
    if (e.code === 11000 || e.name === "VersionError") throw Q.error("IDENTITY_OR_CONCURRENCY_CONFLICT", "Canonical identity already exists or changed concurrently; reload and retry", null, 409);
    if (["GLOBAL_QUANTITY_CONFLICT","CHRONOLOGY_CONFLICT","INVOICE_IDENTITY_CONFLICT","DOCUMENT_IDENTITY_CONFLICT"].includes(e.code)) {
      await withInventory(user, async(session,state)=>audit(session,user,e.code.includes("IDENTITY")?"identity_conflict":"quantity_conflict","state",undefined,state.revision,{reason:e.message,details:{code:e.code,...e.details}})).catch(auditError=>console.warn("Rejected EUDR mutation audit could not be saved:",auditError.message));
    }
    throw e;
  }
}
async function party(reference, session) {
  if (!reference || !["vendor", "party"].includes(reference.kind)) throw Q.error("INVALID_PARTY", "Choose an existing vendor or saved party", null, 400);
  const record = reference.kind === "vendor" ? await Vendor.findOne({ _id: objectId(reference.id), deleted_at: null, is_active: { $ne: false } }).session(session) : await Party.findById(objectId(reference.id)).session(session);
  if (!record) throw Q.error("PARTY_NOT_FOUND", "Party no longer exists", null, 404);
  const f = reference.kind === "vendor" ? record : record.fields;
  const gst = normalizeIdentifier(f.gst || f.buyer_gst), pan = normalizeIdentifier(f.pan || f.buyer_pan);
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan) || (gst && (!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(gst) || gst.slice(2,12) !== pan))) throw Q.error("PARTY_IDENTITY_REVIEW", "A valid PAN and matching GST identity are required for the inventory registry", null, 409);
  return { identity: gst ? `${gst}|${pan}` : `PAN:${pan}`, snapshot: { name: record.name, gst, pan, reference }, ambiguous: !gst };
}
async function evidence(ids = [], session) {
  if (!Array.isArray(ids) || ids.length > 50 || new Set(ids.map(String)).size !== ids.length) throw Q.error("INVALID_DOCUMENTS", "Choose at most 50 distinct documents", null, 400);
  ids.forEach(objectId);
  const docs = await M.Document.find({ _id: { $in: ids } }).session(session);
  if (docs.length !== ids.length) throw Q.error("DOCUMENT_NOT_FOUND", "Supporting document no longer exists", null, 404);
  return docs;
}
const inputs = raw => {
  if (!Array.isArray(raw) || raw.length > 100) throw Q.error("INVALID_INPUTS", "Choose at most 100 source lots", null, 400);
  return raw.map(v => ({ lot: objectId(v.lot), participation: v.participation || "POSSIBLE", ...(v.exact_cft != null && v.exact_cft !== "" ? { exact_milli: cft(v.exact_cft, false) } : {}), ...(v.min_cft != null && v.min_cft !== "" ? { min_milli: cft(v.min_cft, false) } : {}), ...(v.max_cft != null && v.max_cft !== "" ? { max_milli: cft(v.max_cft, false) } : {}), evidence_note: text(v.evidence_note).slice(0,2000) }));
};

async function component(seedIds, session) {
  const ids = new Set(seedIds.map(Q.id)), operations = new Map(), mixes = new Map();
  const invoicesSeen=new Set();
  let frontier = [...ids], invoiceFrontier=[];
  for (let depth = 0; frontier.length||invoiceFrontier.length; depth++) {
    if (depth > 200 || ids.size > 2000 || operations.size > 4000) throw Q.error("GRAPH_LIMIT", "Documentary component exceeds the supported review limit", null, 413);
    const query = { $or: [{ "inputs.lot": { $in: frontier } }, { output_lot: { $in: frontier } },{invoice:{$in:invoiceFrontier}}] };
    const transfers = await M.Transfer.find(query).limit(4001).session(session).lean();
    const commitments = await M.Commitment.find({ "inputs.lot": { $in: frontier } }).limit(4001).session(session).lean();
    const linkedMixes = await M.Mix.find({ "inputs.lot": { $in: frontier }, status: { $nin: ["CANCELLED", "REJECTED"] } }).limit(4001).session(session).lean();
    if(transfers.length>4000||commitments.length>4000||linkedMixes.length>4000)throw Q.error("GRAPH_LIMIT","Connected documentary relationships exceed the supported review limit",null,413);
    const next = [],nextInvoices=[];
    for (const op of [...transfers, ...commitments, ...linkedMixes]) {
      (op.owner ? mixes : operations).set(String(op._id), op);
      if(op.invoice&&!invoicesSeen.has(String(op.invoice))){invoicesSeen.add(String(op.invoice));nextInvoices.push(String(op.invoice));}
      for (const lotId of [...(op.inputs || []).map(x => x.lot), ...(op.output_lot ? [op.output_lot] : [])].map(String)) if (!ids.has(lotId)) { ids.add(lotId); next.push(lotId); }
    }
    frontier = next;invoiceFrontier=nextInvoices;
  }
  const lots = await M.Lot.find({ _id: { $in: [...ids] } }).session(session).lean();
  const invoice_limits = await M.Invoice.find({_id:{$in:[...operations.values()].map(o=>o.invoice).filter(Boolean)}}).select("date lines").session(session).lean();
  return { lots, operations: [...operations.values()], mixes: [...mixes.values()], invoice_limits };
}
const check = (graph, groups = []) => {
  const result = Q.reconcile(graph, groups);
  if (!result.feasible) throw Q.error("GLOBAL_QUANTITY_CONFLICT", "The proposed quantity cannot fit all active documentary commitments", { ...result, lots: graph.lots.map(l => ({ id: l._id, documented_milli: l.quantity_milli, owner: l.owner })), transactions: graph.operations.filter(o => Q.ACTIVE.has(o.status)).map(o => ({ id: o._id, quantity_milli: o.quantity_milli, date: o.date, container: o.container, invoice: o.invoice })) });
  return result;
};
const checkedGraph=async(graph,session,user,state)=>{
  const result=check(graph);
  await audit(session,user,"graph_recalculated","state",undefined,state.revision,{details:{feasible:result.feasible,transaction_ids:result.transaction_ids,lot_ids:graph.lots.map(l=>l._id)}});
  return result;
};
const reconciliationSnapshot=graph=>{
  try{return Q.reconcile(graph);}catch(e){if(!e.code)throw e;return {feasible:false,code:e.code,details:e.details};}
};
async function reconcileReversal(seeds,session,user,state,reason){
  const graph=await component(seeds,session),result=reconciliationSnapshot(graph);
  if(!result.feasible){await holdDependents(seeds,session,user,state.revision,reason);await audit(session,user,"quantity_conflict","state",undefined,state.revision,{reason,details:result});}
  await audit(session,user,"graph_recalculated","state",undefined,state.revision,{details:result});return result;
}
async function assertSpendable(graph, inputRows, { reviewing = false, except } = {}) {
  for (const row of inputRows) {
    const lot = graph.lots.find(l => String(l._id) === String(row.lot));
    if (!lot || lot.status !== "COMMITTED" || lot.verification?.status !== "VERIFIED") throw Q.error("VERIFICATION_HOLD", "Selected sources require current documentary verification", { lot: row.lot });
    const incoming = graph.operations.find(o => String(o._id) === String(lot.incoming_operation));
    if (incoming && (incoming.status !== "COMMITTED" || incoming.verification?.status !== "VERIFIED")) throw Q.error("VERIFICATION_HOLD", "An upstream transaction is disputed or unverified", { transaction: incoming._id });
  }
  if (!reviewing && (graph.lots.some(l => l.status === "ON_HOLD") || graph.operations.some(o => o.status === "ON_HOLD" && String(o._id) !== String(except)))) throw Q.error("VERIFICATION_HOLD", "This connected network has an unresolved evidence or quantity hold");
}
async function registerInvoice(body, user) {
  return withInventory(user, async (session, state) => {
    const issuer = await party(body.issuer, session), buyer = await party(body.buyer, session);
    if (issuer.identity === buyer.identity) throw Q.error("SELF_TRANSFER", "Seller and buyer must be distinct", null, 400);
    const number = text(body.number).slice(0,100), invoiceDate = Q.date(body.date), fy = financialYear(invoiceDate);
    if (!normalizeIdentifier(number)) throw Q.error("INVALID_INVOICE", "Invoice number is required", null, 400);
    if (issuer.ambiguous && !text(body.identity_note)) throw Q.error("IDENTITY_REVIEW", "An issuer without GST requires an explicit PAN identity explanation", null, 400);
    const identity = issuer.ambiguous ? `${issuer.identity}|${fy}|${normalizeIdentifier(number)}` : invoiceKey({ issuer_gst: issuer.snapshot.gst, invoice_date: invoiceDate, invoice_number: number });
    if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 100) throw Q.error("INVALID_LINES", "Provide 1–100 separately identified invoice lines", null, 400);
    if(reviewEnabled())for(const line of body.lines)line.species=await reviewRecords.species(line.species,session);
    const lines = body.lines.map(l => ({ line_id: text(l.line_id).slice(0,100), quantity_milli: cft(l.quantity_cft), material: l.material, species: reviewEnabled()?new mongoose.Types.ObjectId(l.species):text(l.species) }));
    const total = cft(body.total_cft);
    if (lines.some(l => !l.line_id) || new Set(lines.map(l => l.line_id)).size !== lines.length || Q.sum(lines.map(l => l.quantity_milli)) !== total) throw Q.error("INVALID_LINES", "Distinct invoice lines must sum exactly to the documented total", null, 400);
    const docs = await evidence(body.documents, session);
    const invoiceProofs=docs.filter(d=>["invoice","correction"].includes(d.purpose)).map(d=>d._id);
    const signature = { issuer: issuer.identity, buyer: buyer.identity, date: invoiceDate, total_milli: total, lines };
    let invoice = await M.Invoice.findOne({ identity_key: identity }).session(session);
    if (invoice) {
      const prior = { issuer: invoice.issuer, buyer: invoice.buyer, date: invoice.date, total_milli: invoice.total_milli, lines: invoice.lines.map(l => ({ line_id: l.line_id, quantity_milli: l.quantity_milli, material: l.material, species: l.species })) };
      if (digest(signature) !== digest(prior) || docs.some(d => !invoice.documents.some(i => String(i) === String(d._id)))) throw Q.error("INVOICE_IDENTITY_CONFLICT", "This canonical invoice has different quantities, dates, identities or evidence; submit an audited correction", { invoice: invoice._id });
      await audit(session, user, "invoice_reused", "invoices", invoice._id, state.revision); return invoice;
    }
    const conflict = invoiceProofs.length && await M.Invoice.findOne({$or:[{documents:{$in:invoiceProofs}},{invoice_documents:{$in:invoiceProofs}}]}).session(session);
    if (conflict) throw Q.error("DOCUMENT_IDENTITY_CONFLICT", "This evidence already supports a different invoice identity", { invoice: conflict._id });
    invoice = new M.Invoice({ ...signature, identity_key: identity, number, einvoice_irn:reviewEnabled()?text(body.einvoice_irn):undefined, financial_year: fy, issuer_snapshot: issuer.snapshot, buyer_snapshot: buyer.snapshot, documents: docs.map(d => d._id),invoice_documents:invoiceProofs.length?invoiceProofs:undefined, created_by: actor(user) });
    await invoice.save({ session }); await audit(session, user, "invoice_registered", "invoices", invoice._id, state.revision, { after: invoice.toObject(), reason: text(body.identity_note) }); return invoice;
  });
}
async function createSource(body, user) {
  return withInventory(user, async (session, state) => {
    const owner = await party(body.owner, session), reference = text(body.production_reference).slice(0,200);
    if (!reference) throw Q.error("SOURCE_REFERENCE_REQUIRED", "A separate production evidence reference is required", null, 400);
    const productionKey=`${owner.identity}|${normalizeIdentifier(reference)}`;
    const species=await reviewRecords.species(body.species,session);
    if(reviewEnabled())body.origins=await reviewRecords.origins(body.origins||[],session);
    const identity = species?`${productionKey}|species:${species}`:productionKey, quantity = cft(body.quantity_cft), productionDate = Q.date(body.production_date);
    const docs = await evidence(body.documents, session);
    let source = await M.SourceBatch.findOne({ identity_key: identity }).session(session);
    if (source) {
      if (source.quantity_milli !== quantity || source.production_date !== productionDate || source.material !== (body.material||"RAW") || digest(source.documents.map(String).sort()) !== digest(docs.map(d=>String(d._id)).sort()) || digest(originSignature(source.origins)) !== digest(originSignature(body.origins || []))) throw Q.error("SOURCE_IDENTITY_CONFLICT", "Production reference already exists with different data");
      return source;
    }
    const productionDocs = docs.filter(d => ["production","correction"].includes(d.purpose)).map(d => d._id);
    if (!state.production_proof_index_transitioned && productionDocs.length && await M.SourceBatch.exists({$or:[{documents:{$in:productionDocs}},{production_documents:{$in:productionDocs}}]}).session(session)) throw Q.error("SOURCE_EVIDENCE_REUSED", "Production evidence already creates a source capacity; reuse that batch");
    if (!Array.isArray(body.origins||[]) || (body.origins||[]).length>100) throw Q.error("INVALID_ORIGINS","Provide at most 100 plot references",null,400);
    if(body.harvest_date&&Q.date(body.harvest_date)>productionDate)throw Q.error("CHRONOLOGY_CONFLICT","Harvest cannot follow the documented production date");
    source = new M.SourceBatch({ species,production_reference_key:(reviewEnabled()||state.production_proof_index_transitioned)?productionKey:undefined,identity_key: identity, owner: owner.identity, quantity_milli: quantity, production_date: productionDate, harvest_date: body.harvest_date ? Q.date(body.harvest_date) : undefined, material: body.material || "RAW", origins: body.origins || [], documents: docs.map(d => d._id), created_by: actor(user), ...(body.cutting_limit_cft != null ? { cutting_limit_milli: cft(body.cutting_limit_cft, false) } : {}) });
    if(productionDocs.length)source.production_documents=productionDocs;
    const lot = new M.Lot({ identity_key: `source:${source._id}`, owner: owner.identity, holder_snapshot: owner.snapshot, source_batch: source._id, kind: "SOURCE", quantity_milli: quantity, documented_milli: quantity, available_date: productionDate, material: source.material, documents: source.documents, created_by: actor(user) });
    lot.species=species;
    if(state.production_proof_index_transitioned)await reviewRecords.claimProofs(source,docs,session);
    source.output_lot = lot._id; await source.save({ session }); await lot.save({ session });
    await audit(session, user, "source_created", "batches", source._id, state.revision, { after: source.toObject() }); return source;
  });
}
async function createTransfer(body, user) {
  return withInventory(user, async (session, state) => {
    const transform = body.kind === "TRANSFORMATION";
    const seller = await party(body.seller, session), buyer = transform ? seller : await party(body.buyer, session);
    if (!transform && seller.identity === buyer.identity) throw Q.error("SELF_TRANSFER", "A sale cannot supply its own seller");
    let invoice, line;
    if (!transform) {
      invoice = await M.Invoice.findById(objectId(body.invoice)).session(session); line = invoice?.lines.find(l => l.line_id === body.line_id);
      if (!line || invoice.issuer !== seller.identity || invoice.buyer !== buyer.identity) throw Q.error("INVOICE_PARTY_CONFLICT", "Invoice line, seller and buyer must match canonical registration");
    }
    const fulfillment = text(body.fulfillment || "full").slice(0,100), token = text(body.idempotency_key).slice(0,150);
    if (transform && !token) throw Q.error("IDEMPOTENCY_REQUIRED", "A transformation reference is required", null, 400);
    const identity = transform ? `transform:${seller.identity}:${token}` : `${invoice._id}|${line.line_id}|${fulfillment}`;
    const record = { kind: transform ? "TRANSFORMATION" : "TRANSFER", seller: seller.identity, buyer: buyer.identity, invoice: invoice?._id, line_id: line?.line_id, fulfillment, quantity_milli: cft(body.sold_cft), output_quantity_milli: cft(body.received_cft, false), date: Q.date(body.date), receipt_date: Q.date(body.receipt_date || body.date), dispatch_date: body.dispatch_date ? Q.date(body.dispatch_date) : undefined, mode: body.mode || "UNKNOWN", inputs: inputs(body.inputs || []), input_material: body.input_material || line?.material, output_material: body.output_material || line?.material, discrepancy_note: text(body.discrepancy_note).slice(0,2000) };
    if (record.receipt_date < record.date || (invoice && record.date !== invoice.date) || (record.dispatch_date && (record.dispatch_date < record.date || record.dispatch_date > record.receipt_date))) throw Q.error("CHRONOLOGY_CONFLICT", "The sale date must match its canonical invoice; dispatch and receipt cannot precede the sale");
    if (!transform && record.input_material !== record.output_material) throw Q.error("TRANSFORMATION_REQUIRED", "A material conversion requires a separate verified transformation");
    record.species=await reviewRecords.species(body.species||line?.species,session);
    if(reviewEnabled()&&line&&String(record.species)!==String(line.species))throw Q.error("SPECIES_MISMATCH","Transfer species must match the canonical invoice line");
    if(reviewEnabled()){record.transport=await reviewRecords.transport(body.transport,invoice?._id,session);const chosen=await M.Lot.find({_id:{$in:record.inputs.map(i=>i.lot)}}).session(session).lean();if(chosen.some(l=>String(l.species||"")!==String(record.species||"")))throw Q.error("SPECIES_MISMATCH","Input and output species must match");}
    const docs = await evidence(body.documents, session), transport = await evidence(body.transport_documents, session), receipt = await evidence(body.receipt_documents, session);
    const requestHash = transferHash({...record,documents:docs.map(d=>d._id),transport_documents:transport.map(d=>d._id),receipt_documents:receipt.map(d=>d._id)});
    const existing = await M.Transfer.findOne({ identity_key: identity }).session(session);
    if (existing) { if (existing.request_hash !== requestHash) throw Q.error("TRANSACTION_IDENTITY_CONFLICT", "Existing transfer identity has different data; use correction"); return existing; }
    if (invoice) {
      const prior = await M.Transfer.find({ invoice: invoice._id, line_id: line.line_id, status: { $nin: ["CANCELLED", "SUPERSEDED", "REJECTED"] } }).session(session);
      if (Q.sum([...prior.map(t => t.quantity_milli), record.quantity_milli]) > line.quantity_milli) throw Q.error("INVOICE_LINE_EXCEEDED", "Partial fulfillments exceed the canonical invoice line quantity");
    }
    const transfer = new M.Transfer({ ...record, identity_key: identity, request_hash: requestHash, loss_milli: Math.max(0,record.quantity_milli - record.output_quantity_milli), documents: docs.map(d => d._id), transport_documents: transport.map(d => d._id), receipt_documents: receipt.map(d => d._id), legacy:invoice?.legacy===true, created_by: actor(user) });
    const lot = new M.Lot({ identity_key: `receipt:${transfer._id}`, owner: buyer.identity, holder_snapshot: buyer.snapshot, invoice: invoice?._id, line_id: line?.line_id, incoming_operation: transfer._id, kind: transform ? "TRANSFORMED" : "RECEIPT", quantity_milli: record.output_quantity_milli, documented_milli: record.quantity_milli, available_date: record.receipt_date, material: record.output_material, documents: invoice?.documents || transfer.documents, created_by: actor(user) });
    lot.species=record.species;
    transfer.output_lot = lot._id; await transfer.save({ session }); await lot.save({ session });
    await audit(session, user, "transfer_draft_created", "transfers", transfer._id, state.revision, { after: transfer.toObject() }); return transfer;
  });
}
async function createMix(body, user) {
  return withInventory(user, async (session, state) => {
    const owner = await party(body.owner, session), rows = inputs(body.inputs), docs = await evidence(body.documents, session);
    if (rows.length < 2 || new Set(rows.map(r => r.lot)).size !== rows.length) throw Q.error("INVALID_MIX", "A mix needs at least two distinct lots", null, 400);
    const lots = await M.Lot.find({ _id: { $in: rows.map(r => r.lot) } }).session(session);
    if (lots.length !== rows.length || lots.some(l => l.owner !== owner.identity || l.material !== lots[0].material)) throw Q.error("INVALID_MIX", "Mix lots must share holder and material basis");
    const reference = text(body.reference).slice(0,150); if (!reference) throw Q.error("REFERENCE_REQUIRED", "Mix reference is required", null, 400);
    const identity = `${owner.identity}|${reference}`, existing = await M.Mix.findOne({ identity_key: identity }).session(session);
    if (existing) throw Q.error("MIX_IDENTITY_CONFLICT", "Mix reference already exists; reuse the existing mix", { mix: existing._id });
    if (body.physical_mixing === true && (!docs.length || !text(body.note))) throw Q.error("MIX_EVIDENCE_REQUIRED", "Physical mixing requires evidence and an explanation", null, 400);
    let output;
    if (body.output_transfer) {
      output=await M.Transfer.findById(objectId(body.output_transfer)).session(session);
      if(!output||output.seller!==owner.identity||digest(output.inputs.map(i=>({lot:String(i.lot),exact_milli:i.exact_milli,min_milli:i.min_milli,max_milli:i.max_milli})))!==digest(rows.map(i=>({lot:String(i.lot),exact_milli:i.exact_milli,min_milli:i.min_milli,max_milli:i.max_milli}))))throw Q.error("MIX_TRANSFER_CONFLICT","Mix quantities must match the associated sale's authoritative constraints");
    } else if(rows.some(r=>r.exact_milli!=null||r.min_milli!=null||r.max_milli!=null))throw Q.error("MIX_BOUNDS_REQUIRE_TRANSFER","Record quantified mix constraints on the associated sale; a logical grouping has no independent demand",null,400);
    const mix = new M.Mix({ identity_key: identity, owner: owner.identity, inputs: rows, mode: body.mode || "UNKNOWN", physical_mixing: body.physical_mixing === true, output_transfer:output?._id, note: text(body.note).slice(0,2000), documents: docs.map(d => d._id), created_by: actor(user) });
    await mix.save({ session });
    if (mix.physical_mixing) await holdDependents(rows.map(r => r.lot), session, user, state.revision, "Physical mixing evidence requires renewed origin review");
    await audit(session, user, "mix_created", "mixes", mix._id, state.revision, { after: mix.toObject() }); return mix;
  });
}

async function holdDependents(seed, session, user, revision, reason) {
  const graph = await component(seed, session), ids = graph.lots.map(l => l._id);
  // Historical commitments remain active; disputed evidence must never release capacity.
  await M.Lot.updateMany({ _id: { $in: ids }, status: { $in: ["COMMITTED", "RESERVED"] } }, { $set: { status: "ON_HOLD", "verification.status": "ON_HOLD", origin_status: "ON_HOLD" } }, { session });
  const opIds = graph.operations.map(o => o._id);
  for (const model of [M.Transfer, M.Commitment]) await model.updateMany({ _id: { $in: opIds }, status: { $in: ["COMMITTED", "RESERVED"] } }, { $set: { status: "ON_HOLD", "verification.status": "ON_HOLD", origin_status: "ON_HOLD" } }, { session });
  const commitments = await M.Commitment.find({ _id: { $in: opIds } }).session(session);
  await Chain.updateMany({ _id: { $in: commitments.map(c => c.chain) } }, { $set: { inventory_status: "ON_HOLD" }, $push: { history: { event: "inventory_hold", at: new Date(), actor: actor(user), detail: { reason, revision } } } }, { session });
  await audit(session, user, "downstream_invalidated", "lots", ids[0], revision, { reason, details: { lots: ids, transactions: opIds, chains: commitments.map(c => c.chain) } });
  return graph;
}

const resources = { invoices: M.Invoice, batches: M.SourceBatch, lots: M.Lot, transfers: M.Transfer, mixes: M.Mix, commitments: M.Commitment };
async function verify(type, recordId, body, user, context) {
  const operation = async (session, state) => {
    const Model = resources[type];
    if (!Object.hasOwn(resources,type) || type === "lots" || type === "commitments") throw Q.error("INVALID_RESOURCE", "Use the incoming source/transfer or final chain review", null, 400);
    const record = await Model.findById(objectId(recordId)).session(session);
    if (!record) throw Q.error("NOT_FOUND", "Inventory record not found", null, 404);
    if (record.revision !== body.revision) throw Q.error("STALE_REVISION", "Review the latest evidence revision before verification");
    if (["CANCELLED", "REJECTED", "SUPERSEDED"].includes(record.status)) throw Q.error("TERMINAL_RECORD", "Cancelled or superseded records cannot be reactivated");
    if (!text(body.note)) throw Q.error("REVIEW_NOTE_REQUIRED", "Record the evidence and origin review conclusion", null, 400);
    if(type==="transfers"&&record.output_quantity_milli>record.quantity_milli)throw Q.error("RECEIPT_EXCEEDS_SUPPLY","The claimed receipt/output exceeds supported input; correct the draft before activation");
    const docs = await evidence(record.documents.map(String), session), purposes = new Set(docs.map(d => d.purpose));
    if (!docs.length) throw Q.error("EVIDENCE_REQUIRED", "Supporting documentary evidence is required");
    if (type === "batches") {
      if(record.harvest_date&&record.harvest_date>record.production_date)throw Q.error("CHRONOLOGY_CONFLICT","Harvest cannot follow production");
      for (const purpose of ["production", "license", "permission", "forest_image"]) if (!purposes.has(purpose)) throw Q.error("SOURCE_EVIDENCE_PENDING", `Verified source requires ${purpose} evidence`);
      if (!record.origins.length || record.origins.some(o => !o.plot || !o.permission || !Number.isFinite(o.latitude) || !Number.isFinite(o.longitude) || Math.abs(o.latitude) > 90 || Math.abs(o.longitude) > 180)) throw Q.error("ORIGIN_EVIDENCE_PENDING", "Complete each source plot, permission and valid coordinates");
    }
    if (type === "invoices") {
      const proofs=docs.filter(d=>["invoice","correction"].includes(d.purpose)).map(d=>d._id);
      if (await M.Invoice.exists({_id:{$ne:record._id},$or:[{documents:{$in:proofs}},{invoice_documents:{$in:proofs}}]}).session(session)) throw Q.error("DOCUMENT_IDENTITY_CONFLICT","Evidence already belongs to another invoice");
      if (!purposes.has("invoice")) throw Q.error("INVOICE_EVIDENCE_PENDING", "Invoice evidence is required");
      if(record.legacy&&docs.some(d=>d.purpose==="invoice"&&!d.sha256))throw Q.error("LEGACY_CHECKSUM_REVIEW_REQUIRED","Legacy invoice integrity must be established with hashed evidence before activation");
      const transfers = await M.Transfer.find({ invoice: record._id, status: { $nin: ["CANCELLED", "REJECTED", "SUPERSEDED"] } }).session(session);
      for (const t of transfers) {
        const line = record.lines.find(l => l.line_id === t.line_id);
        if (!line || Q.sum(transfers.filter(x => x.line_id === t.line_id).map(x => x.quantity_milli)) > line.quantity_milli) throw Q.error("INVOICE_LINE_EXCEEDED", "Correct or reverse fulfillments before verifying this reduced invoice");
      }
    }
    if (type === "transfers") {
      if (record.legacy && !context?.legacyImport) throw Q.error("LEGACY_ALLOCATION_REVIEW_REQUIRED", "Import and reconcile all historical container usage in one reviewed network before activating legacy transfers");
      if (!record.inputs.length) throw Q.error("SOURCES_PENDING", "Add supporting purchases before verification");
      const graph = await component(record.inputs.map(r => r.lot), session); await assertSpendable(graph, record.inputs, { reviewing: true });
      if (record.kind === "TRANSFER") {
        const invoice = await M.Invoice.findById(record.invoice).session(session);
        if (invoice?.status !== "COMMITTED" || invoice.verification.status !== "VERIFIED") throw Q.error("INVOICE_VERIFICATION_PENDING", "Verify the canonical sale invoice first");
        const line = invoice.lines.find(l=>l.line_id===record.line_id);
        if (!line || line.material !== record.input_material || record.date !== invoice.date) throw Q.error("INVOICE_LINE_CONFLICT", "Transfer must match the current invoice line, material and sale date");
        const transportDocs = await evidence(record.transport_documents.map(String), session), receiptDocs = await evidence(record.receipt_documents.map(String), session);
        for (const purpose of ["weight_slip", "billty", "driver_license", "ewaybill"]) if (!transportDocs.some(d => d.purpose === purpose)) throw Q.error("TRANSPORT_EVIDENCE_PENDING", `Transport requires ${purpose} evidence`);
        if (!receiptDocs.some(d => d.purpose === "receipt")) throw Q.error("RECEIPT_EVIDENCE_PENDING", "This receipt requires its own evidence");
      } else if (!purposes.has("transformation")) throw Q.error("TRANSFORMATION_EVIDENCE_PENDING", "Input, output and loss require verified transformation evidence");
      if (record.loss_milli && !record.discrepancy_note) throw Q.error("RECEIPT_DISCREPANCY", "Explain and verify the loss or shortage before activation");
      if (graph.lots.some(l => record.inputs.some(r => String(r.lot) === String(l._id)) && l.available_date === record.date) && body.same_day_reviewed !== true) throw Q.error("SAME_DAY_REVIEW", "Same-day receipt ordering requires explicit manual review");
    }
    record.status = "COMMITTED";
    record.verification = { status: "VERIFIED", evidence_revision: record.revision, actor: actor(user), at: new Date(), method: "manual", note: text(body.note).slice(0,2000), same_day_reviewed:body.same_day_reviewed===true };
    record.origin_status = body.origins_reviewed === true ? "VERIFIED" : "REVIEW_REQUIRED";
    if(reviewEnabled()&&type==="batches"){const plots=await require("../models/eudrReview.model").Plot.find({_id:{$in:record.origins.map(o=>o.plot_ref).filter(Boolean)}}).session(session).lean();if(record.origins.some(o=>!o.plot_ref)||plots.some(p=>p.satellite?.result!=="Pass"||(p.area_ha>4&&p.coords.length<3)))record.origin_status="REVIEW_REQUIRED";}
    await record.save({ session });
    if (record.output_lot) {
      await M.State.updateOne({_id:"global"},{$set:{inventory_enforced:true}},{session});
      const lot = await M.Lot.findById(record.output_lot).session(session);
      lot.status = record.status; lot.verification = record.verification; lot.origin_status = record.origin_status; lot.revision=record.revision; await lot.save({ session });
      await checkedGraph(await component([lot._id], session),session,user,state);
    }
    await audit(session, user, "evidence_verified", type, record._id, state.revision, { after: record.toObject() }); return record;
  };
  return context ? operation(context.session, context.state) : withInventory(user, operation);
}

async function reserve(body, user, context) {
  const operation = async (session, state) => {
    if (!state.allocation_enabled && !context?.legacyImport) throw Q.error("ALLOCATION_ROLLOUT_PENDING", "Container inventory allocation has not been enabled", null, 503);
    const chain = await Chain.findById(objectId(body.chain)).session(session);
    if (!chain) throw Q.error("CHAIN_NOT_FOUND", "Chain not found", null, 404);
    await Allocation.findOneAndUpdate({ _id: `${chain.container_key}|${chain.vendor}` }, { $inc: { revision: 1 } }, { upsert: true, session });
    const container = await loadContainer(chain.container,session), group = findGroup(container, chain.vendor);
    if (!group) throw Q.error("SHIPMENT_NOT_FOUND", "Vendor no longer has shipments in this container");
    const vendor = await party({ kind: "vendor", id: String(chain.vendor) }, session);
    const rows = inputs(body.species_allocations?.length?body.species_allocations.flatMap(r=>r.inputs):body.inputs), quantity = cft(body.quantity_cft), allocationDate = Q.date(body.date);
    const stuffingDates=group.rows.map(r=>r.stuffing_date).filter(Boolean).sort();
    if(stuffingDates.length&&allocationDate>stuffingDates[0])throw Q.error("CHRONOLOGY_CONFLICT","Documentary allocation must be available by the earliest vendor stuffing date",{allocation_date:allocationDate,stuffing_date:stuffingDates[0]});
    if (quantity !== contributionMilliCft(chain)) throw Q.error("CONTRIBUTION_MISMATCH", "Reservation must equal this chain's contribution");
    const siblings = await Chain.find({ container_key: chain.container_key, vendor: chain.vendor }).session(session);
    if (Q.sum(siblings.map(contributionMilliCft)) > group.stuffed_milli_cft) throw Q.error("CONTAINER_COVERAGE_EXCEEDED", "Existing chain contributions exceed live stuffed CFT");
    const existing = await M.Commitment.findOne({ chain: chain._id }).session(session);
    const graph = await component(rows.map(r => r.lot), session); await assertSpendable(graph, rows, { except: existing?._id,reviewing:existing?.status==="ON_HOLD" });
    const record = { seller: vendor.identity, quantity_milli: quantity, inputs: rows, date: allocationDate, mode: body.mode || "EXACT", input_material: "FINISHED", container: chain.container, container_key: chain.container_key, vendor: chain.vendor, chain: chain._id, same_day_reviewed:body.same_day_reviewed===true };
    if(reviewEnabled()||existing?.species_allocations?.length)record.species_allocations=await reviewRecords.allocations(body,rows,quantity,session);
    const hash = digest(record);
    if (existing && existing.request_hash === hash && ["RESERVED","COMMITTED"].includes(existing.status)) return existing;
    if (existing && existing.status === "COMMITTED") throw Q.error("COMMITTED_ALLOCATION", "Verified allocation requires audited release before correction");
    const commitment = existing || new M.Commitment({ identity_key: `container:${chain._id}`, created_by: actor(user) });
    const previous=existing?.toObject();
    if(existing)commitment.revision++;
    Object.assign(commitment, record, { request_hash: hash, status: "RESERVED", shipment_signature: group.inventory_shipment_signature, same_day_reviewed:body.same_day_reviewed===true });
    await commitment.save({ session });
    const result = await checkedGraph(await component(rows.map(r => r.lot), session),session,user,state);
    chain.inventory_backed = true; chain.inventory_status = "RESERVED"; chain.inventory_commitment = commitment._id; chain.inventory_revision = state.revision;
    chain.history.push({ event: "inventory_reserved", actor: actor(user), at: new Date(), detail: { commitment: commitment._id, quantity_milli: quantity } });
    chain.stages.filter(s => s.kind === "declaration").forEach(s => { s.verified_at = null; s.verification_result = "pending"; });
    // A canonical network supplies the upstream review; the container retains its own declaration.
    if (body.use_inherited_lineage === true && !chain.stages.some(s => s.verified_at || s.documents?.length || Object.keys(s.fields || {}).length)) chain.stages = [{ kind: "declaration", workflow_version: 3 }];
    await chain.save({ session });
    await audit(session, user, "quantity_reserved", "commitments", commitment._id, state.revision, { before:previous,after: commitment.toObject(), details: result }); return commitment;
  };
  return context ? operation(context.session, context.state) : withInventory(user, operation);
}

async function clearance(chainId, user, stageAction) {
  return withInventory(user, async (session, state) => {
    const chain = await Chain.findById(objectId(chainId)).session(session);
    const c = chain?.inventory_commitment && await M.Commitment.findById(chain.inventory_commitment).session(session);
    if (!chain?.inventory_backed || !c || !["RESERVED", "COMMITTED"].includes(c.status)) throw Q.error("INVENTORY_RESERVATION_REQUIRED", "Reserve documentary lots before final review");
    await Allocation.findOneAndUpdate({ _id: `${chain.container_key}|${chain.vendor}` }, { $inc: { revision: 1 } }, { upsert: true, session });
    const data = await loadContainer(chain.container,session), group = findGroup(data, chain.vendor);
    if (!group || data.unassigned.length || group.excluded.length || group.stuffed_milli_cft !== chain.declared_milli_cft || c.quantity_milli !== contributionMilliCft(chain)) throw Q.error("TIMBER_COVERAGE_INCOMPLETE", "Resolve missing Timber_CFT, vendor assignment and declaration quantities before final review");
    if(group.rows.some(r=>!r.stuffing_date)||group.rows.some(r=>r.stuffing_date<c.date))throw Q.error("STUFFING_DATE_REVIEW_REQUIRED","Recorded stuffing dates must establish that documentary supply was available before the container was stuffed");
    const siblings = await Chain.find({ container_key: chain.container_key, vendor: chain.vendor }).session(session);
    if (Q.sum(siblings.map(contributionMilliCft)) > group.stuffed_milli_cft) throw Q.error("CONTAINER_COVERAGE_EXCEEDED", "Chain contributions exceed stuffed CFT");
    const vendor = await party({ kind: "vendor", id: String(chain.vendor) }, session);
    if (vendor.identity !== c.seller) throw Q.error("VENDOR_IDENTITY_CHANGED", "Shipping vendor identity changed; review the reservation");
    const graph = await component(c.inputs.map(r => r.lot), session); await assertSpendable(graph, c.inputs); await checkedGraph(graph,session,user,state);
    if(!c.same_day_reviewed&&c.inputs.some(i=>graph.lots.find(l=>String(l._id)===String(i.lot))?.available_date===c.date))throw Q.error("SAME_DAY_REVIEW","Explicitly review same-day container supply ordering before final verification");
    if (graph.lots.some(l => Q.ACTIVE.has(l.status) && l.origin_status !== "VERIFIED") || graph.operations.some(o => !o.container && Q.ACTIVE.has(o.status) && o.origin_status !== "VERIFIED") || graph.mixes.some(m => m.physical_mixing && m.origin_status !== "VERIFIED")) throw Q.error("ORIGIN_REVIEW_REQUIRED", "Review all potential origins, mixing evidence and upstream transactions before final clearance");
    if(reviewEnabled()){await require("./eudrReport.service").fence(await require("./eudrReview.service").loadGroup(chain.container_key,String(chain.vendor),{session}),session);const review=await require("./eudrReview.service").reviewGroup(chain.container_key,String(chain.vendor),{session});if(review.final_blockers.length)throw Q.error("REVIEW_CLEARANCE_BLOCKED",review.final_blockers.join("; "),{review});}
    c.status = "COMMITTED"; c.verification = { status: "VERIFIED", evidence_revision: c.revision, actor: actor(user), at: new Date(), method: "manual", note: "Final chain evidence review",same_day_reviewed:c.same_day_reviewed }; c.origin_status = "VERIFIED"; c.shipment_signature = group.inventory_shipment_signature;
    await c.save({ session }); chain.inventory_status = "COMMITTED"; chain.inventory_revision = state.revision;
    if (stageAction) await stageAction(chain, group, data);
    await chain.save({ session }); await audit(session, user, "container_commitment_verified", "commitments", c._id, state.revision,{after:c.toObject()}); return chain;
  });
}

async function release(commitmentId, body, user) {
  return withInventory(user, async (session, state) => {
    if (!text(body.reason)) throw Q.error("REASON_REQUIRED", "An audited release reason is required", null, 400);
    const c = await M.Commitment.findById(objectId(commitmentId)).session(session);
    if (!c) throw Q.error("NOT_FOUND", "Commitment not found", null, 404);
    if (c.status === "CANCELLED") return c;
    if (c.revision !== body.revision) throw Q.error("STALE_REVISION", "Commitment changed; reload before release");
    const docs = await evidence(body.documents, session);
    if (c.status === "COMMITTED" && !docs.length) throw Q.error("REVERSAL_EVIDENCE_REQUIRED", "A completed allocation requires reversal evidence");
    const seeds=c.inputs.map(r=>r.lot),reconciliationBefore=reconciliationSnapshot(await component(seeds,session));
    const before = c.toObject(); c.status = "CANCELLED"; c.revision++; await c.save({ session });
    const chain = await Chain.findById(c.chain).session(session);
    if (chain) { chain.inventory_status = "ON_HOLD"; chain.stages.forEach(s => { s.verified_at = null; s.verification_result = "pending"; }); chain.history.push({ event: "inventory_released", actor: actor(user), at: new Date(), detail: { reason: body.reason } }); await chain.save({ session }); }
    const reconciliationAfter=await reconcileReversal(seeds,session,user,state,text(body.reason));
    await audit(session, user, "reservation_released", "commitments", c._id, state.revision, { before, after: c.toObject(), reason: text(body.reason), details: { documents: docs.map(d => d._id),reconciliationBefore,reconciliationAfter } }); return c;
  });
}

async function correct(type, recordId, body, user) {
  return withInventory(user, async (session, state) => {
    const Model = resources[type];
    if (!["invoices", "batches", "transfers"].includes(type)) throw Q.error("INVALID_CORRECTION", "Correct invoices, production or transfers through their owning record", null, 400);
    const record = await Model.findById(objectId(recordId)).session(session);
    if (!record) throw Q.error("NOT_FOUND", "Record not found", null, 404);
    if(["CANCELLED","REJECTED","SUPERSEDED"].includes(record.status))throw Q.error("TERMINAL_RECORD","Terminal documentary records cannot be reopened by a quantity correction");
    if (record.revision !== body.revision || !text(body.reason)) throw Q.error("CORRECTION_REVIEW_REQUIRED", "Current revision and explicit correction reason are required");
    const docs = await evidence(body.documents, session); if (!docs.length) throw Q.error("CORRECTION_EVIDENCE_REQUIRED", "Correction requires supporting evidence");
    const before = record.toObject();
    const wasDraft=record.status==="DRAFT";
    let affectedLots=record.output_lot?[record.output_lot]:[];
    if (type === "invoices") {
      const proofs=docs.filter(d=>["invoice","correction"].includes(d.purpose)).map(d=>d._id);
      if (await M.Invoice.exists({_id:{$ne:record._id},$or:[{documents:{$in:proofs}},{invoice_documents:{$in:proofs}}]}).session(session)) throw Q.error("DOCUMENT_IDENTITY_CONFLICT","Correction evidence already belongs to another invoice");
      const priorProofs=(await evidence(record.documents,session)).filter(d=>["invoice","correction"].includes(d.purpose));
      record.invoice_documents=[...new Set([...(record.invoice_documents||[]).map(String),...priorProofs.map(d=>String(d._id)),...proofs.map(String)])];
      if(!record.invoice_documents.length)record.invoice_documents=undefined;
      if (!Array.isArray(body.lines)) throw Q.error("INVALID_LINES", "Provide corrected invoice lines", null, 400);
      if(reviewEnabled())for(const line of body.lines)line.species=await reviewRecords.species(line.species,session);
    const lines = body.lines.map(l => ({ line_id: text(l.line_id), quantity_milli: cft(l.quantity_cft), material: l.material, species: reviewEnabled()?new mongoose.Types.ObjectId(l.species):text(l.species) }));
      const total = cft(body.total_cft);
      if (new Set(lines.map(l => l.line_id)).size !== lines.length || Q.sum(lines.map(l => l.quantity_milli)) !== total) throw Q.error("INVALID_LINES", "Corrected lines must sum to total", null, 400);
      record.lines = lines; record.total_milli = total;
      if (body.date) {
        Q.date(body.date);
        if (financialYear(body.date) !== record.financial_year) throw Q.error("INVOICE_IDENTITY_CORRECTION", "A different financial year requires a separately investigated identity correction");
        record.date = body.date;
      }
      const transfers = await M.Transfer.find({ invoice: record._id }).session(session);
      affectedLots=transfers.map(t=>t.output_lot);
      for (const t of transfers) {
        const line = lines.find(l => l.line_id === t.line_id);
        if(reviewEnabled()&&line&&String(t.species||"")!==String(line.species))throw Q.error("SPECIES_MISMATCH","Corrected invoice lines must retain transfer species");
        const siblings = transfers.filter(x => x.line_id === t.line_id && !["CANCELLED", "SUPERSEDED", "REJECTED"].includes(x.status));
        if (!line || Q.sum(siblings.map(x => x.quantity_milli)) > line.quantity_milli) await audit(session, user, "quantity_conflict", type, record._id, state.revision, { details: { line: t.line_id, transactions: siblings.map(x => x._id) } });
        if(!wasDraft)await holdDependents([t.output_lot], session, user, state.revision, body.reason);
      }
    } else if (type === "batches") {
      const production=docs.filter(d=>["production","correction"].includes(d.purpose)).map(d=>d._id);
      if(!state.production_proof_index_transitioned&&production.length&&await M.SourceBatch.exists({_id:{$ne:record._id},$or:[{documents:{$in:production}},{production_documents:{$in:production}}]}).session(session))throw Q.error("SOURCE_EVIDENCE_REUSED","Corrected production evidence already backs a separate source");
      if(state.production_proof_index_transitioned)await reviewRecords.claimProofs(record,docs,session);
      const priorProofs=(await evidence(record.documents,session)).filter(d=>["production","correction"].includes(d.purpose));
      record.production_documents=[...new Set([...(record.production_documents||[]).map(String),...priorProofs.map(d=>String(d._id)),...production.map(String)])];
      if(!record.production_documents.length)record.production_documents=undefined;
      if (body.quantity_cft != null) record.quantity_milli = cft(body.quantity_cft);
      if (body.production_date) record.production_date = Q.date(body.production_date);
      if (body.harvest_date) record.harvest_date=Q.date(body.harvest_date);
      if (body.origins) {
        if(!Array.isArray(body.origins)||body.origins.length>100)throw Q.error("INVALID_ORIGINS","Provide at most 100 plot references",null,400);
        record.origins = reviewEnabled()?await reviewRecords.origins(body.origins,session):body.origins;
      }
      await M.Lot.updateOne({ _id: record.output_lot }, { $set: { quantity_milli: record.quantity_milli, available_date: record.production_date } }, { session });
      if(!wasDraft)await holdDependents([record.output_lot], session, user, state.revision, body.reason);
    } else {
      if (body.sold_cft != null) record.quantity_milli = cft(body.sold_cft);
      if (body.received_cft != null) record.output_quantity_milli = cft(body.received_cft, false);
      if (!wasDraft&&record.output_quantity_milli > record.quantity_milli) throw Q.error("RECEIPT_EXCEEDS_SUPPLY", "Corrected receipt exceeds supply");
      if (body.date) record.date = Q.date(body.date);
      if (body.receipt_date) record.receipt_date = Q.date(body.receipt_date);
      if (body.dispatch_date) record.dispatch_date = Q.date(body.dispatch_date);
      if (record.receipt_date < record.date) throw Q.error("CHRONOLOGY_CONFLICT", "Receipt cannot precede sale");
      if(record.dispatch_date&&(record.dispatch_date<record.date||record.dispatch_date>record.receipt_date))throw Q.error("CHRONOLOGY_CONFLICT","Dispatch must fall between the sale and receipt");
      if (body.inputs) record.inputs = inputs(body.inputs); if (body.mode) record.mode = body.mode;
      if (body.discrepancy_note != null) record.discrepancy_note = text(body.discrepancy_note);
      record.loss_milli = Math.max(0,record.quantity_milli - record.output_quantity_milli);
      await M.Lot.updateOne({ _id: record.output_lot }, { $set: { quantity_milli: record.output_quantity_milli, available_date: record.receipt_date } }, { session });
      if(!wasDraft)await holdDependents([record.output_lot], session, user, state.revision, body.reason);
    }
    if(reviewEnabled()&&body.species&&type!=="invoices"){record.species=await reviewRecords.species(body.species,session);if(record.output_lot)await M.Lot.updateOne({_id:record.output_lot},{$set:{species:record.species}},{session});}
    if(reviewEnabled()&&type==="transfers"&&body.transport)record.transport=await reviewRecords.transport(body.transport,record.invoice,session,record._id);
    if(reviewEnabled()&&type!=="invoices"){await reviewRecords.validateRecord(record,type,session);if(type==="batches"&&body.species){record.production_reference_key=record.production_reference_key||record.identity_key.split("|species:")[0];record.identity_key=`${record.production_reference_key}|species:${record.species}`;}}
    record.documents = docs.map(d => d._id); record.revision++; record.verification.status = wasDraft?"PENDING":"ON_HOLD"; record.status = wasDraft?"DRAFT":"ON_HOLD"; record.origin_status = wasDraft?"PENDING":"ON_HOLD"; await record.save({ session });
    if(type==="transfers"){record.request_hash=transferHash(record);await record.save({session});}
    let reconciliation;
    if (affectedLots.length) { try { reconciliation = Q.reconcile(await component(affectedLots, session)); } catch (e) { reconciliation = { feasible: false, code: e.code, details: e.details }; } }
    if(reconciliation?.feasible===false)await audit(session,user,"quantity_conflict",type,record._id,state.revision,{reason:text(body.reason),details:reconciliation});
    if(reconciliation)await audit(session,user,"graph_recalculated",type,record._id,state.revision,{details:reconciliation});
    await audit(session, user, "transaction_corrected", type, record._id, state.revision, { before, after: record.toObject(), reason: text(body.reason), details: reconciliation }); return { record, reconciliation };
  });
}

async function reserveTransfer(recordId, user) {
  return withInventory(user, async (session,state) => {
    const t = await M.Transfer.findById(objectId(recordId)).session(session);
    if (!t || !["DRAFT", "RESERVED"].includes(t.status)) throw Q.error("INVALID_RESERVATION", "Only draft transfers can reserve supply");
    if (t.legacy) throw Q.error("LEGACY_ALLOCATION_REVIEW_REQUIRED","Legacy transfers require the reviewed historical network import");
    const graph = await component(t.inputs.map(i => i.lot), session); await assertSpendable(graph, t.inputs);
    if (t.invoice) { const invoice = await M.Invoice.findById(t.invoice).session(session); if (invoice?.status !== "COMMITTED") throw Q.error("INVOICE_VERIFICATION_PENDING", "Verify the sale invoice before reserving supply"); }
    t.status = "RESERVED"; await t.save({ session });
    await M.Lot.updateOne({ _id: t.output_lot }, { $set: { status: "RESERVED" } }, { session });
    await checkedGraph(await component([t.output_lot], session),session,user,state); await audit(session,user,"transfer_reserved","transfers",t._id,state.revision); return t;
  });
}
async function editDraft(recordId, body, user) {
  return withInventory(user, async (session,state) => {
    const t = await M.Transfer.findById(objectId(recordId)).session(session);
    if (!t || t.status !== "DRAFT" || t.revision !== body.revision) throw Q.error("DRAFT_EDIT_CONFLICT", "Only the current draft revision can be edited");
    if(body.sold_cft!=null)t.quantity_milli=cft(body.sold_cft);
    if(body.received_cft!=null)t.output_quantity_milli=cft(body.received_cft,false);
    if(body.date)t.date=Q.date(body.date);
    if(body.receipt_date)t.receipt_date=Q.date(body.receipt_date);
    if(t.receipt_date<t.date)throw Q.error("CHRONOLOGY_CONFLICT","Receipt cannot precede the sale");
    if(t.invoice) {
      const invoice=await M.Invoice.findById(t.invoice).session(session),line=invoice?.lines.find(l=>l.line_id===t.line_id);
      const others=await M.Transfer.find({_id:{$ne:t._id},invoice:t.invoice,line_id:t.line_id,status:{$nin:["CANCELLED","REJECTED","SUPERSEDED"]}}).session(session);
      if(!line||t.date!==invoice.date||Q.sum([...others.map(o=>o.quantity_milli),t.quantity_milli])>line.quantity_milli)throw Q.error("INVOICE_LINE_CONFLICT","Draft quantities and sale date must fit the canonical invoice line");
    }
    t.loss_milli=Math.max(0,t.quantity_milli-t.output_quantity_milli);
    if (body.inputs) t.inputs = inputs(body.inputs); if (body.mode) t.mode = body.mode;
    for (const field of ["documents", "transport_documents", "receipt_documents"]) if (body[field]) t[field] = (await evidence(body[field],session)).map(d => d._id);
    if (body.discrepancy_note != null) t.discrepancy_note = text(body.discrepancy_note).slice(0,2000);
    if(reviewEnabled()&&body.transport)t.transport=await reviewRecords.transport(body.transport,t.invoice,session,t._id);
    await reviewRecords.validateRecord(t,"transfers",session);
    t.request_hash=transferHash(t);t.revision++; await t.save({session});
    await M.Lot.updateOne({_id:t.output_lot},{$set:{quantity_milli:t.output_quantity_milli,available_date:t.receipt_date,revision:t.revision}},{session});
    await audit(session,user,"transfer_draft_edited","transfers",t._id,state.revision,{after:t.toObject()}); return t;
  });
}
async function cancel(type, recordId, body, user) {
  return withInventory(user, async (session,state) => {
    if (!["batches", "transfers", "invoices","mixes"].includes(type) || !text(body.reason)) throw Q.error("REVERSAL_REASON_REQUIRED", "Choose a record and provide an explicit reversal reason", null, 400);
    const record = await resources[type].findById(objectId(recordId)).session(session);
    if (!record) throw Q.error("NOT_FOUND", "Record not found", null, 404);
    if (record.status === "CANCELLED") return record;
    if (record.revision !== body.revision) throw Q.error("STALE_REVISION", "Review the current record before reversal");
    const docs = await evidence(body.documents,session);
    if ((Q.ACTIVE.has(record.status)||record.physical_mixing) && !docs.length) throw Q.error("REVERSAL_EVIDENCE_REQUIRED", "Historical commitments require reversal evidence");
    const dependencies = record.output_lot ? [...await M.Transfer.find({ "inputs.lot": record.output_lot, status: { $nin: ["CANCELLED","REJECTED","SUPERSEDED"] } }).session(session).lean(), ...await M.Commitment.find({ "inputs.lot": record.output_lot, status: { $nin: ["CANCELLED","REJECTED","SUPERSEDED"] } }).session(session).lean()] : await M.Transfer.find({ invoice: record._id, status: { $nin: ["CANCELLED","REJECTED","SUPERSEDED"] } }).session(session).lean();
    if (dependencies.length) throw Q.error("DOWNSTREAM_REVERSAL_REQUIRED", "Reverse dependent transactions before cancelling this record", { dependencies: dependencies.map(d=>({id:d._id, output_lot:d.output_lot, chain:d.chain, quantity_milli:d.quantity_milli})) });
    const seeds=record.inputs?.map(i=>i.lot)||[record.output_lot].filter(Boolean),reconciliationBefore=reconciliationSnapshot(await component(seeds,session));
    if(record.physical_mixing)await holdDependents(seeds,session,user,state.revision,text(body.reason));
    const before = record.toObject(); record.status = "CANCELLED"; record.revision++; await record.save({session});
    if (record.output_lot) await M.Lot.updateOne({_id:record.output_lot},{$set:{status:"CANCELLED", "verification.status":"ON_HOLD"}},{session});
    const reconciliationAfter=await reconcileReversal(seeds,session,user,state,text(body.reason));
    await audit(session,user,"transaction_reversed",type,record._id,state.revision,{before,after:record.toObject(),reason:text(body.reason),details:{documents:docs.map(d=>d._id),reconciliationBefore,reconciliationAfter}});return record;
  });
}

async function chainProjection(chain) {
  const commitment = await M.Commitment.findById(chain.inventory_commitment).lean();
  if (!commitment) return { inventory_status: "ON_HOLD", inventory_documents: [] };
  const graph = await component(commitment.inputs.map(i=>i.lot));
  const sources = await M.SourceBatch.find({_id:{$in:graph.lots.map(l=>l.source_batch).filter(Boolean)}}).lean();
  const invoices = await M.Invoice.find({_id:{$in:graph.lots.map(l=>l.invoice).filter(Boolean)}}).lean();
  const documents = await networkEvidence(graph,sources,invoices);
  return { inventory_documents: publicRecord(documents), inventory_network: publicRecord(graph) };
}

async function networkEvidence(graph,sources,invoices,session) {
  const owners=[...sources.map(r=>({r,resource:"source",label:"Production "+r.identity_key})),...invoices.map(r=>({r,resource:"invoice",label:"Invoice "+r.number})),...graph.operations.map(r=>({r,resource:r.container?"container":"transfer",label:r.container||"Transfer "+r._id})),...graph.mixes.map(r=>({r,resource:"mix",label:"Mix "+r.identity_key}))];
  const referenced=r=>[...(r.documents||[]),...(r.transport_documents||[]),...(r.receipt_documents||[])].map(String);
  const documents=await M.Document.find({_id:{$in:owners.flatMap(o=>referenced(o.r))}}).session(session).lean();
  return documents.map(d=>({...d,contexts:owners.filter(o=>referenced(o.r).includes(String(d._id))).map(o=>({resource:o.resource,id:o.r._id,label:o.label,revision:o.r.revision,verification:o.r.verification?.status,origin_status:o.r.origin_status}))}));
}

function potentialOrigins(graph,sources,lotId) {
  const operations=new Map(graph.operations.map(o=>[String(o._id),o]));
  const lots=new Map(graph.lots.map(l=>[String(l._id),l]));
  const sourceIds=new Set(),seen=new Set(),pending=[String(lotId)];
  while(pending.length) {
    const id=pending.pop();if(seen.has(id))continue;seen.add(id);
    const lot=lots.get(id);if(lot?.source_batch)sourceIds.add(String(lot.source_batch));
    for(const input of operations.get(String(lot?.incoming_operation))?.inputs||[])pending.push(String(input.lot));
    for(const mix of graph.mixes.filter(m=>m.physical_mixing&&m.inputs.some(i=>String(i.lot)===id)))for(const input of mix.inputs)pending.push(String(input.lot));
  }
  return sources.filter(s=>sourceIds.has(String(s._id))).flatMap(s=>s.origins.map(o=>({...o,source_batch:s._id})));
}

async function reviewLegacyNetwork(body, user) {
  if (!Array.isArray(body.records) || !body.records.length || body.records.length > 200 || !Array.isArray(body.allocations) || body.allocations.length > 100 || !text(body.reason)) throw Q.error("LEGACY_REVIEW_REQUIRED", "Provide reviewed record revisions, every historical allocation and an import reason", null, 400);
  return withInventory(user, async (session, state) => {
    const ids = body.records.filter(r=>r.resource==="invoices").map(r=>objectId(r.id));
    const invoices = await M.Invoice.find({_id:{$in:ids},legacy:true}).session(session);
    if (!invoices.length) throw Q.error("LEGACY_REVIEW_REQUIRED", "Select legacy canonical invoices for this reviewed import");
    const transferIds=body.records.filter(r=>r.resource==="transfers").map(r=>objectId(r.id));
    const legacyTransfers=await M.Transfer.find({_id:{$in:transferIds},legacy:true}).session(session);
    if(legacyTransfers.some(t=>!ids.includes(String(t.invoice))))throw Q.error("HISTORICAL_INVOICES_MISSING","Include every legacy transfer's canonical invoice in the reviewed import");
    const chainIds = [...new Set(invoices.flatMap(i=>i.chain_references.map(String)))];
    const allocated = new Set(body.allocations.map(a=>objectId(a.chain)));
    if (allocated.size !== body.allocations.length || chainIds.some(id=>!allocated.has(id))) throw Q.error("HISTORICAL_USES_MISSING", "Map every chain referencing these historical invoices; historical quantities cannot be forgotten", { required_chains: chainIds });
    for (const record of body.records) await verify(record.resource, record.id, record, user, { session, state, legacyImport:true });
    const commitments=[];
    for (const allocation of body.allocations) commitments.push(await reserve(allocation,user,{session,state,legacyImport:true}));
    await M.Review.updateMany({chain:{$in:chainIds}},{$set:{resolved:true}},{session});
    await audit(session,user,"historical_network_reviewed","invoices",invoices[0]._id,state.revision,{reason:text(body.reason),details:{records:body.records.map(r=>({resource:r.resource,id:r.id,revision:r.revision})),commitments:commitments.map(c=>c._id)}});
    return { commitments, chains: chainIds };
  });
}

module.exports = { M, Q, resources, cft, objectId, party, evidence, inputs, publicRecord, digest, ensureIndexes, withInventory, audit, component, check, assertSpendable, holdDependents, registerInvoice, createSource, createTransfer, createMix, verify, reserve, clearance, release, correct, reserveTransfer, editDraft, cancel, chainProjection, reviewLegacyNetwork, networkEvidence, potentialOrigins, ledgerEnforced };
