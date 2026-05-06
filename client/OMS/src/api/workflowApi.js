import api from "./axios";

const normalizeText = (value) => String(value ?? "").trim();

const requireId = (value, label) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
};

export const createBatchFromFolderManifest = async (payload = {}) => {
  const res = await api.post("/workflow/batches/from-folder-manifest", payload);
  return res.data;
};

export const getWorkflowBatches = async (params = {}) => {
  const res = await api.get("/workflow/batches", { params });
  return res.data;
};

export const getWorkflowDashboard = async (params = {}) => {
  const res = await api.get("/workflow/dashboard", { params });
  return res.data;
};

export const getWorkflowBatchById = async (id) => {
  const res = await api.get(
    `/workflow/batches/${encodeURIComponent(requireId(id, "Batch id"))}`,
  );
  return res.data;
};

export const updateWorkflowBatch = async (id, payload = {}) => {
  const res = await api.patch(
    `/workflow/batches/${encodeURIComponent(requireId(id, "Batch id"))}`,
    payload,
  );
  return res.data;
};

export const cancelWorkflowBatch = async (id, payload = {}) => {
  const res = await api.patch(
    `/workflow/batches/${encodeURIComponent(requireId(id, "Batch id"))}/cancel`,
    payload,
  );
  return res.data;
};

export const deleteWorkflowBatch = async (id, payload = {}) => {
  const res = await api.delete(
    `/workflow/batches/${encodeURIComponent(requireId(id, "Batch id"))}`,
    { data: payload },
  );
  return res.data;
};

export const getWorkflowTasks = async (params = {}) => {
  const res = await api.get("/workflow/tasks", { params });
  return res.data;
};

export const createWorkflowTask = async (payload = {}) => {
  const res = await api.post("/workflow/tasks", payload);
  return res.data;
};

export const getWorkflowTaskById = async (id) => {
  const res = await api.get(
    `/workflow/tasks/${encodeURIComponent(requireId(id, "Task id"))}`,
  );
  return res.data;
};

export const assignWorkflowTask = async (id, payload = {}) => {
  const res = await api.patch(
    `/workflow/tasks/${encodeURIComponent(requireId(id, "Task id"))}/assign`,
    payload,
  );
  return res.data;
};

export const startWorkflowTask = async (id, payload = {}) => {
  const res = await api.patch(
    `/workflow/tasks/${encodeURIComponent(requireId(id, "Task id"))}/start`,
    payload,
  );
  return res.data;
};

export const submitWorkflowTask = async (id, payload = {}) => {
  const res = await api.patch(
    `/workflow/tasks/${encodeURIComponent(requireId(id, "Task id"))}/submit`,
    payload,
  );
  return res.data;
};

export const approveWorkflowTask = async (id, payload = {}) => {
  const res = await api.patch(
    `/workflow/tasks/${encodeURIComponent(requireId(id, "Task id"))}/approve`,
    payload,
  );
  return res.data;
};

export const reviewWorkflowTask = async (id, payload = {}) => {
  const res = await api.patch(
    `/workflow/tasks/${encodeURIComponent(requireId(id, "Task id"))}/review`,
    payload,
  );
  return res.data;
};

export const sendWorkflowTaskToRework = async (id, payload = {}) => {
  const res = await api.patch(
    `/workflow/tasks/${encodeURIComponent(requireId(id, "Task id"))}/rework`,
    payload,
  );
  return res.data;
};

export const updateWorkflowTaskStatus = async (id, payload = {}) => {
  const res = await api.patch(
    `/workflow/tasks/${encodeURIComponent(requireId(id, "Task id"))}/status`,
    payload,
  );
  return res.data;
};

export const addWorkflowTaskComment = async (id, payload = {}) => {
  const res = await api.post(
    `/workflow/tasks/${encodeURIComponent(requireId(id, "Task id"))}/comments`,
    payload,
  );
  return res.data;
};

export const deleteWorkflowTask = async (id, payload = {}) => {
  const res = await api.delete(
    `/workflow/tasks/${encodeURIComponent(requireId(id, "Task id"))}`,
    { data: payload },
  );
  return res.data;
};

export const getWorkflowTaskTypes = async () => {
  const res = await api.get("/workflow/task-types");
  return res.data;
};

export const createWorkflowTaskType = async (payload = {}) => {
  const res = await api.post("/workflow/task-types", payload);
  return res.data;
};

export const updateWorkflowTaskType = async (id, payload = {}) => {
  const res = await api.patch(
    `/workflow/task-types/${encodeURIComponent(requireId(id, "Task type id"))}`,
    payload,
  );
  return res.data;
};

export const getWorkflowDepartments = async () => {
  const res = await api.get("/workflow/departments");
  return res.data;
};

export const createWorkflowDepartment = async (payload = {}) => {
  const res = await api.post("/workflow/departments", payload);
  return res.data;
};

export const updateWorkflowDepartment = async (id, payload = {}) => {
  const res = await api.patch(
    `/workflow/departments/${encodeURIComponent(requireId(id, "Department id"))}`,
    payload,
  );
  return res.data;
};

export const getWorkflowUsers = async (params = {}) => {
  const res = await api.get("/auth", { params });
  return res.data;
};
