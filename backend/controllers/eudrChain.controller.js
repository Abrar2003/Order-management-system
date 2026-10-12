const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const mongoose = require("mongoose");
const EudrChain = require("../models/eudrChain.model");
const Party = require("../models/eudrParty.model");
const storage = require("../services/wasabiStorage.service");
const { saveStageDirectory, evidenceMatches, reusableTypes } = require("../services/eudrDirectory.service");
const { fileMime, sha256, assertUniqueFile } = require("../services/eudrFiles.service");
const {
  text, key, fail, loadContainer, findGroup,
  nextStageKind, externalInvalidation, documents, allowedFields, isSeller, receiverFromSeller, assertReceiverLink, assertStageAvailable, assertDeclaredCft, assertFinalCft, validateStage, collectInvoiceKeys, toMilliCft,
} = require("../services/eudrChain.service");

const replyError = (res, error) => res.status(error?.code === 11000 || error?.name === "VersionError" ? 409 : error?.statusCode || 500).json({
  message: error?.code === 11000 ? "This container/vendor chain or issuer invoice number already exists" : error?.name === "VersionError" ? "Chain changed while saving. Refresh and try again." : error?.message || "EUDR request failed",
});
const actor = (req) => req.user?._id || req.user?.id;
let indexReady;
const ensureIndexes = () => { indexReady ||= EudrChain.createIndexes(); return indexReady; };
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
const details = (chain, group, containerData) => ({
  ...chain.toObject(),
  vendor: group?.vendor || null,
  stuffed_cft: group?.stuffed_cft ?? null,
  excluded: group?.excluded || [],
  shipment_rows: group?.rows || [],
  unassigned: containerData?.unassigned || [],
  current_stage_id: String(chain.stages.find((stage) => !stage.verified_at)?._id || ""),
  complete: chain.stages.at(-1)?.kind === "declaration" && Boolean(chain.stages.at(-1)?.verified_at),
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
    const chains = await EudrChain.find({ container_key: key(req.query.container) }).select("vendor declared_milli_cft stages updatedAt").lean();
    return res.json({ ...data, chains: chains.map((chain) => ({ _id: chain._id, vendor_id: String(chain.vendor), declared_cft: chain.declared_milli_cft / 1000, complete: chain.stages?.at(-1)?.kind === "declaration" && Boolean(chain.stages.at(-1)?.verified_at) })) });
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
      return { _id: chain._id, container: chain.container, vendor: group?.vendor || null, declared_cft: chain.declared_milli_cft / 1000, updatedAt: chain.updatedAt, complete: chain.stages.at(-1)?.kind === "declaration" && Boolean(chain.stages.at(-1)?.verified_at) };
    }));
    return res.json({ data });
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
    const chain = await EudrChain.create({ container, container_key: key(container), vendor: vendorId, declared_milli_cft: declaredMilliCft, created_by: actor(req), stages: [{ kind: "sawmill", workflow_version: 2 }] });
    return res.status(201).json({ data: details(chain, group, containerData) });
  } catch (error) { return replyError(res, error); }
};

exports.get = async (req, res) => {
  try {
    const chain = await getChain(req);
    const containerData = await loadContainer(chain.container);
    const group = await refresh(chain, req, containerData);
    return res.json({ data: details(chain, group, containerData) });
  } catch (error) { return replyError(res, error); }
};

