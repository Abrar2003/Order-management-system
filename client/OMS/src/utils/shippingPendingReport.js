import { getGroupedOrderStatus } from "./orderStatus.js";

const text = (value) => String(value || "").trim();

const quantity = (value) => Math.max(0, Number(value) || 0);

const isPastEtd = (value, today) => {
  const etd = new Date(`${String(value || "").slice(0, 10)}T00:00:00`);
  return !Number.isNaN(etd.getTime()) && etd < today;
};

export const buildShippingPendingPoRows = (rows = [], now = new Date()) => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const groups = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const orderId = text(row?.order_id) || "N/A";
    const key = [orderId, text(row?.brand), text(row?.vendor)].join("\u0000");
    const group = groups.get(key) || {
      order_id: orderId,
      brand: text(row?.brand),
      vendor: text(row?.vendor),
      order_date: row?.order_date || "",
      etd: row?.etd || "",
      statuses: [],
      total_item_count: 0,
      total_packed_quantity: 0,
      total_shipped_quantity: 0,
      total_pending_quantity: 0,
    };
    group.statuses.push(row?.status);
    group.total_item_count += 1;
    group.total_packed_quantity += quantity(row?.packed_quantity);
    group.total_shipped_quantity += quantity(row?.shipped_quantity);
    group.total_pending_quantity += quantity(row?.pending_quantity);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map(({ statuses, ...row }) => ({
      ...row,
      status: getGroupedOrderStatus(statuses),
      is_completely_packed: row.total_pending_quantity === 0,
      is_overdue_pending:
        row.total_packed_quantity === 0 &&
        row.total_shipped_quantity === 0 &&
        isPastEtd(row.etd, today),
    }))
    .sort((left, right) => left.order_id.localeCompare(right.order_id, undefined, {
      numeric: true,
      sensitivity: "base",
    }));
};

export const getShippingPendingPoRowClass = (row) => {
  if (row?.is_completely_packed) return "om-report-success-row";
  return row?.is_overdue_pending ? "om-report-danger-row" : "";
};
