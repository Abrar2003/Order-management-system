import api from "../api/axios";

export const getComplaints = (params = {}) =>
  api.get("/complaints", { params });

export const getItemRelatedComplaints = (itemCode) =>
  api.get("/complaints/item-related", {
    params: { item_code: itemCode },
  });

export const getComplaintCategories = () =>
  api.get("/complaints/categories");

export const createComplaintCategory = (payload = {}) =>
  api.post("/complaints/categories", payload);

export const createComplaint = (formData) =>
  api.post("/complaints", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

export const updateComplaint = (id, formData) =>
  api.patch(`/complaints/${encodeURIComponent(id)}`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

export const getComplaint = (id) =>
  api.get(`/complaints/${encodeURIComponent(id)}`);

export const addComplaintComment = (id, payload = {}) =>
  api.post(`/complaints/${encodeURIComponent(id)}/comments`, payload);

export const addQcComplaintComment = (id, payload = {}) =>
  api.post(`/complaints/${encodeURIComponent(id)}/qc-comments`, payload);

export const markComplaintRead = (id, payload = {}) =>
  api.patch(`/complaints/${encodeURIComponent(id)}/read`, payload);

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
