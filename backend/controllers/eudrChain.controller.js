const reviewLayer=require("../services/eudrReview.service");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const mongoose = require("mongoose");
const EudrChain = require("../models/eudrChain.model");
const Party = require("../models/eudrParty.model");
const Vendor = require("../models/vendor.model");
const allocation = require("../services/eudrAllocation.service");
const storage = require("../services/wasabiStorage.service");
const inventory = require("../services/eudrInventory.service");
const inventoryMigration = require("../services/eudrInventoryMigration.service");
const { saveStageDirectory, evidenceMatches, reusableTypes } = require("../services/eudrDirectory.service");
const { fileMime, sha256, assertUniqueFile, assertForestImage } = require("../services/eudrFiles.service");
const {
  text, key, fail, loadContainer, findGroup,
  nextStageKind, externalInvalidation, documents, allowedFields, isSeller, receiverFromSeller, assertReceiverLink, assertStageAvailable, assertDeclaredCft, assertFinalCft, validateStage, collectInvoiceKeys, toMilliCft, contributionMilliCft, chainVerified, chainCoverage,
} = require("../services/eudrChain.service");

const replyError = (res, error) => res.status(error?.code === 11000 || error?.name === "VersionError" ? 409 : error?.statusCode || 500).json({
  code: typeof error?.code === "string" ? error.code : error?.code === 11000 ? "IDENTITY_CONFLICT" : error?.name === "VersionError" ? "CONCURRENT_MODIFICATION" : "EUDR_REQUEST_FAILED",
  ...(error?.details ? { details: inventory.publicRecord(error.details) } : {}),
  message: error?.code === 11000 ? "An issuer invoice number already exists, or an allocation changed concurrently. Refresh and try again." : error?.name === "VersionError" ? "Chain changed while saving. Refresh and try again." : error?.message || "EUDR request failed",
});
const actor = (req) => req.user?._id || req.user?.id;
let indexReady;
const ensureIndexes = () => { indexReady ||= allocation.ensureIndexes().catch((error) => { indexReady = null; throw error; }); return indexReady; };
const event = (chain, req, name, stage, detail = {}) => chain.history.push({ event: name, stage_id: stage ? String(stage._id) : "", actor: actor(req), actor_name: text(req.user?.name || req.user?.username), detail });
const clearVerification = (chain, req, start, reason) => {
  for (let index = start; index < chain.stages.length; index += 1) {
    const stage = chain.stages[index];
    if (!stage.verified_at) continue;
    event(chain, req, "verification_invalidated", stage, { reason, previous_verified_at: stage.verified_at, previous_verified_by: stage.verified_by });
    stage.verified_at = null;
    stage.verified_by = null;
    stage.verified_by_name = "";
    stage.verification_result = "pending";
    stage.vendor_signature = "";
    stage.shipment_signature = "";
  }
};
const refresh = async (chain, req, containerData) => {
  const group = findGroup(containerData, chain.vendor);
  const invalidation = externalInvalidation(chain.stages, group);
  if (invalidation) clearVerification(chain, req, invalidation.index, invalidation.reason);
  if (chain.isModified()) await chain.save();
  return group;
};
const details = async (chain, group, containerData) => ({
  ...chain.toObject(),
  ...(reviewLayer.enabled()?{review:await reviewLayer.reviewGroup(chain.container_key,String(chain.vendor))}:{}),
  ...(chain.inventory_backed && chain.inventory_commitment ? await inventory.chainProjection(chain) : {}),
  vendor: group?.vendor || null,
  stuffed_cft: group?.stuffed_cft ?? null,
  excluded: group?.excluded || [],
  shipment_rows: group?.rows || [],
  unassigned: containerData?.unassigned || [],
  contribution_milli_cft: contributionMilliCft(chain),
  coverage: chainCoverage(await EudrChain.find({ container_key: chain.container_key, vendor: chain.vendor }).lean(), group, containerData?.unassigned),
  current_stage_id: String(chain.stages.find((stage) => !stage.verified_at)?._id || ""),
  complete: chainVerified(chain, group, containerData?.unassigned),
});
const getChain = async (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw fail("Chain not found", 404);
  const chain = await EudrChain.findById(req.params.id);
  if (!chain) throw fail("Chain not found", 404);
  return chain;
};
const findStage = (chain, stageId) => {
  const index = chain.stages.findIndex((stage) => String(stage._id) === String(stageId));
  if (index < 0) throw fail("Stage not found", 404);
  assertStageAvailable(chain.stages, index);
  return { stage: chain.stages[index], index };
};
const discardLaterStages = (chain, req, index, reason) => {
  if (index + 1 < chain.stages.length) {
    event(chain, req, "later_stages_superseded", chain.stages[index], {
      reason,
      stages: chain.stages.slice(index + 1).map((stage) => stage.toObject()),
    });
    chain.stages.splice(index + 1);
  }
};
const upgradeStage = (chain, req, stage, index, fields = stage.fields) => {
  if (stage.kind === "receiver" && !stage.incoming_invoice_stage_id) {
    const seller = chain.stages[index - 2];
    const linked = receiverFromSeller(seller);
    if (!seller.verified_at) throw fail("Reverify the preceding seller first", 409);
    event(chain, req, "legacy_receiver_upgraded", stage, { stage: stage.toObject() });
    stage.documents = stage.documents.filter((document) => document.type !== "invoice");
    if (fields.invoice_number === stage.fields.invoice_number && fields.invoice_date === stage.fields.invoice_date) { delete fields.invoice_number; delete fields.invoice_date; }
    stage.incoming_invoice_stage_id = linked.incoming_invoice_stage_id;
    for (const field of ["name", "gst", "pan"]) fields[field] = linked.fields[field];
    delete fields.issuer_name; delete fields.issuer_gst; delete fields.issuer_pan;
    stage.markModified?.("fields");
  }
  stage.workflow_version = 2;
  assertReceiverLink(chain, stage, fields);
};
const replaceDocument = (chain, req, stage, index, type, document) => {
  const replaced = stage.documents.find((item) => item.type === type);
  event(chain, req, "document_uploaded", stage, { type, name: document.name, replaced: replaced?.toObject?.() || replaced || null });
  discardLaterStages(chain, req, index, "Earlier document replaced");
  clearVerification(chain, req, index, "Document replaced");
  stage.documents = stage.documents.filter((item) => item.type !== type);
  stage.documents.push({ ...document, type });
  chain.invoice_keys = collectInvoiceKeys(chain.stages);
};

