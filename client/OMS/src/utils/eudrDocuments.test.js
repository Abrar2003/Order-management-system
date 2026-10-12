import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChainDocuments, filterChainDocuments, missingStageDocuments, formatCft } from "./eudrDocuments.js";

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
  assert.equal(documents[4].previewKind, "other");
  assert.equal(JSON.stringify(chain), before);
});

test("filters and search preserve order across repeated transport legs", () => {
  const documents = normalizeChainDocuments(fixture());
  assert.deepEqual(filterChainDocuments(documents, "transport", "").map((document) => document.documentId), ["bilty", "weight"]);
  assert.equal(filterChainDocuments(documents, "", "RECEIVED.PDF")[0].stageKind, "receiver");
  assert.equal(filterChainDocuments(documents, "", "cutting invoice")[0].documentId, "invoice");
  assert.equal(filterChainDocuments(documents, "", "sawmill").length, 2);
  assert.equal(filterChainDocuments(documents, "transport", "sawmill").length, 0);
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
