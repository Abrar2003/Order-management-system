const Party = require("../models/eudrParty.model");
const crypto = require("node:crypto");
const { normalizeIdentifier } = require("../helpers/timberCft");

const pick = (fields, keys) => Object.fromEntries(keys.map((key) => [key, String(fields?.[key] || "").trim()]));
const textKey = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const identityKey = (fields) => fields.gst ? normalizeIdentifier(fields.gst) : textKey(fields.transporter_name);
const reusableTypes = { sawmill: ["license", "permission"], transporter: [], vehicle: ["truck_registration", "driver_license"], buyer: [] };
const snapshots = (stage) => {
  const f = stage.fields || {};
  const buyers = ["sawmill", "receiver"].includes(stage.kind) && f.buyer_type !== "vendor" && f.sold_to && normalizeIdentifier(f.buyer_gst) && normalizeIdentifier(f.buyer_pan) ? [{ kind: "buyer", name: f.sold_to, identity_key: `${normalizeIdentifier(f.buyer_gst)}|${normalizeIdentifier(f.buyer_pan)}`, fields: pick(f, ["sold_to", "buyer_gst", "buyer_pan"]) }] : [];
  if (stage.kind === "sawmill" && f.name && f.gst && f.pan) return [{ kind: "sawmill", name: f.name, identity_key: `${normalizeIdentifier(f.gst)}|${normalizeIdentifier(f.pan)}`, fields: pick(f, ["name", "gst", "pan", "permission_number", "cutting_limit_cft"]) }, ...buyers];
  if (stage.kind !== "transport" || !f.transporter_name) return buyers;
  const parent = identityKey(f);
  return [
    { kind: "transporter", name: f.transporter_name, identity_key: parent, fields: pick(f, ["transporter_name", "gst"]) },
    ...(f.truck_number && f.driver_license_number ? [{ kind: "vehicle", name: `${f.truck_number} / ${f.driver_license_number}`, parent_key: parent, identity_key: `${parent}|${normalizeIdentifier(f.truck_number)}|${normalizeIdentifier(f.driver_license_number)}`, fields: pick(f, ["truck_number", "truck_registration_number", "driver_license_number"]) }] : []),
  ];
};
const saveStageDirectory = async (stage) => {
  for (const snapshot of snapshots(stage)) {
    const evidence = (stage.documents || []).filter((document) => reusableTypes[snapshot.kind].includes(document.type)).map((document) => ({ ...pick(document, ["type", "key", "name", "content_type", "sha256"]), size: Number(document.size) || 0, _id: crypto.createHash("sha256").update(`${document.type}|${document.key}`).digest("hex").slice(0, 24) }));
    // Stable evidence IDs survive subsequent saves and reuse; users explicitly confirm which saved version is valid.
    await Party.findOneAndUpdate({ kind: snapshot.kind, identity_key: snapshot.identity_key }, { $set: snapshot, ...(evidence.length ? { $addToSet: { evidence: { $each: evidence } } } : {}) }, { upsert: true, runValidators: true });
  }
};
const evidenceMatches = (party, stage, type) => {
  const f = stage.fields || {};
  if (party.kind === "sawmill") return stage.kind === "sawmill" && normalizeIdentifier(f.gst) === normalizeIdentifier(party.fields.gst) && normalizeIdentifier(f.pan) === normalizeIdentifier(party.fields.pan);
  if (party.kind !== "vehicle" || stage.kind !== "transport") return false;
  return type === "driver_license" ? normalizeIdentifier(f.driver_license_number) === normalizeIdentifier(party.fields.driver_license_number) : normalizeIdentifier(f.truck_number) === normalizeIdentifier(party.fields.truck_number) && normalizeIdentifier(f.truck_registration_number) === normalizeIdentifier(party.fields.truck_registration_number);
};
module.exports = { snapshots, reusableTypes, saveStageDirectory, evidenceMatches };