exports.lookupContainer = async (req, res) => {
  try {
    const data = await loadContainer(req.query.container);
    const chains = await EudrChain.find({ container_key: key(req.query.container) }).select("vendor declared_milli_cft contribution_milli_cft stages updatedAt inventory_backed inventory_status").lean();
    const payload={ ...data, vendors: data.vendors.map((group) => ({ ...group, coverage: chainCoverage(chains.filter((chain) => String(chain.vendor) === group.vendor._id), group, data.unassigned) })), chains: chains.map((chain) => ({ _id: chain._id, vendor_id: String(chain.vendor), declared_cft: chain.declared_milli_cft / 1000, contribution_cft: contributionMilliCft(chain) / 1000, complete: chainVerified(chain, findGroup(data, chain.vendor), data.unassigned) })) };
    if(reviewLayer.enabled()){for(const group of payload.vendors){group.review=await reviewLayer.reviewGroup(data.container.toLowerCase(),group.vendor._id);group.report_status=group.review.report_status;}if(req.query.status)payload.vendors=payload.vendors.filter(g=>g.review.status[0]===req.query.status);}
    return res.json(payload);
  } catch (error) { return replyError(res, error); }
};

exports.list = async (req, res) => {
  try {
    const chains = await EudrChain.find(req.query.container ? { container_key: key(req.query.container) } : {}).sort({ updatedAt: -1 }).limit(50);
    const containers = new Map();
    const data = await Promise.all(chains.map(async (chain) => {
      if (!containers.has(chain.container_key)) containers.set(chain.container_key, loadContainer(chain.container));
      const containerData = await containers.get(chain.container_key);
      const group = await refresh(chain, req, containerData);
      return { _id: chain._id, container: chain.container, vendor: group?.vendor || null, declared_cft: chain.declared_milli_cft / 1000, contribution_cft: contributionMilliCft(chain) / 1000, updatedAt: chain.updatedAt, complete: chainVerified(chain, group, containerData.unassigned) };
    }));
    if(reviewLayer.enabled()){const cache=new Map();for(const entry of data){const k=`${entry.container.toLowerCase()}|${entry.vendor?._id}`;if(entry.vendor){if(!cache.has(k))cache.set(k,reviewLayer.reviewGroup(entry.container.toLowerCase(),entry.vendor._id));entry.review=await cache.get(k);entry.report_status=entry.review.report_status;}}}
    return res.json({ data:reviewLayer.enabled()&&req.query.status?data.filter(r=>r.review?.status[0]===req.query.status):data });
  } catch (error) { return replyError(res, error); }
};