exports.updateDeclared = async (req, res) => {
  try {
    const chain = await getChain(req);
    const declared = Number(req.body?.declared_cft);
    if (!text(req.body?.declared_cft) || !Number.isFinite(declared) || declared <= 0 || Math.abs(declared * 1000 - Math.round(declared * 1000)) > 1e-7) throw fail("Declared CFT must be positive with at most three decimals");
    const next = toMilliCft(declared);
    const containerData = await loadContainer(chain.container);
    const group = findGroup(containerData, chain.vendor);
    if (!group) throw fail("Vendor no longer has shipments in this container", 409);
    assertDeclaredCft(next, group);
    if (next !== chain.declared_milli_cft) {
      event(chain, req, "declared_cft_changed", null, { before: chain.declared_milli_cft / 1000, after: declared });
      chain.declared_milli_cft = next;
      let index = chain.stages.findIndex((stage) => stage.workflow_version >= 2 && isSeller(stage, group.vendor) && toMilliCft(stage.fields?.sold_cft || 0) < next);
      if (index < 0) index = chain.stages.findIndex((stage) => stage.kind === "declaration");
      if (index >= 0) clearVerification(chain, req, index, "Declared CFT changed");
      await chain.save();
    }
    return res.json({ data: details(chain, group, containerData) });
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
    const before = JSON.stringify(stage.fields || {});
    if (before !== JSON.stringify(fields)) {
      upgradeStage(chain, req, stage, index, fields);
      if (stage.kind === "receiver" && !isSeller({ ...stage.toObject(), fields }, findGroup(containerData, chain.vendor)?.vendor)) {
        for (const field of ["invoice_number", "invoice_date", "sold_to", "buyer_gst", "buyer_pan", "sold_cft"]) delete fields[field];
      }
      event(chain, req, "stage_edited", stage, { before: stage.fields || {}, after: fields });
      discardLaterStages(chain, req, index, "Earlier stage edited");
      clearVerification(chain, req, index, "Stage edited");
      stage.fields = fields;
      chain.invoice_keys = collectInvoiceKeys(chain.stages);
      await chain.save();
    }
    await saveStageDirectory(stage);
    return res.json({ data: details(chain, findGroup(containerData, chain.vendor), containerData) });
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
    const fileHash = sha256(req.file.buffer);
    await assertUniqueFile(chain, { name: req.file.originalname, size: req.file.size, sha256: fileHash });
    upgradeStage(chain, req, stage, index);
    uploadedKey = storage.createStorageKey({ folder: `eudr/${chain._id}/${stage._id}`, originalName: req.file.originalname });
    await storage.uploadBuffer({ buffer: req.file.buffer, key: uploadedKey, originalName: req.file.originalname, contentType: fileMime(req.file.originalname) });
    replaceDocument(chain, req, stage, index, type, { key: uploadedKey, name: req.file.originalname, content_type: fileMime(req.file.originalname), size: req.file.size, sha256: fileHash });
    await chain.save();
    uploadedKey = "";
    await saveStageDirectory(stage);
    return res.json({ data: details(chain, findGroup(containerData, chain.vendor), containerData) });
  } catch (error) {
    if (uploadedKey) await storage.deleteObject(uploadedKey).catch(() => {});
    return replyError(res, error);
  }
};

exports.directory = async (req, res) => {
  try {
    const kind = text(req.query.kind);
    if (!Object.hasOwn(reusableTypes, kind)) throw fail("Unsupported directory kind");
    const query = { kind };
    if (req.query.parent_key) query.parent_key = text(req.query.parent_key);
    const search = text(req.query.search).slice(0, 100);
    if (search) query.name = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const entries = await Party.find(query).sort({ name: 1 }).limit(50).lean();
    return res.json({ data: entries.map(({ evidence, ...entry }) => ({ ...entry, evidence: (evidence || []).map(({ key, ...item }) => item) })) });
  } catch (error) { return replyError(res, error); }
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
    await chain.save();
    await saveStageDirectory(stage);
    return res.json({ data: details(chain, findGroup(containerData, chain.vendor), containerData) });
  } catch (error) { return replyError(res, error); }
};

exports.documentUrl = async (req, res) => {
  try {
    const chain = await getChain(req);
    const stage = chain.stages.id(req.params.stageId);
    const document = stage?.documents.id(req.params.documentId);
    if (!document) throw fail("Document not found", 404);
    const url = await storage.getSignedObjectUrl(document.key, { expiresIn: 300, filename: document.name, download: req.query?.download === "1" });
    return res.json({ url });
  } catch (error) { return replyError(res, error); }
};

exports.documentContent = async (req, res) => {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  res.once("close", cancel);
  try {
    const chain = await getChain(req);
    const document = chain.stages.id(req.params.stageId)?.documents.id(req.params.documentId);
    if (!document) throw fail("Document not found", 404);
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
    const chain = await getChain(req);
    const document = chain.stages.id(req.params.stageId)?.documents.id(req.params.documentId);
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
    if (stage.verified_at) throw fail("This stage is already verified", 409);
    if (!group) throw fail("Vendor no longer has shipments in this container", 409);
    if (!text(group.vendor.gst) || !text(group.vendor.pan)) throw fail("Vendor GST and PAN are required");
    assertDeclaredCft(chain.declared_milli_cft, group);
    assertReceiverLink(chain, stage);
    validateStage(stage, { vendor: group.vendor, declaredMilliCft: chain.declared_milli_cft });
    const next = nextStageKind(stage, group.vendor);
    const nextStage = next === "receiver" ? receiverFromSeller(chain.stages[index - 1]) : { kind: next, workflow_version: 2 };
    if (stage.kind === "declaration") {
      assertFinalCft(chain, group, containerData.unassigned);
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
    await chain.save();
    return res.json({ data: details(chain, group, containerData) });
  } catch (error) { return replyError(res, error); }
};
