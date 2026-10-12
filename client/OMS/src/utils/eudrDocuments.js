export const STAGE_LABELS = { sawmill: "Ara / Sawmill", transport: "Transport", receiver: "Receiver", declaration: "Declaration" };
export const STAGE_FIELDS = {
  sawmill: [["name", "Ara / sawmill name"], ["gst", "GST"], ["pan", "PAN"], ["permission_number", "Permission number"], ["cutting_limit_cft", "Cutting limit (CFT, optional)", "number"], ["invoice_number", "Cutting invoice number"], ["invoice_date", "Cutting invoice date", "date"]],
  transport: [["transporter_name", "Transporter name"], ["truck_number", "Truck number"], ["truck_registration_number", "Truck registration number (optional)"], ["driver_license_number", "Driver licence number"], ["ewaybill_number", "E-way bill number"], ["gst", "Transporter GST (optional)"], ["billty_number", "Billty number"]],
  receiver: [["name", "Receiver name"], ["gst", "Receiver GST"], ["pan", "Receiver PAN"], ["received_cft", "Received CFT", "number"], ["invoice_number", "Invoice number"], ["invoice_date", "Invoice date", "date"], ["issuer_name", "Invoice issuer name"], ["issuer_gst", "Invoice issuer GST"], ["issuer_pan", "Invoice issuer PAN"]],
  declaration: [],
};
export const STAGE_DOCUMENTS = {
  sawmill: [["cutting_invoice", "Cutting invoice"], ["license", "Sawmill license"], ["permission", "Sawmill permission / permit"]],
  transport: [["weight_slip", "Weight slip"], ["billty", "Bilty / transport receipt"], ["driver_license", "Driver licence"], ["ewaybill", "E-way bill"], ["truck_registration", "Truck registration"]],
  receiver: [["invoice", "Receiver invoice"]],
  declaration: [["declaration", "Declaration"]],
};
export const requestError = (error) => error?.response?.data?.message || error?.message || "Request failed";
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
    previewKind: mimeType === "application/pdf" || extension === "pdf" ? "pdf" : mimeType.startsWith("image/") || ["jpg", "jpeg", "png", "webp"].includes(extension) ? "image" : "other",
    verificationStatus: stage.verified_at ? "Stage verified" : "Stage pending review",
  };
}));

export const filterChainDocuments = (documents, stageKind, search) => {
  const query = String(search || "").trim().toLowerCase();
  return documents.filter((document) => (!stageKind || document.stageKind === stageKind) && (!query || [document.originalFilename, document.displayName, document.documentType, document.stageName].some((value) => String(value).toLowerCase().includes(query))));
};

export const missingStageDocuments = (stage) => (STAGE_DOCUMENTS[stage.kind] || []).filter(([type]) => (type !== "truck_registration" || stage.fields?.truck_registration_number) && !(stage.documents || []).some((document) => document.type === type));