exports.create = async (req, res) => {
  try {
    await ensureIndexes();
    const container = text(req.body?.container);
    const vendorId = text(req.body?.vendor_id);
    const declared = Number(req.body?.declared_cft);
    if (!container || !mongoose.isValidObjectId(vendorId)) throw fail("Container and vendor are required");
    if (!text(req.body?.declared_cft) || !Number.isFinite(declared) || declared <= 0 || Math.abs(declared * 1000 - Math.round(declared * 1000)) > 1e-7) throw fail("Declared CFT must be positive with at most three decimals");
    const containerData = await loadContainer(container);
    const group = findGroup(containerData, vendorId);
    if (!group) throw fail("This vendor has no shipments in the container");
    if (!text(group.vendor.gst) || !text(group.vendor.pan)) throw fail("Vendor GST and PAN are required before starting EUDR");
    const declaredMilliCft = toMilliCft(declared);
    assertDeclaredCft(declaredMilliCft, group);
    const contribution = req.body.contribution_cft == null ? declared : Number(req.body.contribution_cft);
    if (!Number.isFinite(contribution) || contribution <= 0 || Math.abs(contribution * 1000 - Math.round(contribution * 1000)) > 1e-7) throw fail("Chain contribution must be positive with at most three decimals");
    const chain = await allocation.withAllocation(container, vendorId, async (chains, session) => {
      allocation.assertAllocation(chains, toMilliCft(contribution), group.stuffed_milli_cft);
      const created = new EudrChain({ container, container_key: key(container), vendor: vendorId, declared_milli_cft: declaredMilliCft, contribution_milli_cft: toMilliCft(contribution), created_by: actor(req), inventory_backed: process.env.EUDR_INVENTORY_REQUIRED === "true", inventory_status: process.env.EUDR_INVENTORY_REQUIRED === "true" ? "ON_HOLD" : "LEGACY", stages: [{ kind: "sawmill", workflow_version: 2 }] });
      event(created, req, "chain_created", null, { contribution_cft: contribution, declared_cft: declared });
      await created.save({ session });
      return created;
    });
    return res.status(201).json({ data: await details(chain, group, containerData) });
  } catch (error) { return replyError(res, error); }
};

exports.get = async (req, res) => {
  try {
    const chain = await getChain(req);
    const containerData = await loadContainer(chain.container);
    const group = await refresh(chain, req, containerData);
    return res.json({ data: await details(chain, group, containerData) });
  } catch (error) { return replyError(res, error); }
};

