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
