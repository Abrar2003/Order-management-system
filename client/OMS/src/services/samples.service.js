import api from "../api/axios";

export const listSamples = (params = {}) => api.get("/samples", { params });

export const createSample = (payload) => api.post("/samples", payload);

export const updateSample = (id, payload) =>
  api.patch(`/samples/${encodeURIComponent(id)}`, payload);

export const uploadSampleImage = (id, formData) =>
  api.post(`/samples/${encodeURIComponent(id)}/files`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

export const convertSampleToItem = (id, payload) =>
  api.post(`/samples/${encodeURIComponent(id)}/convert-to-item`, payload);