exports.updateDeclared = async (req, res) => {
  try {
    await ensureIndexes();
    let chain = await getChain(req);
    const declared = Number(req.body?.declared_cft);
    if (!text(req.body?.declared_cft) || !Number.isFinite(declared) || declared <= 0 || Math.abs(declared * 1000 - Math.round(declared * 1000)) > 1e-7) throw fail("Declared CFT must be positive with at most three decimals");
    const next = toMilliCft(declared);
    const containerData = await loadContainer(chain.container);
    const group = findGroup(containerData, chain.vendor);
    if (!group) throw fail("Vendor no longer has shipments in this container", 409);
    assertDeclaredCft(next, group);
    chain = await allocation.withAllocation(chain.container, chain.vendor, async (chains, session) => {
      const current = chains.find((entry) => String(entry._id) === String(chain._id));
      if (!current) throw fail("Chain not found", 404);
      for (const entry of chains) {
        if (next === entry.declared_milli_cft) continue;
        event(entry, req, "declared_cft_changed", null, { before: entry.declared_milli_cft / 1000, after: declared });
        if (entry.contribution_milli_cft == null) entry.contribution_milli_cft = chains.length === 1 ? next : entry.declared_milli_cft;
        entry.declared_milli_cft = next;
        let index = entry.stages.findIndex((stage) => stage.workflow_version >= 2 && isSeller(stage, group.vendor) && toMilliCft(stage.fields?.sold_cft || 0) < contributionMilliCft(entry));
        if (index < 0) index = entry.stages.findIndex((stage) => stage.kind === "declaration");
        if (index >= 0) clearVerification(entry, req, index, "Container/vendor declared CFT changed");
        await entry.save({ session });
      }
      return current;
    });
    return res.json({ data: await details(chain, group, containerData) });
  } catch (error) { return replyError(res, error); }
};

exports.updateContribution = async (req, res) => {
  try {
    await ensureIndexes();
    let chain = await getChain(req);
    const value = Number(req.body?.contribution_cft);
    if (!Number.isFinite(value) || value <= 0 || Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-7) throw fail("Chain contribution must be positive with at most three decimals");
    const next = toMilliCft(value);
    const containerData = await loadContainer(chain.container);
    const group = findGroup(containerData, chain.vendor);
    if (!group) throw fail("Vendor no longer has shipments in this container", 409);
    chain = await allocation.withAllocation(chain.container, chain.vendor, async (chains, session) => {
      const entry = chains.find((item) => String(item._id) === String(chain._id));
      if (!entry) throw fail("Chain not found", 404);
      if (entry.inventory_backed && await inventory.M.Commitment.exists({ chain: entry._id, status: { $in: [...inventory.Q.ACTIVE] } }).session(session)) throw fail("Release the active inventory reservation before changing its contribution", 409);
      allocation.assertAllocation(chains, next, group.stuffed_milli_cft, entry._id);
      if (next !== contributionMilliCft(entry)) {
        event(entry, req, "contribution_cft_changed", null, { before: contributionMilliCft(entry) / 1000, after: value });
        entry.contribution_milli_cft = next;
        clearVerification(entry, req, 0, "Chain CFT contribution changed");
        await entry.save({ session });
      }
      return entry;
    });
    return res.json({ data: await details(chain, group, containerData) });
  } catch (error) { return replyError(res, error); }
};

