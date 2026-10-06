const normalizeItemBrand = (value) => String(value ?? "").trim();

const getItemBrand = (item = {}) => normalizeItemBrand(
  item?.brand || item?.brand_name || item?.brands?.[0],
);

const applyItemBrand = (item, brand = "") => {
  const value = normalizeItemBrand(brand) || getItemBrand(item);
  item.brand = value;
  item.brand_name = value;
  item.brands = value ? [value] : [];
  return value;
};

module.exports = { applyItemBrand, getItemBrand, normalizeItemBrand };
