import api from "../api/axios";

export const scanQcBarcodeFile = async (file) => {
  if (!file) {
    throw new Error("Barcode file is required");
  }

  const formData = new FormData();
  formData.append("file", file);

  const res = await api.post("/qc/scan-barcode", formData);
  return res.data;
};