exports.saveStage = async (req, res) => {
  try {
    await ensureIndexes();
    const chain = await getChain(req);
    const containerData = await loadContainer(chain.container);
    await refresh(chain, req, containerData);
    const { stage, index } = findStage(chain, req.params.stageId);
    const input = req.body?.fields;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("Stage fields are required");
    for (const field of Object.keys(input)) if (!allowedFields[stage.kind].includes(field)) throw fail(`Unknown ${stage.kind} field: ${field}`);
    for (const value of Object.values(input)) {
      if (value != null && !["string", "number"].includes(typeof value)) throw fail("Stage fields must be text or numbers");
      if (text(value).length > 500) throw fail("Stage field values must be 500 characters or fewer");
    }
    const fields = Object.fromEntries(Object.entries(input).map(([field, value]) => [field, text(value)]));
    assertReceiverLink(chain, stage, fields);
    if (fields.buyer_type && !["vendor", "other"].includes(fields.buyer_type)) throw fail("Select sold to vendor or other party");
    if (fields.buyer_type === "other") delete fields.buyer_vendor_id;
    if (fields.buyer_type === "vendor" && (fields.buyer_vendor_id || ["sold_to", "buyer_gst", "buyer_pan"].some((field) => fields[field]))) {
      if (!mongoose.isValidObjectId(fields.buyer_vendor_id)) throw fail("Select a vendor for Sold To");
      const unchangedBuyer = stage.fields?.buyer_type === "vendor" && fields.buyer_vendor_id === stage.fields.buyer_vendor_id && ["sold_to", "buyer_gst", "buyer_pan"].every((field) => fields[field] === stage.fields[field]);
      if (!unchangedBuyer) {
        const buyer = await Vendor.findOne({ _id: fields.buyer_vendor_id, deleted_at: null, is_active: { $ne: false } }).select("name gst pan").lean();
        if (!buyer) throw fail("Selected vendor is no longer available", 409);
        if (!text(buyer.gst) || !text(buyer.pan)) throw fail("Add GST and PAN to this vendor before selecting it for Sold To", 409);
        Object.assign(fields, { sold_to: text(buyer.name), buyer_gst: text(buyer.gst), buyer_pan: text(buyer.pan) });
      }
    }
    const before = JSON.stringify(stage.fields || {});
    if (before !== JSON.stringify(fields)) {
      upgradeStage(chain, req, stage, index, fields);
      if (stage.kind === "receiver" && !isSeller({ ...stage.toObject(), fields }, findGroup(containerData, chain.vendor)?.vendor)) {
        for (const field of ["invoice_number", "invoice_date", "sold_to", "buyer_gst", "buyer_pan", "sold_cft", "buyer_type", "buyer_vendor_id"]) delete fields[field];
      }
      event(chain, req, "stage_edited", stage, { before: stage.fields || {}, after: fields });
      discardLaterStages(chain, req, index, "Earlier stage edited");
      clearVerification(chain, req, index, "Stage edited");
      stage.fields = fields;
      chain.invoice_keys = collectInvoiceKeys(chain.stages);
      await inventoryMigration.saveChain(chain, req.user);
    }
    await saveStageDirectory(stage);
    return res.json({ data: await details(chain, findGroup(containerData, chain.vendor), containerData) });
  } catch (error) { return replyError(res, error); }
};

exports.upload = async (req, res) => {
  let uploadedKey = "";
  try {
    if (!req.file) throw fail("File is required");
    const chain = await getChain(req);
    const containerData = await loadContainer(chain.container);
    await refresh(chain, req, containerData);
    const { stage, index } = findStage(chain, req.params.stageId);
    const type = text(req.body?.type);
    if (stage.kind === "receiver" && !isSeller(stage, findGroup(containerData, chain.vendor)?.vendor)) throw fail("The final receiver uses the preceding seller's invoice and does not accept onward-sale uploads");
    if (![...documents[stage.kind], ...(["sawmill", "receiver"].includes(stage.kind) ? ["buyer_gst", "buyer_pan"] : []), ...(stage.kind === "transport" ? ["truck_registration"] : [])].includes(type)) throw fail("Unsupported document type");
    if (!fileMime(req.file.originalname)) throw fail("Unsupported EUDR file format");
    if (type === "forest_image") await assertForestImage(req.file);
    const fileHash = sha256(req.file.buffer);
    if(process.env.EUDR_CANONICAL_INVOICES==="true"&&["cutting_invoice","invoice"].includes(type)){
      const registered=await inventory.M.Document.findOne({sha256:fileHash}).lean();
      const invoice=registered&&await inventory.M.Invoice.findOne({$or:[{documents:registered._id},{invoice_documents:registered._id}]}).select("_id").lean();
      if(invoice)throw inventory.Q.error("DOCUMENT_REUSE_AVAILABLE","This registered invoice file can be linked without uploading another copy",{invoice_id:invoice._id,document_id:registered._id});
    }
    await assertUniqueFile(chain, { name: req.file.originalname, size: req.file.size, sha256: fileHash });
    upgradeStage(chain, req, stage, index);
    uploadedKey = storage.createStorageKey({ folder: `eudr/${chain._id}/${stage._id}`, originalName: req.file.originalname });
    await storage.uploadBuffer({ buffer: req.file.buffer, key: uploadedKey, originalName: req.file.originalname, contentType: fileMime(req.file.originalname) });
    replaceDocument(chain, req, stage, index, type, { key: uploadedKey, name: req.file.originalname, content_type: fileMime(req.file.originalname), size: req.file.size, sha256: fileHash });
    await inventoryMigration.saveChain(chain, req.user);
    uploadedKey = "";
    await saveStageDirectory(stage);
    return res.json({ data: await details(chain, findGroup(containerData, chain.vendor), containerData) });
  } catch (error) {
    if (uploadedKey) await storage.deleteObject(uploadedKey).catch(() => {});
    return replyError(res, error);
  }
};

