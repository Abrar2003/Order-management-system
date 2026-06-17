import api from "../api/axios";

export const listSampleWorkflows = (params = {}) => api.get("/sample-workflows", { params });

export const createSampleWorkflow = (payload) => api.post("/sample-workflows", payload);
