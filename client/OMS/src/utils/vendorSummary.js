const toCount = (value) => Math.max(0, Number(value) || 0);

export const hasOpenVendorOrders = (summary = {}) =>
  toCount(summary.totalOrders) > toCount(summary.totalShipped);
