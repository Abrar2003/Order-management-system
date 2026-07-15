import axios from "../api/axios";
import { getOptionText } from "../utils/optionText";

export const uploadOrders = async (file) => {

  const formData = new FormData();
  formData.append("file", file);

  const res = await axios.post("/orders/upload-orders", formData, {
  });

  return res.data;
};

export const previewUploadOrders = async (file) => {

  const formData = new FormData();
  formData.append("file", file);
  formData.append("preview_only", "true");

  const res = await axios.post("/orders/upload-orders", formData, {
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
  const res = await axios.post(
    "/orders/upload-orders",
    {
      selected_rows: selectedRows,
      source_filename: String(sourceFileName || "").trim(),
    },
    {
    },
  );

  return res.data;
};

export const getManualOrderOptions = async () => {
  const res = await axios.get("/orders/manual-options");
  return res.data;
};

export const createManualOrders = async ({ po = {}, items = [] } = {}) => {
  const res = await axios.post("/orders/manual-orders", { po, items });

  return res.data;
};

export const checkPreviousOrder = async ({
  orderId = "",
  itemCode = "",
} = {}) => {
  const normalizedOrderId = String(orderId || "").trim();
  const normalizedItemCode = String(itemCode || "").trim();

  if (!normalizedOrderId) {
    throw new Error("Previous PO is required");
  }

  if (!normalizedItemCode) {
    throw new Error("Item code is required");
  }
  const res = await axios.get("/orders/previous-order-check", {
    params: {
      order_id: normalizedOrderId,
      item_code: normalizedItemCode,
    },
  });

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
  const normalizedVendor = getOptionText(vendor);

  if (!normalizedBrand) {
    throw new Error("Brand is required");
  }
  if (!normalizedVendor) {
    throw new Error("Vendor is required");
  }
  const formData = new FormData();
  formData.append("file", file);
  formData.append("brand", normalizedBrand);
  formData.append("vendor", normalizedVendor);
  formData.append("apply_changes", applyChanges ? "true" : "false");

  const res = await axios.post("/orders/rectify-pdf", formData, {
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
  const res = await axios.post(
    "/orders/rectify-pdf",
    {
      brand: String(brand || "").trim(),
      vendor: getOptionText(vendor),
      apply_changes: true,
      selected_rows: selectedRows,
      source_filename: String(sourceFileName || "").trim(),
    },
    {
    },
  );

  return res.data;
};

export const getUploadLogs = async (params = {}) => {
  const res = await axios.get("/orders/upload-logs", {
    params,
  });

  return res.data;
};

export const getOrderEditLogs = async (params = {}) => {
  const res = await axios.get("/orders/edit-logs", {
    params,
  });

  return res.data;
};

export const exportOrders = async (params = {}, format = "xlsx") => {
  return axios.get("/orders/export", {
    responseType: "blob",
    params: {
      ...params,
      format: String(format || "").trim().toLowerCase() === "csv" ? "csv" : "xlsx",
    },
  });
};

export const getDelayedPoReport = async (params = {}) => {
  const res = await axios.get("/orders/delayed-po-report", {
    params,
  });

  return res.data;
};

export const getPoStatusReport = async (params = {}) => {
  const res = await axios.get("/orders/po-status-report", {
    params,
  });

  return res.data;
};

export const getPendingPoReport = async (params = {}) => {
  const res = await axios.get("/orders/pending-po-report", {
    params,
  });

  return res.data;
};

export const getUpcomingEtdReport = async (params = {}) => {
  const res = await axios.get("/orders/upcoming-etd-report", {
    params,
  });

  return res.data;
};

export const exportDelayedPoReport = async (params = {}) => {
  return axios.get("/orders/delayed-po-report/export", {
    responseType: "blob",
    params,
  });
};

export const exportPendingPoReport = async (params = {}) => {
  return axios.get("/orders/pending-po-report/export", {
    responseType: "blob",
    params,
  });
};

export const exportUpcomingEtdReport = async (params = {}) => {
  return axios.get("/orders/upcoming-etd-report/export", {
    responseType: "blob",
    params,
  });
};

export const editOrder = async (id, payload) => {
  if (!id) {
    throw new Error("Order id is required");
  }
  const res = await axios.patch(`/orders/edit-order/${id}`, payload, {
  });

  return res.data;
};

export const bulkUpdateRevisedEtd = async ({
  orderIds = [],
  revised_ETD = "",
} = {}) => {
  const normalizedOrderIds = Array.isArray(orderIds)
    ? orderIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (normalizedOrderIds.length === 0) {
    throw new Error("At least one order id is required");
  }
  const res = await axios.patch(
    "/orders/bulk-revised-etd",
    {
      order_ids: normalizedOrderIds,
      revised_ETD: String(revised_ETD || "").trim(),
    },
    {
    },
  );

  return res.data;
};

export const getOrderRevisedEtdHistory = async ({
  orderId,
  itemCode = "",
} = {}) => {
  const normalizedOrderId = String(orderId || "").trim();
  if (!normalizedOrderId) {
    throw new Error("Order id is required");
  }
  const res = await axios.get("/orders/revised-etd-history", {
    params: {
      order_id: normalizedOrderId,
      item_code: String(itemCode || "").trim(),
    },
  });

  return res.data;
};

export const editCompleteOrder = async (id, payload) => {
  if (!id) {
    throw new Error("Order id is required");
  }
  const res = await axios.patch(`/orders/edit-complete-order/${id}`, payload, {
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
  const res = await axios.patch(
    `/orders/archive-order/${id}`,
    { remark: normalizedRemark },
    {
    },
  );

  return res.data;
};

export const unarchiveOrder = async (id) => {
  if (!id) {
    throw new Error("Order id is required");
  }
  const res = await axios.patch(
    `/orders/unarchive-order/${id}`,
    {},
    {
    },
  );

  return res.data;
};

export const getArchivedOrders = async (params = {}) => {
  const res = await axios.get("/orders/archived", {
    params,
  });

  return res.data;
};

export const syncZeroQuantityOrdersArchive = async (remark = "") => {
  const payload = {};
  const normalizedRemark = String(remark || "").trim();
  if (normalizedRemark) {
    payload.remark = normalizedRemark;
  }

  const res = await axios.post("/orders/sync-zero-quantity-archive", payload, {
  });

  return res.data;
};
