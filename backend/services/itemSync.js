const Item = require("../models/item.model");
const Order = require("../models/order.model");
const QC = require("../models/qc.model");

const normalizeText = (value) => String(value ?? "").trim();
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const normalizeCbmText = (value) => normalizeText(value || "0") || "0";

const toDecimalString = (value, precision = 6) => {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const fixed = value.toFixed(precision);
  return fixed.replace(/\.?0+$/, "") || "0";
};

const calculateCbmFromBoxSize = (box = {}) => {
  const length = Math.max(0, toSafeNumber(box?.L, 0));
  const breadth = Math.max(0, toSafeNumber(box?.B, 0));
  const height = Math.max(0, toSafeNumber(box?.H, 0));
  if (length <= 0 || breadth <= 0 || height <= 0) return "0";

  const cubicMeters = (length * breadth * height) / 1000000;
  return toDecimalString(cubicMeters, 6);
};

const normalizeUniqueList = (values = []) =>
  [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeText(value))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

const applyDerivedItemFields = (item, { preferredBrand = "" } = {}) => {
  let changed = false;

  const normalizedPreferredBrand = normalizeText(preferredBrand);
  const currentBrandName = normalizeText(item?.brand_name || "");

  if (normalizedPreferredBrand && currentBrandName !== normalizedPreferredBrand) {
    item.brand_name = normalizedPreferredBrand;
    changed = true;
  } else if (!currentBrandName) {
    const brandFallback = normalizeText(
      Array.isArray(item?.brands) && item.brands.length > 0
        ? item.brands[item.brands.length - 1]
        : "",
    );
    if (brandFallback) {
      item.brand_name = brandFallback;
      changed = true;
    }
  }

  const nextCalculatedTotal = calculateCbmFromBoxSize(item?.box_LBH);
  const currentCalculatedTotal = normalizeCbmText(item?.cbm?.calculated_total ?? "0");
  const hasCalculatedTotal = hasOwn(item?.cbm || {}, "calculated_total");
  if (!hasCalculatedTotal || currentCalculatedTotal !== nextCalculatedTotal) {
    item.cbm = {
      ...(item.cbm || {}),
      calculated_total: nextCalculatedTotal,
    };
    changed = true;
  }

  return changed;
};

const applyOrderSnapshot = (item, orderLike) => {
  let changed = false;

  const description = normalizeText(
    orderLike?.item?.description ?? orderLike?.description ?? "",
  );
  const brand = normalizeText(orderLike?.brand ?? "");
  const vendor = normalizeText(orderLike?.vendor ?? "");

  if (description && item.name !== description) {
    item.name = description;
    changed = true;
  }

  if (description && item.description !== description) {
    item.description = description;
    changed = true;
  }

  const currentBrands = Array.isArray(item.brands) ? item.brands : [];
  if (brand && !currentBrands.includes(brand)) {
    item.brands = normalizeUniqueList([...currentBrands, brand]);
    changed = true;
  }

  const currentVendors = Array.isArray(item.vendors) ? item.vendors : [];
  if (vendor && !currentVendors.includes(vendor)) {
    item.vendors = normalizeUniqueList([...currentVendors, vendor]);
    changed = true;
  }

  if (applyDerivedItemFields(item, { preferredBrand: brand })) {
    changed = true;
  }

  if (!item.source?.from_orders) {
    item.source = item.source || {};
    item.source.from_orders = true;
    changed = true;
  }

  return changed;
};

