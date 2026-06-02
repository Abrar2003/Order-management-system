import api from "../api/axios";

export const SAMPLE_STATUSES = [
  "created",
  "cad_pending",
  "cad_ready",
  "sent_to_client",
  "client_revision_requested",
  "client_approved",
  "sent_to_vendor",
  "manufacturing",
  "inspection_requested",
  "inspected",
  "shipping_planned",
  "shipped",
  "completed",
  "cancelled",
  "on_hold",
];

export const SAMPLE_WORKFLOW_STEPS = [
  "created",
  "cad_pending",
  "cad_ready",
  "sent_to_client",
  "client_approved",
  "sent_to_vendor",
  "manufacturing",
  "inspection_requested",
  "inspected",
  "shipping_planned",
  "shipped",
  "completed",
];

export const sampleStatusLabel = (value = "") =>
  String(value || "not_set")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const listSamples = (params = {}) => api.get("/samples", { params });

export const createSample = (formData) =>
  api.post("/samples", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

export const getSample = (id) => api.get(`/samples/${encodeURIComponent(id)}`);

export const updateSample = (id, payload) =>
  api.patch(`/samples/${encodeURIComponent(id)}`, payload);

export const updateSampleStatus = (id, payload) =>
  api.patch(`/samples/${encodeURIComponent(id)}/status`, payload);

export const addSampleTimeline = (id, payload) =>
  api.post(`/samples/${encodeURIComponent(id)}/timeline`, payload);

export const uploadSampleFiles = (id, formData) =>
  api.post(`/samples/${encodeURIComponent(id)}/files`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

export const updateSampleVendor = (id, vendorEntryId, formData) =>
  api.patch(
    `/samples/${encodeURIComponent(id)}/vendors/${encodeURIComponent(vendorEntryId || "new")}`,
    formData,
    { headers: { "Content-Type": "multipart/form-data" } },
  );

export const archiveSample = (id, comment = "") =>
  api.patch(`/samples/${encodeURIComponent(id)}/archive`, { comment });

export const unarchiveSample = (id, comment = "") =>
  api.patch(`/samples/${encodeURIComponent(id)}/unarchive`, { comment });
