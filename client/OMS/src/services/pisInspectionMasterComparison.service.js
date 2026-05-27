import api from "../api/axios";

export const fetchPisInspectionMasterComparison = async (itemCode) => {
  const code = String(itemCode || "").trim();
  if (!code) {
    throw new Error("Item code is required");
  }

  const response = await api.get(
    `/items/${encodeURIComponent(code)}/pis-inspection-master-comparison`,
  );

  return response?.data || {};
};

export const fetchPisInspectionMasterComparisonRecords = async ({ limit = 10 } = {}) => {
  const response = await api.get("/items/pis-inspection-master-comparison", {
    params: { limit },
  });

  return response?.data || {};
};