const applyQcSnapshot = (item, qcLike) => {
  let changed = false;

  const description = normalizeText(qcLike?.item?.description ?? "");
  const brand = normalizeText(qcLike?.order_meta?.brand ?? qcLike?.brand ?? "");
  const vendor = normalizeText(qcLike?.order_meta?.vendor ?? qcLike?.vendor ?? "");

  if (description && item.name !== description) {
    item.name = description;
    changed = true;
  }

  if (description && item.description !== description) {
    item.description = description;
    changed = true;
  }

  const currentBrands = Array.isArray(item.brands) ? item.brands : [];
  if (brand && !currentBrands.includes(brand)) {
    item.brands = normalizeUniqueList([...currentBrands, brand]);
    changed = true;
  }

  const currentVendors = Array.isArray(item.vendors) ? item.vendors : [];
  if (vendor && !currentVendors.includes(vendor)) {
    item.vendors = normalizeUniqueList([...currentVendors, vendor]);
    changed = true;
  }

  const currentCbm = item.cbm || {};
  const nextTop = normalizeCbmText(
    qcLike?.cbm?.top ?? currentCbm.inspected_top ?? currentCbm.top ?? "0",
  );
  const nextBottom = normalizeCbmText(
    qcLike?.cbm?.bottom ?? currentCbm.inspected_bottom ?? currentCbm.bottom ?? "0",
  );
  const nextTotal = normalizeCbmText(
    qcLike?.cbm?.total ?? currentCbm.inspected_total ?? currentCbm.total ?? "0",
  );

  if (
    normalizeCbmText(currentCbm.top ?? "0") !== nextTop
    || normalizeCbmText(currentCbm.bottom ?? "0") !== nextBottom
    || normalizeCbmText(currentCbm.total ?? "0") !== nextTotal
    || normalizeCbmText(currentCbm.inspected_top ?? "0") !== nextTop
    || normalizeCbmText(currentCbm.inspected_bottom ?? "0") !== nextBottom
    || normalizeCbmText(currentCbm.inspected_total ?? "0") !== nextTotal
  ) {
    item.cbm = {
      ...currentCbm,
      top: nextTop,
      bottom: nextBottom,
      total: nextTotal,
      inspected_top: nextTop,
      inspected_bottom: nextBottom,
      inspected_total: nextTotal,
    };
    changed = true;
  }

  if (applyDerivedItemFields(item, { preferredBrand: brand })) {
    changed = true;
  }

  const packedSize = Boolean(qcLike?.packed_size);
  const finishing = Boolean(qcLike?.finishing);
  const branding = Boolean(qcLike?.branding);
  const barcode = Math.max(0, toSafeNumber(qcLike?.barcode, 0));
  const lastInspectedDate = normalizeText(qcLike?.last_inspected_date ?? "");
  const checked = Math.max(0, toSafeNumber(qcLike?.quantities?.qc_checked, 0));
  const passed = Math.max(0, toSafeNumber(qcLike?.quantities?.qc_passed, 0));
  const pending = Math.max(0, toSafeNumber(qcLike?.quantities?.pending, 0));

  const qcSnapshot = item.qc || {};
  const qtySnapshot = qcSnapshot.quantities || {};
  if (
    qcSnapshot.packed_size !== packedSize
    || qcSnapshot.finishing !== finishing
    || qcSnapshot.branding !== branding
    || Number(qcSnapshot.barcode || 0) !== barcode
    || String(qcSnapshot.last_inspected_date || "") !== lastInspectedDate
    || Number(qtySnapshot.checked || 0) !== checked
    || Number(qtySnapshot.passed || 0) !== passed
    || Number(qtySnapshot.pending || 0) !== pending
  ) {
    item.qc = {
      packed_size: packedSize,
      finishing,
      branding,
      barcode,
      last_inspected_date: lastInspectedDate,
      quantities: {
        checked,
        passed,
        pending,
      },
    };
    changed = true;
  }

  if (!item.source?.from_qc) {
    item.source = item.source || {};
    item.source.from_qc = true;
    changed = true;
  }

  return changed;
};

const upsertItemByCode = async (code, applyFn) => {
  const normalizedCode = normalizeText(code);
  if (!normalizedCode) {
    return { created: 0, updated: 0, skipped: 1 };
  }

  let item = await Item.findOne({ code: normalizedCode });
  const isNew = !item;
  if (!item) {
    item = new Item({ code: normalizedCode });
  }

  const changed = applyFn(item);
  if (isNew || changed) {
    await item.save();
    return {
      created: isNew ? 1 : 0,
      updated: isNew ? 0 : 1,
      skipped: 0,
    };
  }

  return { created: 0, updated: 0, skipped: 1 };
};

const upsertItemFromOrder = async (orderLike) => {
  const code = normalizeText(orderLike?.item?.item_code ?? orderLike?.item_code ?? "");
  return upsertItemByCode(code, (item) => applyOrderSnapshot(item, orderLike));
};

const upsertItemsFromOrders = async (orders = []) => {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const order of Array.isArray(orders) ? orders : []) {
    const result = await upsertItemFromOrder(order);
    created += result.created;
    updated += result.updated;
    skipped += result.skipped;
  }

  return {
    processed: (Array.isArray(orders) ? orders : []).length,
    created,
    updated,
    skipped,
  };
};

const upsertItemFromQc = async (qcLike) => {
  const code = normalizeText(qcLike?.item?.item_code ?? "");
  return upsertItemByCode(code, (item) => applyQcSnapshot(item, qcLike));
};

const upsertItemsFromQcs = async (qcs = []) => {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const qc of Array.isArray(qcs) ? qcs : []) {
    const result = await upsertItemFromQc(qc);
    created += result.created;
    updated += result.updated;
    skipped += result.skipped;
  }

  return {
    processed: (Array.isArray(qcs) ? qcs : []).length,
    created,
    updated,
    skipped,
  };
};

const syncDerivedFieldsForExistingItems = async () => {
  let processed = 0;
  let updated = 0;
  let skipped = 0;

  const cursor = Item.find({}).cursor();

  for await (const item of cursor) {
    processed += 1;
    const changed = applyDerivedItemFields(item);
    if (changed) {
      await item.save();
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    processed,
    updated,
    skipped,
  };
};

const syncAllItemsFromOrdersAndQc = async () => {
  const [orders, qcs] = await Promise.all([
    Order.find({ "item.item_code": { $exists: true, $ne: "" } })
      .select("item brand vendor")
      .lean(),
    QC.find({ "item.item_code": { $exists: true, $ne: "" } })
      .select(
        "item order_meta cbm packed_size finishing branding barcode last_inspected_date quantities",
      )
      .lean(),
  ]);

  const orderSync = await upsertItemsFromOrders(orders);
  const qcSync = await upsertItemsFromQcs(qcs);
  const derivedSync = await syncDerivedFieldsForExistingItems();

  const totalItems = await Item.countDocuments();

  return {
    total_items: totalItems,
    order_sync: orderSync,
    qc_sync: qcSync,
    derived_sync: derivedSync,
  };
};

module.exports = {
  upsertItemFromOrder,
  upsertItemsFromOrders,
  upsertItemFromQc,
  upsertItemsFromQcs,
  syncAllItemsFromOrdersAndQc,
};
