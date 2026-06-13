import api from "../api/axios";

export const listSamples = (params = {}) => api.get("/samples", { params });

export const createSample = (payload) => api.post("/samples", payload);

export const updateSample = (id, payload) =>
  api.patch(`/samples/${encodeURIComponent(id)}`, payload);
