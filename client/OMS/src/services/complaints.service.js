import api from "../api/axios";

export const getComplaints = (params = {}) =>
  api.get("/complaints", { params });

export const createComplaint = (formData) =>
  api.post("/complaints", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

export const getComplaint = (id) =>
  api.get(`/complaints/${encodeURIComponent(id)}`);

export const addComplaintComment = (id, payload = {}) =>
  api.post(`/complaints/${encodeURIComponent(id)}/comments`, payload);

export const updateComplaintStatus = (id, payload = {}) =>
  api.patch(`/complaints/${encodeURIComponent(id)}/status`, payload);

export const uploadComplaintFiles = (id, formData) =>
  api.post(`/complaints/${encodeURIComponent(id)}/files`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

export const archiveComplaint = (id, archivedReason = "") =>
  api.patch(`/complaints/${encodeURIComponent(id)}/archive`, {
    archived_reason: archivedReason,
  });

export const unarchiveComplaint = (id) =>
  api.patch(`/complaints/${encodeURIComponent(id)}/unarchive`);
