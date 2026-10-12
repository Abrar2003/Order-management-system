export const STAGE_LABELS = { sawmill: "Ara / Sawmill", transport: "Transport", receiver: "Receiver", declaration: "Declaration" };
export const STAGE_FIELDS = {
  sawmill: [["name", "Ara / sawmill name"], ["gst", "GST"], ["pan", "PAN"], ["permission_number", "Permission number"], ["forest_latitude", "Forest latitude (required)", "coordinate"], ["forest_longitude", "Forest longitude (required)", "coordinate"], ["cutting_limit_cft", "Cutting limit (CFT, optional)", "number"], ["invoice_number", "Sawmill Sale Invoice number"], ["invoice_date", "Sawmill Sale Invoice date", "date"], ["sold_to", "Sold To"], ["buyer_gst", "Buyer GST"], ["buyer_pan", "Buyer PAN"], ["sold_cft", "Sold CFT", "number"]],
  transport: [["transporter_name", "Transporter name"], ["truck_number", "Truck number"], ["truck_registration_number", "Truck registration number (optional)"], ["driver_license_number", "Driver licence number"], ["ewaybill_number", "E-way bill number"], ["gst", "Transporter GST (optional)"], ["billty_number", "Billty number"]],
  receiver: [["name", "Receiver name"], ["gst", "Receiver GST"], ["pan", "Receiver PAN"], ["received_cft", "Received CFT", "number"], ["invoice_number", "Invoice number"], ["invoice_date", "Invoice date", "date"], ["issuer_name", "Invoice issuer name"], ["issuer_gst", "Invoice issuer GST"], ["issuer_pan", "Invoice issuer PAN"]],
  declaration: [],
};
export const STAGE_DOCUMENTS = {
  sawmill: [["cutting_invoice", "Sawmill Sale Invoice"], ["license", "Sawmill license"], ["permission", "Sawmill permission / permit"], ["forest_image", "Forest image (required)"], ["buyer_gst", "Buyer GST certificate"], ["buyer_pan", "Buyer PAN evidence"]],
  transport: [["weight_slip", "Weight slip"], ["billty", "Bilty / transport receipt"], ["driver_license", "Driver licence"], ["ewaybill", "E-way bill"], ["truck_registration", "Truck registration"]],
  receiver: [["invoice", "Sale invoice"], ["buyer_gst", "Buyer GST certificate"], ["buyer_pan", "Buyer PAN evidence"]],
  declaration: [["declaration", "Declaration"]],
};
export const EUDR_FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt";
const normalizeIdentifier = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const receiverMatchesVendor = (fields, vendor) => Boolean(vendor?.gst && vendor?.pan) && normalizeIdentifier(fields?.gst) === normalizeIdentifier(vendor.gst) && normalizeIdentifier(fields?.pan) === normalizeIdentifier(vendor.pan);
export const stageFields = (stage, chain, editing = false) => {
  if (stage.kind !== "receiver" || (!stage.incoming_invoice_stage_id && !editing)) return STAGE_FIELDS[stage.kind] || [];
  const identity = STAGE_FIELDS.receiver.slice(0, 4);
  return receiverMatchesVendor(stage.fields, chain?.vendor) ? identity : [...identity, ["invoice_number", "Onward Sale Invoice number"], ["invoice_date", "Onward Sale Invoice date", "date"], ...STAGE_FIELDS.sawmill.filter(([name]) => ["sold_to", "buyer_gst", "buyer_pan", "sold_cft"].includes(name))];
};
export const stageDocuments = (stage, chain, editing = false) => {
  const definitions = STAGE_DOCUMENTS[stage.kind] || [];
  if (stage.kind === "receiver" && (stage.incoming_invoice_stage_id || editing)) return receiverMatchesVendor(stage.fields, chain?.vendor) ? [] : definitions;
  return stage.workflow_version >= 2 || editing ? definitions : definitions.filter(([type]) => !["buyer_gst", "buyer_pan"].includes(type));
};
export const incomingInvoice = (chain, stage) => {
  const seller = chain.stages.find((entry) => String(entry._id) === stage.incoming_invoice_stage_id);
  const document = seller?.documents?.find((entry) => entry.type === (seller.kind === "sawmill" ? "cutting_invoice" : "invoice"));
  return seller && { seller, document };
};
export const requestError = (error) => {
  let data = error?.response?.data;
  if (data instanceof ArrayBuffer) { try { data = JSON.parse(new TextDecoder().decode(data)); } catch { /* Binary error responses have no readable message. */ } }
  return data?.message || error?.message || "Request failed";
};
export const formatCft = (value) => value == null ? "Unavailable" : Number(value).toFixed(3);
export const formatDate = (value, time = false) => {
  if (!value) return "—";
  const date = new Date(time ? value : `${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return time ? date.toLocaleString("en-IN") : date.toLocaleDateString("en-IN");
};
export const declaredMilliCft = (value) => {
  if (String(value ?? "").trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && Math.abs(number * 1000 - Math.round(number * 1000)) <= 1e-7 ? Math.round(number * 1000) : null;
};
export const cftMismatchText = (declaredMilli, stuffedMilli) => {
  if (declaredMilli == null || stuffedMilli == null || declaredMilli === stuffedMilli) return "";
  const direction = declaredMilli < stuffedMilli ? "less" : "more";
  return `Declared CFT is ${(Math.abs(declaredMilli - stuffedMilli) / 1000).toFixed(3)} ${direction} than stuffed CFT. Enter exactly ${(stuffedMilli / 1000).toFixed(3)} CFT to continue.`;
};

// Only stage attachments are current; audit snapshots must never enter either gallery.
export const normalizeChainDocuments = (chain) => (chain.stages || []).flatMap((stage, stageIndex) => (stage.documents || []).map((document) => {
  const extension = String(document.name || "").split(".").pop().toLowerCase();
  const mimeType = document.content_type || "";
  return {
    id: `${stage._id}:${document._id}`, documentId: String(document._id), stageId: String(stage._id), stageIndex,
    stageKind: stage.kind, stageName: STAGE_LABELS[stage.kind] || stage.kind, stage,
    documentType: document.type, displayName: STAGE_DOCUMENTS[stage.kind]?.find(([type]) => type === document.type)?.[1] || String(document.type).replace(/_/g, " "),
    originalFilename: document.name, mimeType, format: extension.toUpperCase(), uploadedAt: document.uploaded_at,
    previewKind: mimeType === "application/pdf" || extension === "pdf" ? "pdf" : ["jpg", "jpeg", "png", "webp"].includes(extension) ? "image" : ["doc", "docx", "xls", "xlsx", "csv", "txt"].includes(extension) ? "office" : "other",
    verificationStatus: stage.verified_at ? "Stage verified" : "Stage pending review",
  };
}));

export const filterChainDocuments = (documents, stageKind, search) => {
  const query = String(search || "").trim().toLowerCase();
  return documents.filter((document) => (!stageKind || document.stageKind === stageKind) && (!query || [document.originalFilename, document.displayName, document.documentType, document.stageName].some((value) => String(value).toLowerCase().includes(query))));
};

export const missingStageDocuments = (stage, chain) => stageDocuments(stage, chain).filter(([type]) => (type !== "truck_registration" || stage.fields?.truck_registration_number) && !(stage.documents || []).some((document) => document.type === type));
