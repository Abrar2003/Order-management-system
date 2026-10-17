const { getVendorName } = require("../helpers/vendorRef");
const { toDateOnlyIso } = require("../helpers/dateOnly");
const { toRoundedCbmValue } = require("./shipmentCbmAllocation.service");

const text = (value) => String(value ?? "").trim();
const key = (value) => text(value).toLowerCase();
const quantity = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const poKey = (row) => JSON.stringify([key(row.order_id), key(row.brand), key(getVendorName(row.vendor))]);
const unique = (values) => [...new Map(values.filter(Boolean).map((value) => [key(value), value])).values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const buildDailyShipmentReport = ({ rows = [], orders = [], query = {} } = {}) => {
  const completePos = new Map();
  for (const order of orders) {
    const shipped = (order.shipment || []).reduce((sum, entry) => sum + quantity(entry.quantity), 0);
    const complete = quantity(order.quantity) > 0 && shipped >= quantity(order.quantity);
    const id = poKey(order);
    completePos.set(id, (completePos.get(id) ?? true) && complete);
  }

  const containers = new Map();
  for (const row of rows) {
    const container = text(row.container);
    if (!container || row.line_type === "sample" || !row.shipment_id) continue;
    const id = key(container);
    if (!containers.has(id)) containers.set(id, { id, container, rows: [], items: new Map(), stuffed_cbm: 0 });
    const group = containers.get(id);
    group.rows.push(row);
    group.stuffed_cbm += quantity(row.shipment_cbm);
    const itemId = `${poKey(row)}:${row._id}`;
    if (!group.items.has(itemId)) {
      const shipped = (row.shipment || []).reduce((sum, entry) => sum + quantity(entry.quantity), 0);
      group.items.set(itemId, {
        id: itemId,
        po_key: poKey(row),
        order_id: row.order_id,
        item_code: row.item_code,
        order_quantity: quantity(row.order_quantity),
        stuffed_quantity: 0,
        remaining_quantity: Math.max(0, quantity(row.order_quantity) - shipped),
      });
    }
    group.items.get(itemId).stuffed_quantity += quantity(row.quantity);
  }

  const allRows = [...containers.values()].map((group) => {
    const dates = (field) => unique(group.rows.map((row) => toDateOnlyIso(row[field])));
    const summaries = new Set();
    const items = [...group.items.values()]
      .sort((a, b) => a.order_id.localeCompare(b.order_id, undefined, { numeric: true }) || a.item_code.localeCompare(b.item_code))
      .flatMap((item) => {
        if (!completePos.get(item.po_key)) return [item];
        if (summaries.has(item.po_key)) return [];
        summaries.add(item.po_key);
        return [{ id: item.po_key, order_id: item.order_id, fully_shipped: true }];
      });
    return {
      id: group.id,
      container: group.container,
      brand: unique(group.rows.map((row) => text(row.brand))).join(", "),
      vendor: unique(group.rows.map((row) => getVendorName(row.vendor))).join(", "),
      stuffed_cbm: toRoundedCbmValue(group.stuffed_cbm),
      stuffing_dates: dates("stuffing_date"),
      shipping_etds: dates("shipping_ETD"),
      shipping_etas: dates("shipping_ETA"),
      items,
      search_text: group.rows.map((row) => `${row.order_id} ${row.item_code}`).join(" "),
    };
  });
  const search = key(query.search);
  const filteredRows = allRows
    .filter((row) => !search || key(`${row.container} ${row.search_text}`).includes(search))
    .sort((a, b) => (b.stuffing_dates.at(-1) || "").localeCompare(a.stuffing_dates.at(-1) || "") || a.container.localeCompare(b.container));
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / limit));
  const page = Math.min(totalPages, Math.max(1, Number.parseInt(query.page, 10) || 1));
  return {
    success: true,
    data: filteredRows.slice((page - 1) * limit, page * limit).map(({ search_text, ...row }) => row),
    pagination: { page, limit, totalPages, totalRecords: filteredRows.length },
  };
};

module.exports = { buildDailyShipmentReport };
