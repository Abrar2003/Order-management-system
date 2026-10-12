import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChainDocuments, filterChainDocuments, missingStageDocuments, formatCft, stageFields, stageDocuments, incomingInvoice, receiverMatchesVendor } from "./eudrDocuments.js";

const fixture = () => ({
  stages: [
    { _id: "mill", kind: "sawmill", verified_at: "2026-10-12", documents: [{ _id: "invoice", type: "cutting_invoice", name: "cutting.pdf", content_type: "application/pdf" }, { _id: "permit", type: "permission", name: "permit.PNG" }] },
    { _id: "truck1", kind: "transport", documents: [{ _id: "bilty", type: "billty", name: "receipt.jpg" }] },
    { _id: "receiver1", kind: "receiver", documents: [{ _id: "receiver", type: "invoice", name: "received.pdf" }] },
    { _id: "truck2", kind: "transport", documents: [{ _id: "weight", type: "weight_slip", name: "weight.xlsx" }] },
    { _id: "declaration", kind: "declaration", documents: [] },
  ],
  history: [{ detail: { replaced: { _id: "old", name: "superseded.pdf" }, stages: [{ documents: [{ _id: "older", name: "old.pdf" }] }] } }],
});

test("one shared document adapter includes only active attachments, in saved chain order", () => {
  const chain = fixture();
  const before = JSON.stringify(chain);
  const documents = normalizeChainDocuments(chain);
  assert.equal(documents.length, 5);
  assert.deepEqual(documents.map((document) => document.documentId), ["invoice", "permit", "bilty", "receiver", "weight"]);
  assert.equal(documents[0].verificationStatus, "Stage verified");
  assert.equal(documents[1].previewKind, "image");
  assert.equal(documents[4].previewKind, "office");
  assert.equal(JSON.stringify(chain), before);
});

test("filters and search preserve order across repeated transport legs", () => {
  const documents = normalizeChainDocuments(fixture());
  assert.deepEqual(filterChainDocuments(documents, "transport", "").map((document) => document.documentId), ["bilty", "weight"]);
  assert.equal(filterChainDocuments(documents, "", "RECEIVED.PDF")[0].stageKind, "receiver");
  assert.equal(filterChainDocuments(documents, "", "sawmill sale invoice")[0].documentId, "invoice");
  assert.equal(filterChainDocuments(documents, "", "sawmill").length, 2);
  assert.equal(filterChainDocuments(documents, "transport", "sawmill").length, 0);
});

test("linked receivers show receipt only for final vendor and sale fields for intermediaries", () => {
  const chain = fixture(); chain.vendor = { gst: "GST-V", pan: "PAN-V" };
  const stage = { _id: "receiver", kind: "receiver", workflow_version: 2, incoming_invoice_stage_id: "mill", fields: { name: "Vendor", gst: "gst v", pan: "pan-v" }, documents: [] };
  chain.stages.push(stage);
  assert.equal(receiverMatchesVendor(stage.fields, chain.vendor), true);
  assert.deepEqual(stageFields(stage, chain).map(([name]) => name), ["name", "gst", "pan", "received_cft"]);
  assert.deepEqual(stageDocuments(stage, chain), []);
  assert.equal(incomingInvoice(chain, stage).document._id, "invoice");
  assert.equal(normalizeChainDocuments(chain).length, 5);
  stage.fields.pan = "OTHER";
  assert.ok(stageFields(stage, chain).some(([name]) => name === "sold_cft"));
  assert.deepEqual(missingStageDocuments(stage, chain).map(([name]) => name), ["invoice", "buyer_gst", "buyer_pan"]);
});

test("common Office documents preview as PDFs while legacy attachments remain counted once", () => {
  const chain = { stages: [{ _id: "s", kind: "sawmill", documents: ["doc", "docx", "xls", "xlsx", "csv", "txt", "pdf", "PNG", "JPEG", "webp", "exe"].map((ext) => ({ _id: ext, type: "license", name: `test.${ext}` })) }] };
  assert.deepEqual(normalizeChainDocuments(chain).map((doc) => doc.previewKind), ["office", "office", "office", "office", "office", "office", "pdf", "image", "image", "image", "other"]);
  assert.deepEqual(missingStageDocuments({ kind: "sawmill", documents: ["cutting_invoice", "license", "permission"].map((type) => ({ type })) }).map(([type]) => type), ["forest_image"]);
});

test("forest fields and image belong only to the first step and use the existing image gallery", () => {
  const stage = { _id: "mill", kind: "sawmill", workflow_version: 2, fields: {}, documents: [{ _id: "forest", type: "forest_image", name: "forest.png", content_type: "image/png" }] };
  const chain = { vendor: { gst: "V", pan: "V" }, stages: [stage] };
  assert.deepEqual(stageFields(stage, chain).filter(([, , type]) => type === "coordinate").map(([field]) => field), ["forest_latitude", "forest_longitude"]);
  const receiver = { kind: "receiver", incoming_invoice_stage_id: "mill", fields: { gst: "OTHER", pan: "OTHER" } };
  assert.ok(!stageFields(receiver, chain).some(([field]) => field.startsWith("forest_")));
  assert.ok(stageFields(receiver, chain).some(([field]) => field === "sold_cft"));
  const document = normalizeChainDocuments(chain)[0]; assert.equal(document.previewKind, "image"); assert.equal(document.displayName, "Forest image (required)");
  assert.ok(!missingStageDocuments(stage, chain).some(([type]) => type === "forest_image"));
});

test("empty chains and one-file stages never invent document records", () => {
  assert.deepEqual(normalizeChainDocuments({ stages: [] }), []);
  assert.deepEqual(normalizeChainDocuments({ stages: [{ _id: "mill", kind: "sawmill", documents: [] }] }), []);
  assert.equal(normalizeChainDocuments({ stages: [fixture().stages[1]] }).length, 1);
});

test("missing evidence is separate from uploaded documents and truck registration remains conditional", () => {
  const stage = { kind: "transport", fields: {}, documents: ["weight_slip", "billty", "driver_license", "ewaybill"].map((type) => ({ type })) };
  assert.equal(missingStageDocuments(stage).length, 0);
  stage.fields.truck_registration_number = "REG1";
  assert.deepEqual(missingStageDocuments(stage).map(([type]) => type), ["truck_registration"]);
  assert.equal(formatCft(null), "Unavailable");
  assert.equal(formatCft(0), "0.000");
});
