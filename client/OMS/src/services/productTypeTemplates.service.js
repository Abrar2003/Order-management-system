import api from "../api/axios";

const normalizeText = (value) => String(value ?? "").trim();

export const getProductTypeTemplates = async (params = {}) => {
  const res = await api.get("/product-type-templates", {
    params,
  });
  return res.data;
};

export const getProductTypeTemplateByKey = async (key, params = {}) => {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) {
    throw new Error("Product type template key is required");
  }

  const res = await api.get(`/product-type-templates/${encodeURIComponent(normalizedKey)}`, {
    params,
  });
  return res.data;
};

export const createProductTypeTemplate = async (payload = {}) => {
  const res = await api.post("/product-type-templates", payload);
  return res.data;
};

export const updateProductTypeTemplate = async (id, payload = {}) => {
  const normalizedId = normalizeText(id);
  if (!normalizedId) {
    throw new Error("Template id is required");
  }

  const res = await api.put(`/product-type-templates/${encodeURIComponent(normalizedId)}`, payload);
  return res.data;
};

export const updateProductTypeTemplateStatus = async (id, status) => {
  const normalizedId = normalizeText(id);
  const normalizedStatus = normalizeText(status);

  if (!normalizedId) {
    throw new Error("Template id is required");
  }
  if (!normalizedStatus) {
    throw new Error("Template status is required");
  }

  const res = await api.patch(
    `/product-type-templates/${encodeURIComponent(normalizedId)}/status`,
    { status: normalizedStatus },
  );
  return res.data;
};
