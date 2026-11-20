export const getItemPoTarget = (row = {}, isQcUser = false) => {
  const qcId = String(row.qc_id || "").trim();
  if (qcId && (isQcUser || Number(row.inspection_count || 0) > 0)) {
    return `/qc/${encodeURIComponent(qcId)}`;
  }
  const po = String(row.po || "").trim();
  return !isQcUser && po ? `/orders?order_id=${encodeURIComponent(po)}` : "";
};
