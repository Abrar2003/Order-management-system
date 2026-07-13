export const MONTHLY_SHIPMENT_COLORS = Object.freeze([
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#ca8a04",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#4d7c0f",
  "#ea580c",
  "#0f766e",
  "#9333ea",
  "#475569",
]);

const normalizeKey = (value) => String(value ?? "").trim().toLowerCase();

export const packMonthlySeries = ({ rows = [], series = [], seriesField = "brand" } = {}) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const candidates = (Array.isArray(series) ? series : []).map((label, index) => ({
    color: MONTHLY_SHIPMENT_COLORS[index % MONTHLY_SHIPMENT_COLORS.length],
    label,
  }));
  const activeSeries = candidates.filter(({ label }) => safeRows.some((row) =>
    (row?.totals || []).some((total) =>
      normalizeKey(total?.[seriesField]) === normalizeKey(label)
      && Number(total?.unique_container_count || 0) > 0,
    ),
  ));
  const chartRows = safeRows.map((row) => {
    const activeTotals = activeSeries.map(({ color, label }) => {
      const total = (row?.totals || []).find(
        (entry) => normalizeKey(entry?.[seriesField]) === normalizeKey(label),
      );
      const containerCount = Number(total?.unique_container_count || 0);
      return containerCount > 0 ? { color, containerCount, label, total } : null;
    }).filter(Boolean);
    const chartRow = {
      month: row?.month || "",
      month_label: row?.month_label || row?.month || "N/A",
      __active_count: activeTotals.length,
      __meta: {},
    };

    activeTotals.forEach(({ color, containerCount, label, total }, index) => {
      const slot = `slot_${index}`;
      chartRow[slot] = containerCount;
      chartRow.__meta[slot] = {
        [seriesField]: label,
        color,
        label,
        total_allocated_cbm: Number(total?.total_allocated_cbm || 0),
        unique_container_count: containerCount,
      };
    });

    return chartRow;
  });
  const slotCount = Math.max(0, ...chartRows.map((row) => row.__active_count));

  return {
    rows: chartRows,
    series: activeSeries,
    slots: Array.from({ length: slotCount }, (_, index) => `slot_${index}`),
  };
};
