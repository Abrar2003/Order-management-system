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

const resolveCbmTotal = (top, bottom, fallbackTotal) => {
  const topValue = Math.max(0, toSafeNumber(top, 0));
  const bottomValue = Math.max(0, toSafeNumber(bottom, 0));
  if (topValue > 0 && bottomValue > 0) {
    return toDecimalString(topValue + bottomValue, 6);
  }
  return normalizeCbmText(fallbackTotal);
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
  const currentBrand = normalizeText(item?.brand || "");
  const currentBrandName = normalizeText(item?.brand_name || "");
  const brandFallback = normalizeText(
    Array.isArray(item?.brands) && item.brands.length > 0
      ? item.brands[item.brands.length - 1]
      : "",
  );

  const resolvedPrimaryBrand = normalizeText(
    normalizedPreferredBrand || currentBrand || currentBrandName || brandFallback,
  );

  if (resolvedPrimaryBrand) {
    if (currentBrand !== resolvedPrimaryBrand) {
      item.brand = resolvedPrimaryBrand;
      changed = true;
    }
    if (currentBrandName !== resolvedPrimaryBrand) {
      item.brand_name = resolvedPrimaryBrand;
      changed = true;
    }

    const currentBrands = Array.isArray(item?.brands) ? item.brands : [];
    if (!currentBrands.includes(resolvedPrimaryBrand)) {
      item.brands = normalizeUniqueList([...currentBrands, resolvedPrimaryBrand]);
      changed = true;
    }
  } else {
    if (currentBrand && !currentBrandName) {
      item.brand_name = currentBrand;
      changed = true;
    } else if (!currentBrand && currentBrandName) {
      item.brand = currentBrandName;
      changed = true;
    }
  }

  const nextCalculatedInspectedTotal = calculateCbmFromBoxSize(
    item?.inspected_box_LBH || item?.box_LBH,
  );
  const nextCalculatedPisTotal = calculateCbmFromBoxSize(
    item?.pis_box_LBH || item?.box_LBH,
  );
  const currentCalculatedInspectedTotal = normalizeCbmText(
    item?.cbm?.calculated_inspected_total ?? item?.cbm?.calculated_total ?? "0",
  );
  const currentCalculatedPisTotal = normalizeCbmText(
    item?.cbm?.calculated_pis_total ?? "0",
  );
  const currentCalculatedTotal = normalizeCbmText(item?.cbm?.calculated_total ?? "0");
  const hasCalculatedInspectedTotal = hasOwn(item?.cbm || {}, "calculated_inspected_total");
  const hasCalculatedPisTotal = hasOwn(item?.cbm || {}, "calculated_pis_total");
  const hasCalculatedTotal = hasOwn(item?.cbm || {}, "calculated_total");
  if (
    !hasCalculatedInspectedTotal
    || currentCalculatedInspectedTotal !== nextCalculatedInspectedTotal
    || !hasCalculatedPisTotal
    || currentCalculatedPisTotal !== nextCalculatedPisTotal
    || !hasCalculatedTotal
    || currentCalculatedTotal !== nextCalculatedInspectedTotal
  ) {
    item.cbm = {
      ...(item.cbm || {}),
      calculated_inspected_total: nextCalculatedInspectedTotal,
      calculated_pis_total: nextCalculatedPisTotal,
      calculated_total: nextCalculatedInspectedTotal,
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
  const nextTotal = resolveCbmTotal(
    nextTop,
    nextBottom,
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

const syncQCCbmTotalsFromTopBottom = async () => {
  const qcs = await QC.find({
    cbm: { $exists: true, $ne: null },
  })
    .select("_id cbm")
    .lean();

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  const bulkOps = [];

  for (const qcRow of qcs) {
    processed += 1;

    const top = Math.max(0, toSafeNumber(qcRow?.cbm?.top, 0));
    const bottom = Math.max(0, toSafeNumber(qcRow?.cbm?.bottom, 0));
    const hasTopAndBottom = top > 0 && bottom > 0;
    if (!hasTopAndBottom) {
      skipped += 1;
      continue;
    }

    const nextTop = toDecimalString(top, 6);
    const nextBottom = toDecimalString(bottom, 6);
    const nextTotal = toDecimalString(top + bottom, 6);

    const currentTop = normalizeCbmText(qcRow?.cbm?.top ?? "0");
    const currentBottom = normalizeCbmText(qcRow?.cbm?.bottom ?? "0");
    const currentTotal = normalizeCbmText(qcRow?.cbm?.total ?? "0");

    if (
      currentTop === nextTop
      && currentBottom === nextBottom
      && currentTotal === nextTotal
    ) {
      skipped += 1;
      continue;
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: qcRow._id },
        update: {
          $set: {
            "cbm.top": nextTop,
            "cbm.bottom": nextBottom,
            "cbm.total": nextTotal,
          },
        },
      },
    });
    updated += 1;
  }

  if (bulkOps.length > 0) {
    await QC.bulkWrite(bulkOps, { ordered: false });
  }

  return {
    processed,
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
  const qcCbmSync = await syncQCCbmTotalsFromTopBottom();
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
    qc_cbm_sync: qcCbmSync,
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
  syncQCCbmTotalsFromTopBottom,
  syncAllItemsFromOrdersAndQc,
};
