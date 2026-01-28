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