exports.directory = async (req, res) => {
  try {
    const kind = text(req.query.kind);
    if (kind !== "vendor" && !(kind==="generator"&&reviewLayer.enabled()) && !Object.hasOwn(reusableTypes, kind)) throw fail("Unsupported directory kind");
    const query = kind === "vendor" ? { deleted_at: null, is_active: { $ne: false } } : { kind };
    if (req.query.parent_key) query.parent_key = text(req.query.parent_key);
    const search = text(req.query.search).slice(0, 100);
    if (search) query.name = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (kind === "vendor") {
      const vendors = await Vendor.find(query).select("name gst pan").sort({ name: 1 }).limit(50).lean();
      return res.json({ data: vendors.map((vendor) => ({ _id: vendor._id, kind, name: vendor.name, fields: { sold_to: vendor.name, buyer_gst: vendor.gst || "", buyer_pan: vendor.pan || "" }, evidence: [] })) });
    }
    const entries = await Party.find(query).sort({ name: 1 }).limit(50).lean();
    return res.json({ data: entries.map(({ evidence, ...entry }) => ({ ...entry, evidence: (evidence || []).map(({ key, ...item }) => item) })) });
  } catch (error) { return replyError(res, error); }
};

exports.reuseInvoice = async (req,res) => {
  try {
    if(process.env.EUDR_CANONICAL_INVOICES!=="true")throw fail("Canonical invoice linking is not enabled",503);
    if(req.body?.confirmed!==true)throw fail("Confirm this is the same canonical invoice");
    const chain=await getChain(req),containerData=await loadContainer(chain.container);
    await refresh(chain,req,containerData);
    const {stage,index}=findStage(chain,req.params.stageId);
    if(!["sawmill","receiver"].includes(stage.kind)||!isSeller(stage,findGroup(containerData,chain.vendor)?.vendor))throw fail("Select a seller invoice stage");
    upgradeStage(chain,req,stage,index);
    const invoice=await inventory.M.Invoice.findById(inventory.objectId(req.body.invoice_id));
    const item=inventoryMigration.extract({stages:[stage]}).invoices[0];
    if(!invoice||!item||invoice.identity_key!==item.identity||invoice.issuer!==item.issuer||invoice.buyer!==item.buyer||invoice.total_milli!==item.quantity||invoice.lines.length!==1)throw inventory.Q.error("INVOICE_IDENTITY_CONFLICT","Invoice issuer, buyer, date, quantity and single line must match this stage; use Inventory for multi-line allocations");
    const document=await inventory.M.Document.findOne({_id:{$in:invoice.documents},purpose:"invoice"});
    if(!document)throw fail("Canonical invoice evidence is missing",409);
    const data=document.toObject();delete data._id;
    replaceDocument(chain,req,stage,index,stage.kind==="sawmill"?"cutting_invoice":"invoice",data);
    event(chain,req,"canonical_invoice_reused",stage,{invoice_id:invoice._id,document_id:document._id});
    await inventoryMigration.saveChain(chain,req.user);
    return res.json({data:await details(chain,findGroup(containerData,chain.vendor),containerData)});
  } catch(error){return replyError(res,error);}
};
exports.directoryDetail = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.partyId)) throw fail("Saved details not found", 404);
    const party = await Party.findById(req.params.partyId).lean();
    if (!party) throw fail("Saved details not found", 404);
    return res.json({ data: { ...party, evidence: (party.evidence || []).map(({ key, ...item }) => item) } });
  } catch (error) { return replyError(res, error); }
};
exports.reuseEvidence = async (req, res) => {
  try {
    if (req.body?.confirmed !== true) throw fail("Confirm that this saved evidence is still valid");
    if (!mongoose.isValidObjectId(req.body?.party_id) || !mongoose.isValidObjectId(req.body?.evidence_id)) throw fail("Saved details or evidence not found", 404);
    const party = await Party.findById(req.body.party_id);
    const evidence = party?.evidence.id(req.body.evidence_id);
    if (!evidence || !reusableTypes[party.kind]?.includes(evidence.type)) throw fail("Saved evidence not found", 404);
    const chain = await getChain(req);
    const containerData = await loadContainer(chain.container);
    await refresh(chain, req, containerData);
    const { stage, index } = findStage(chain, req.params.stageId);
    if (!evidenceMatches(party, stage, evidence.type)) throw fail("Saved evidence does not match this stage's identity", 409);
    const source = await storage.getObjectBuffer(evidence.key);
    const document = { ...evidence.toObject(), sha256: sha256(source.buffer), size: source.buffer.length };
    delete document._id;
    if (!fileMime(document.name)) throw fail("Unsupported EUDR evidence format");
    await assertUniqueFile(chain, document);
    upgradeStage(chain, req, stage, index);
    replaceDocument(chain, req, stage, index, document.type, document);
    event(chain, req, "saved_evidence_reused", stage, { party_id: String(party._id), type: document.type, name: document.name, validity_confirmed: true });
    await inventoryMigration.saveChain(chain, req.user);
    await saveStageDirectory(stage);
    return res.json({ data: await details(chain, findGroup(containerData, chain.vendor), containerData) });
  } catch (error) { return replyError(res, error); }
};

