const I = require("./eudrInventory.service");
const { invoiceKey, normalizeIdentifier } = require("../helpers/timberCft");
const { collectInvoiceKeys } = require("./eudrChain.service");
const Chain = require("../models/eudrChain.model");
const { M, Q } = I;
const { normalizeUserRoleKey } = require("../helpers/userRole");
function archivedStages(chain) {
  const archived = (chain.history||[]).flatMap(h=>h.event==="later_stages_superseded"?h.detail?.stages||[]:h.event==="legacy_receiver_upgraded"?[h.detail?.stage].filter(Boolean):[]);
  for(const h of chain.history||[]) if(h.event==="stage_edited"&&h.detail?.before?.invoice_number) {
    const stage=[...(chain.stages||[]),...archived].find(s=>String(s._id)===h.stage_id);
    if(stage)archived.push({...(stage.toObject?.()||stage),fields:h.detail.before,documents:[]});
  }
  return archived;
}

function extract(chain) {
  const invoices = [], reasons = [];
  for (const stage of chain.stages || []) {
    if (!["sawmill", "receiver"].includes(stage.kind) || !stage.fields?.invoice_number) continue;
    const f = stage.fields, modern = stage.kind === "sawmill" || Boolean(stage.incoming_invoice_stage_id);
    try {
      const identity = invoiceKey({ issuer_gst: modern ? f.gst : f.issuer_gst, invoice_number: f.invoice_number, invoice_date: f.invoice_date });
      const quantity = f.sold_cft ? I.cft(f.sold_cft) : 0;
      if (!quantity) reasons.push(`Stage ${stage._id}: invoice quantity is not established`);
      if (!f.buyer_gst || !f.buyer_pan) reasons.push(`Stage ${stage._id}: buyer identity is incomplete`);
      const invoiceDocument = (stage.documents || []).find(d => d.type === (stage.kind === "sawmill" ? "cutting_invoice" : "invoice"));
      if (!invoiceDocument) reasons.push(`Stage ${stage._id}: invoice document is missing`);
      const receiver = chain.stages.find(s => s.incoming_invoice_stage_id === String(stage._id));
      invoices.push({ identity, stage, receiver, quantity, issuer: `${normalizeIdentifier(modern ? f.gst : f.issuer_gst)}|${normalizeIdentifier(modern ? f.pan : f.issuer_pan)}`, buyer: `${normalizeIdentifier(f.buyer_gst)}|${normalizeIdentifier(f.buyer_pan)}`, invoiceDocument });
    } catch (e) { reasons.push(`Stage ${stage._id}: ${e.message}`); }
  }
  if (invoices.length) reasons.push("Production quantity, material conversion and historical container usage require ledger review; legacy approvals are not inventory certification");
  return { invoices, reasons };
}
async function document(doc, chain, stage, session) {
  let existing = await M.Document.findOne(doc.sha256 ? { $or: [{ key: doc.key }, { sha256: doc.sha256 }] } : { key: doc.key }).session(session);
  if (!existing) { existing = new M.Document({ key: doc.key, name: doc.name, sha256: doc.sha256, content_type: doc.content_type, size: doc.size, purpose: ["cutting_invoice", "invoice"].includes(doc.type) ? "invoice" : doc.type, legacy_reference: { chain: chain._id, stage_id: String(stage._id), document_id: String(doc._id) } }); await existing.save({ session }); }
  return existing;
}
async function linkChain(chain, session, state, user) {
  const plan = extract(chain), refs = [], transferByStage = new Map();
  const prior=await Chain.findById(chain._id).select("stages canonical_invoices").session(session).lean();
  if (prior?.canonical_invoices?.length) for(const oldStage of prior.stages) {
    const current=chain.stages.find(s=>String(s._id)===String(oldStage._id));
    const fileIdentity=d=>({type:d.type,key:d.key,sha256:d.sha256});
    if(current&&I.digest({fields:current.fields,documents:current.documents.map(fileIdentity)})===I.digest({fields:oldStage.fields,documents:oldStage.documents.map(fileIdentity)}))continue;
    const stageIndex=prior.stages.indexOf(oldStage);
    const sellers=[oldStage,oldStage.kind==="transport"?prior.stages[stageIndex-1]:prior.stages.find(s=>String(s._id)===oldStage.incoming_invoice_stage_id)].filter(Boolean);
    for(const seller of sellers) {
      const old=extract({stages:[seller]}).invoices[0];
      if(old) {
        const invoice=await M.Invoice.findOne({identity_key:old.identity}).session(session);
        const transfers=invoice?await M.Transfer.find({invoice:invoice._id}).session(session):[];
        for(const t of transfers)await I.holdDependents([t.output_lot],session,user,state.revision,"Linked chain stage evidence changed");
      }
    }
  }
  for (const item of plan.invoices) {
    const { stage, invoiceDocument } = item, f = stage.fields;
    const docs = invoiceDocument ? [await document(invoiceDocument, chain, stage, session)] : [];
    const claimed=docs.length&&await M.Invoice.findOne({identity_key:{$ne:item.identity},$or:[{documents:docs[0]._id},{invoice_documents:docs[0]._id}]}).session(session);
    if(claimed)throw Q.error("DOCUMENT_IDENTITY_CONFLICT","Invoice evidence already belongs to another canonical invoice",{invoice:claimed._id});
    let invoice = await M.Invoice.findOne({ identity_key: item.identity }).session(session);
    if (invoice) {
      const differentDocs = docs.length && invoice.documents.length && !invoice.documents.some(d => String(d) === String(docs[0]._id));
      const differs = invoice.date !== f.invoice_date || (invoice.total_milli && item.quantity && invoice.total_milli !== item.quantity) || (invoice.buyer !== "|" && item.buyer !== "|" && invoice.buyer !== item.buyer) || differentDocs;
      if (differs) {
        if (!chain.canonical_invoices?.some(i => String(i) === String(invoice._id))) throw Q.error("INVOICE_IDENTITY_CONFLICT", "Historical invoice identity has conflicting quantity, parties, date or document", { invoice: invoice._id, chain: chain._id });
        if(invoice.status!=="DRAFT"&&!["admin","super_admin"].includes(normalizeUserRoleKey(user?.role)))throw Q.error("FORBIDDEN","A verified canonical invoice correction requires an administrator",null,403);
        const before = invoice.toObject();
        invoice.invoice_documents=[...new Set([...(invoice.invoice_documents||[]).map(String),...invoice.documents.map(String),...docs.map(d=>String(d._id))])];
        invoice.date = f.invoice_date; invoice.total_milli = item.quantity; invoice.buyer = item.buyer; invoice.lines = item.quantity ? [{ line_id: "1", quantity_milli: item.quantity, material: "RAW" }] : []; invoice.documents = docs.map(d => d._id); invoice.revision++; invoice.status = "ON_HOLD"; invoice.verification.status = "ON_HOLD";
        const transfers = await M.Transfer.find({ invoice: invoice._id }).session(session);
        for (const t of transfers) await I.holdDependents([t.output_lot], session, user, state.revision, "Chain invoice evidence corrected");
        await I.audit(session, user, "invoice_evidence_corrected", "invoices", invoice._id, state.revision, { before, after: invoice.toObject() });
      }
      if (invoice.status === "DRAFT" && invoice.total_milli === 0 && item.quantity) { invoice.total_milli = item.quantity; invoice.lines = [{ line_id: "1", quantity_milli: item.quantity, material: "RAW" }]; }
      invoice.documents = [...new Set([...invoice.documents.map(String), ...docs.map(d => String(d._id))])];
      if (!invoice.chain_references.some(c => String(c) === String(chain._id))) invoice.chain_references.push(chain._id);
    } else invoice = new M.Invoice({ identity_key: item.identity, issuer: item.issuer, buyer: item.buyer, issuer_snapshot: { name: f.name || f.issuer_name, gst: f.gst || f.issuer_gst, pan: f.pan || f.issuer_pan }, buyer_snapshot: { name: f.sold_to, gst: f.buyer_gst, pan: f.buyer_pan }, number: f.invoice_number, date: f.invoice_date, financial_year: Number(item.identity.split("|")[1]), total_milli: item.quantity, lines: item.quantity ? [{ line_id: "1", quantity_milli: item.quantity, material: "RAW" }] : [], documents: docs.map(d => d._id), chain_references: [chain._id], legacy: true });
    if(docs.length)invoice.invoice_documents=[...new Set([...(invoice.invoice_documents||[]).map(String),...docs.map(d=>String(d._id))])];
    await invoice.save({ session }); refs.push(invoice._id);
    if (item.quantity && item.buyer !== "|" && item.receiver && item.receiver.fields?.received_cft != null && item.receiver.fields.received_cft !== "") {
      const received = I.cft(item.receiver.fields.received_cft, false);
      if (received > item.quantity) plan.reasons.push(`Stage ${stage._id}: receipt exceeds sale`);
      else {
        const identity = `${invoice._id}|1|full`;
        let transfer = await M.Transfer.findOne({ identity_key: identity }).session(session);
        if (!transfer) {
          const previous = transferByStage.get(stage.incoming_invoice_stage_id);
          transfer = new M.Transfer({ identity_key: identity, seller: item.issuer, buyer: item.buyer, invoice: invoice._id, line_id: "1", fulfillment: "full", quantity_milli: item.quantity, output_quantity_milli: received, loss_milli: item.quantity - received, date: f.invoice_date, receipt_date: f.invoice_date, input_material: "RAW", output_material: "RAW", mode: "UNKNOWN", inputs: previous ? [{ lot: previous.output_lot, participation:"POSSIBLE", evidence_note: "Legacy incoming_invoice_stage_id relationship; source proportions require review" }] : [], documents: docs.map(d => d._id), chains: [chain._id], legacy: true });
          const lot = new M.Lot({ identity_key: `receipt:${transfer._id}`, owner: item.buyer, holder_snapshot: invoice.buyer_snapshot, kind: "RECEIPT", invoice: invoice._id, line_id: "1", incoming_operation: transfer._id, quantity_milli: received, documented_milli: item.quantity, available_date: f.invoice_date, material: "RAW", documents: invoice.documents, legacy: true });
          transfer.output_lot = lot._id; await lot.save({ session }); await transfer.save({ session });
        } else if (!transfer.chains.some(c => String(c) === String(chain._id))) { transfer.chains.push(chain._id); await transfer.save({ session }); }
        transferByStage.set(String(stage._id), transfer);
      }
    }
  }
  chain.canonical_invoices = refs;
  const historical = extract({stages:archivedStages(chain)});
  for(const item of historical.invoices) {
    let invoice=await M.Invoice.findOne({identity_key:item.identity}).session(session);
    if(!invoice) {
      const f=item.stage.fields,doc=item.invoiceDocument?await document(item.invoiceDocument,chain,item.stage,session):null;
      invoice=new M.Invoice({identity_key:item.identity,issuer:item.issuer,buyer:item.buyer,issuer_snapshot:{name:f.name||f.issuer_name,gst:f.gst||f.issuer_gst,pan:f.pan||f.issuer_pan},buyer_snapshot:{name:f.sold_to,gst:f.buyer_gst,pan:f.buyer_pan},number:f.invoice_number,date:f.invoice_date,financial_year:Number(item.identity.split("|")[1]),total_milli:item.quantity,lines:item.quantity?[{line_id:"1",quantity_milli:item.quantity,material:"RAW"}]:[],documents:doc?[doc._id]:[],chain_references:[chain._id],status:"ON_HOLD",legacy:true});
      if(doc)invoice.invoice_documents=[doc._id];
      await invoice.save({session});await I.audit(session,user,"historical_invoice_preserved","invoices",invoice._id,state.revision,{details:{chain:chain._id,stage:item.stage._id}});
    }
    if(!chain.canonical_invoices.some(i=>String(i)===String(invoice._id)))chain.canonical_invoices.push(invoice._id);
  }
  chain.invoice_keys = collectInvoiceKeys(chain.stages);
  if (plan.reasons.length) await M.Review.updateOne({ identity_key: `chain:${chain._id}` }, { $set: { chain: chain._id, reasons: plan.reasons, snapshot: { stages: chain.stages, contribution_milli: chain.contribution_milli_cft ?? chain.declared_milli_cft } }, $setOnInsert: { resolved: false } }, { upsert: true, session });
  await chain.save({ session }); await I.audit(session, user, "canonical_chain_linked", "chains", chain._id, state.revision, { details: { invoices: refs, review: plan.reasons } });
  return plan;
}
async function saveChain(chain, user) {
  if (process.env.EUDR_CANONICAL_INVOICES !== "true") return chain.save();
  return I.withInventory(user, async (session, state) => linkChain(chain, session, state, user));
}
async function report() {
  const chains = await Chain.find().sort({ _id: 1 }).lean(), identities = new Map(), reviews = [], conflicts = [];
  for (const chain of chains) {
    const plan = extract(chain); reviews.push({ chain: String(chain._id), reasons: plan.reasons, invoices: plan.invoices.map(i => i.identity) });
    for (const item of [...plan.invoices,...extract({stages:archivedStages(chain)}).invoices.filter(i=>!plan.invoices.some(p=>p.identity===i.identity))]) {
      const signature = I.digest({ date: item.stage.fields.invoice_date, quantity: item.quantity, buyer: item.buyer, document: item.invoiceDocument?.sha256 || item.invoiceDocument?.key });
      if (identities.has(item.identity) && identities.get(item.identity).signature !== signature) conflicts.push({ identity: item.identity, chains: [identities.get(item.identity).chain, String(chain._id)] });
      else identities.set(item.identity, { chain: String(chain._id), signature });
    }
  }
  return { chain_count: chains.length, invoice_count: identities.size, conflicts, reviews, writes: 0 };
}
async function migrate(user = {}) {
  const preview = await report();
  if (preview.conflicts.length) throw Q.error("MIGRATION_CONFLICT", "Resolve canonical identity conflicts before migration", preview);
  await I.ensureIndexes();
  const chainIds = await Chain.find().select("_id").lean();
  for (const { _id } of chainIds) await I.withInventory(user, async (session, state) => {
    const chain = await Chain.findById(_id).session(session);
    await linkChain(chain, session, state, user);
  }, { preparation: true });
  await I.withInventory(user, async (session) => {
    await M.State.updateOne({ _id: "global" }, { $set: { registry_ready: true } }, { session });
  }, { preparation: true });
  return { ...preview, writes: chainIds.length };
}
async function transitionIndex() {
  if (process.env.EUDR_CANONICAL_INVOICES !== "true") throw Q.error("DEPLOYMENT_CONFIGURATION", "Set EUDR_CANONICAL_INVOICES=true on every writer before transitioning the index");
  const preview = await report(), state = await M.State.findById("global");
  if (!state?.registry_ready || preview.conflicts.length || await Chain.countDocuments({ "invoice_keys.0": { $exists: true }, "canonical_invoices.0": { $exists: false } })) throw Q.error("MIGRATION_INCOMPLETE", "Canonical ownership must be complete and conflict-free before index transition");
  await M.Invoice.createIndexes();
  const indexes = await Chain.collection.indexes();
  const index = indexes.find(i => i.name === "invoice_keys_1" && i.unique && i.sparse && Object.keys(i.key).length === 1 && i.key.invoice_keys === 1);
  if (index) await Chain.collection.dropIndex(index.name);
  await M.State.updateOne({ _id: "global" }, { $set: { invoice_index_transitioned: true } });
  return { transitioned: true };
}
module.exports = { extract, document, linkChain, saveChain, report, migrate, transitionIndex };
