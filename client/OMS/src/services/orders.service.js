import axios from "../api/axios";

export const uploadOrders = async (file) => {
  const token = localStorage.getItem("token");

  const formData = new FormData();
  formData.append("file", file);

  const res = await axios.post("/orders/upload-orders", formData, {
    headers: {
      Authorization: `Bearer ${token}`
    },
  });

  return res.data;
};

export const previewUploadOrders = async (file) => {
  const token = localStorage.getItem("token");

  const formData = new FormData();
  formData.append("file", file);
  formData.append("preview_only", "true");

  const res = await axios.post("/orders/upload-orders", formData, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return res.data;
};

export const applyUploadedRows = async ({
  rows = [],
  sourceFileName = "",
} = {}) => {
  const selectedRows = Array.isArray(rows) ? rows : [];
  if (selectedRows.length === 0) {
    throw new Error("At least one row is required");
  }

  const token = localStorage.getItem("token");
  const res = await axios.post(
    "/orders/upload-orders",
    {
      selected_rows: selectedRows,
      source_filename: String(sourceFileName || "").trim(),
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return res.data;
};

export const createManualOrders = async (orders = []) => {
  const token = localStorage.getItem("token");

  const res = await axios.post(
    "/orders/manual-orders",
    { orders },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return res.data;
};

export const rectifyPdfOrders = async ({
  file,
  brand,
  vendor,
  applyChanges = true,
} = {}) => {
  if (!file) {
    throw new Error("PDF file is required");
  }

  const normalizedBrand = String(brand || "").trim();
  const normalizedVendor = String(vendor || "").trim();

  if (!normalizedBrand) {
    throw new Error("Brand is required");
  }
  if (!normalizedVendor) {
    throw new Error("Vendor is required");
  }

  const token = localStorage.getItem("token");
  const formData = new FormData();
  formData.append("file", file);
  formData.append("brand", normalizedBrand);
  formData.append("vendor", normalizedVendor);
  formData.append("apply_changes", applyChanges ? "true" : "false");

  const res = await axios.post("/orders/rectify-pdf", formData, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return res.data;
};

export const applyRectifiedRows = async ({
  rows = [],
  brand,
  vendor,
  sourceFileName = "",
} = {}) => {
  const selectedRows = Array.isArray(rows) ? rows : [];
  if (selectedRows.length === 0) {
    throw new Error("At least one row is required");
  }

  const token = localStorage.getItem("token");
  const res = await axios.post(
    "/orders/rectify-pdf",
    {
      brand: String(brand || "").trim(),
      vendor: String(vendor || "").trim(),
      apply_changes: true,
      selected_rows: selectedRows,
      source_filename: String(sourceFileName || "").trim(),
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return res.data;
};

export const getUploadLogs = async (params = {}) => {
  const token = localStorage.getItem("token");
  const res = await axios.get("/orders/upload-logs", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    params,
  });

  return res.data;
};

export const getOrderEditLogs = async (params = {}) => {
  const token = localStorage.getItem("token");
  const res = await axios.get("/orders/edit-logs", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    params,
  });

  return res.data;
};

export const exportOrders = async (params = {}, format = "xlsx") => {
  const token = localStorage.getItem("token");
  return axios.get("/orders/export", {
    responseType: "blob",
    params: {
      ...params,
      format: String(format || "").trim().toLowerCase() === "csv" ? "csv" : "xlsx",
    },
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
};

export const editOrder = async (id, payload) => {
  if (!id) {
    throw new Error("Order id is required");
  }

  const token = localStorage.getItem("token");
  const res = await axios.patch(`/orders/edit-order/${id}`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return res.data;
};

export const editCompleteOrder = async (id, payload) => {
  if (!id) {
    throw new Error("Order id is required");
  }

  const token = localStorage.getItem("token");
  const res = await axios.patch(`/orders/edit-complete-order/${id}`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return res.data;
};

export const archiveOrder = async (id, remark) => {
  if (!id) {
    throw new Error("Order id is required");
  }

  const normalizedRemark = String(remark || "").trim();
  if (!normalizedRemark) {
    throw new Error("Archive remark is required");
  }

  const token = localStorage.getItem("token");
  const res = await axios.patch(
    `/orders/archive-order/${id}`,
    { remark: normalizedRemark },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return res.data;
};

export const getArchivedOrders = async (params = {}) => {
  const token = localStorage.getItem("token");
  const res = await axios.get("/orders/archived", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    params,
  });

  return res.data;
};

export const syncZeroQuantityOrdersArchive = async (remark = "") => {
  const token = localStorage.getItem("token");
  const payload = {};
  const normalizedRemark = String(remark || "").trim();
  if (normalizedRemark) {
    payload.remark = normalizedRemark;
  }

  const res = await axios.post("/orders/sync-zero-quantity-archive", payload, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return res.data;
};