exports.documentUrl = async (req, res) => {
  try {
    const document = req.inventoryDocument || (await getChain(req)).stages.id(req.params.stageId)?.documents.id(req.params.documentId);
    if (!document) throw fail("Document not found", 404);
    if (require('../services/eudrLocalDemo.service').documentPath(document.key)) return res.json({ url: `${req.protocol}://${req.get('host')}${req.originalUrl.replace(/\/url(?:\?.*)?$/, '/content')}` });
    const url = await storage.getSignedObjectUrl(document.key, { expiresIn: 300, filename: document.name, download: req.query?.download === "1" });
    return res.json({ url });
  } catch (error) { return replyError(res, error); }
};

exports.documentContent = async (req, res) => {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  res.once("close", cancel);
  try {
    const document = req.inventoryDocument || (await getChain(req)).stages.id(req.params.stageId)?.documents.id(req.params.documentId);
    if (!document) throw fail("Document not found", 404);
    const localDemoPath = require('../services/eudrLocalDemo.service').documentPath(document.key);
    if (localDemoPath) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.vary('Cookie'); res.vary('Authorization');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(document.name)}`);
      return res.sendFile(localDemoPath, error => { if (error && !res.headersSent) replyError(res, error); });
    }
    const url = await storage.getSignedObjectUrl(document.key, { expiresIn: 300 });
    const upstream = await fetch(url, { headers: req.headers.range ? { Range: req.headers.range } : {}, signal: abort.signal });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      throw fail("Document could not be loaded", upstream.status === 404 ? 404 : upstream.status === 416 ? 416 : 502);
    }
    res.status(upstream.status);
    res.setHeader("Cache-Control", "private, no-store");
    res.vary("Cookie");
    res.vary("Authorization");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const mime = fileMime(document.name);
    res.setHeader("Content-Type", ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mime) ? mime : "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(document.name)}`);
    for (const name of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (error) {
    if (!res.headersSent && !res.destroyed) return replyError(res, error);
    if (!res.destroyed) res.destroy();
  } finally { res.removeListener("close", cancel); }
};

exports.documentPreview = async (req, res) => {
  try {
    const document = req.inventoryDocument || (await getChain(req)).stages.id(req.params.stageId)?.documents.id(req.params.documentId);
    if (!document) throw fail("Document not found", 404);
    const mime = fileMime(document.name);
    if (mime === "application/pdf" || mime?.startsWith("image/")) return exports.documentContent(req, res);
    if (!mime) throw fail("This document format cannot be previewed", 415);
    const buffer = await require("../services/eudrPreview.service").officePreview(document);
    res.setHeader("Cache-Control", "private, no-store");
    res.vary("Cookie"); res.vary("Authorization");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type("application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=preview.pdf");
    return res.send(buffer);
  } catch (error) { return replyError(res, error); }
};

exports.verify = async (req, res) => {
  try {
    await ensureIndexes();
    const chain = await getChain(req);
    const containerData = await loadContainer(chain.container);
    const group = await refresh(chain, req, containerData);
    const { stage, index } = findStage(chain, req.params.stageId);
    if (stage.kind === "declaration" && chain.inventory_backed) {
      const updated = await inventory.clearance(chain._id, req.user, async (locked, currentGroup, currentData) => {
        const currentStage = locked.stages.id(req.params.stageId);
        if (!currentStage || currentStage.verified_at) throw fail("Declaration changed; refresh before verifying", 409);
        assertStageAvailable(locked.stages, locked.stages.indexOf(currentStage));
        validateStage(currentStage, { vendor: currentGroup.vendor });
        assertFinalCft(locked, currentGroup, currentData.unassigned);
        currentStage.workflow_version = 3; currentStage.verified_at = new Date(); currentStage.verified_by = actor(req); currentStage.verified_by_name = text(req.user?.name); currentStage.verification_result = "verified"; currentStage.shipment_signature = currentGroup.inventory_shipment_signature; currentStage.vendor_signature = currentGroup.vendor_signature;
        event(locked, req, "stage_verified", currentStage, { method: "manual", inventory: true });
      });
      return res.json({ data: await details(updated, group, containerData) });
    }
    if (stage.kind === "declaration" && await inventory.ledgerEnforced()) throw fail("Reserve documentary inventory before final declaration", 409);
    if (stage.verified_at) throw fail("This stage is already verified", 409);
    if (!group) throw fail("Vendor no longer has shipments in this container", 409);
    if (!text(group.vendor.gst) || !text(group.vendor.pan)) throw fail("Vendor GST and PAN are required");
    assertDeclaredCft(chain.declared_milli_cft, group);
    assertReceiverLink(chain, stage);
    allocation.assertAllocation([], contributionMilliCft(chain), group.stuffed_milli_cft);
    validateStage(stage, { vendor: group.vendor, contributionMilliCft: contributionMilliCft(chain) });
    const next = nextStageKind(stage, group.vendor);
    const nextStage = next === "receiver" ? receiverFromSeller(chain.stages[index - 1]) : { kind: next, workflow_version: 2 };
    if (stage.kind === "declaration") {
      assertFinalCft(chain, group, containerData.unassigned);
      const siblings = await EudrChain.find({ container_key: chain.container_key, vendor: chain.vendor }).lean();
      allocation.assertAllocation(siblings, contributionMilliCft(chain), group.stuffed_milli_cft, chain._id);
    }
    chain.invoice_keys = collectInvoiceKeys(chain.stages);
    stage.verified_at = new Date();
    stage.verified_by = actor(req);
    stage.verified_by_name = text(req.user?.name || req.user?.username);
    stage.verification_method = "manual";
    stage.verification_result = "verified";
    if (stage.kind === "receiver") stage.vendor_signature = group.vendor_signature;
    if (stage.kind === "declaration") stage.shipment_signature = group.shipment_signature;
    event(chain, req, "stage_verified", stage, { method: "manual" });
    if (next && chain.stages[index + 1]?.kind !== next) {
      discardLaterStages(chain, req, index, "Receiver match changed");
    }
    if (next && index === chain.stages.length - 1) {
      chain.stages.push(nextStage);
    }
    chain.invoice_keys = collectInvoiceKeys(chain.stages);
    await inventoryMigration.saveChain(chain, req.user);
    return res.json({ data: await details(chain, group, containerData) });
  } catch (error) { return replyError(res, error); }
};
