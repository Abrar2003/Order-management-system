import { useCallback, useEffect, useState } from "react";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { formatDateDDMMYYYY } from "../utils/date";
import "../App.css";

const tenureLabel = (tenure) => tenure
  ? `${tenure.brand} · ${formatDateDDMMYYYY(tenure.from_date)} - ${formatDateDDMMYYYY(tenure.to_date)}`
  : "";
const formatPercentage = (value) => `${Number(value || 0).toFixed(2).replace(/\.00$/, "")}%`;
const sameBrand = (left, right) => String(left?.brand || "").trim().toLocaleLowerCase() === String(right?.brand || "").trim().toLocaleLowerCase();

const ClaimRows = ({ rows, status, title, emptyText }) => {
  const filteredRows = rows.filter((row) => row.status === status);
  return <div className="card om-card mb-3">
    <div className="card-header fw-semibold">{title} <span className="badge text-bg-secondary">{filteredRows.length}</span></div>
    <div className="table-responsive"><table className="table align-middle mb-0">
      <thead><tr><th>Item code</th><th>Description</th><th>Vendors</th><th>Last claim</th><th>Current claim</th></tr></thead>
      <tbody>{filteredRows.length ? filteredRows.map((row) => <tr key={row.id} className={row.trend === "increased" ? "claim-comparison-increased" : row.trend === "improved" ? "claim-comparison-improved" : ""}>
        <td className="fw-semibold">{row.code || "-"}</td>
        <td>{row.description || row.name || "-"}</td>
        <td>{(row.vendors || []).join(", ") || "-"}</td>
        <td>{row.previous ? formatPercentage(row.previous.claim_percentage) : "-"}</td>
        <td>{row.current ? formatPercentage(row.current.claim_percentage) : "-"}</td>
      </tr>) : <tr><td colSpan="5" className="text-center text-secondary py-4">{emptyText}</td></tr>}</tbody>
    </table></div>
  </div>;
};

const ClaimComparison = () => {
  const [tenures, setTenures] = useState([]);
  const [previousTenureId, setPreviousTenureId] = useState("");
  const [currentTenureId, setCurrentTenureId] = useState("");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadTenures = useCallback(async () => {
    try {
      const response = await api.get("/reports/claims/tenures");
      setTenures(Array.isArray(response?.data?.rows) ? response.data.rows : []);
    } catch (loadError) {
      setError(loadError?.response?.data?.message || "Failed to fetch claim tenures.");
    }
  }, []);

  const loadReport = useCallback(async () => {
    if (!previousTenureId || !currentTenureId) return;
    try {
      setLoading(true);
      setError("");
      const response = await api.get("/reports/claims/comparison", { params: { previous_tenure_id: previousTenureId, current_tenure_id: currentTenureId, vendor: vendorFilter } });
      setReport(response?.data || null);
    } catch (loadError) {
      setReport(null);
      setError(loadError?.response?.data?.message || "Failed to fetch claim comparison.");
    } finally {
      setLoading(false);
    }
  }, [currentTenureId, previousTenureId, vendorFilter]);

  useEffect(() => { loadTenures(); }, [loadTenures]);
  useEffect(() => { loadReport(); }, [loadReport]);

  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const previousTenure = tenures.find((tenure) => tenure.id === previousTenureId);
  const currentTenures = tenures.filter((tenure) => !previousTenure || sameBrand(tenure, previousTenure));
  return <><Navbar /><main className="container-fluid claims-report-container py-3">
    <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"><div><h2 className="h4 mb-1">Claim Comparison</h2><p className="text-secondary mb-0">Choose two tenures for one brand and optionally filter the items by vendor.</p></div><button type="button" className="btn btn-outline-primary btn-sm" disabled={loading || !previousTenureId || !currentTenureId} onClick={loadReport}>Refresh</button></div>
    <div className="card om-card mb-3"><div className="card-body"><div className="row g-2"><div className="col-md-4"><label className="form-label" htmlFor="claim-comparison-previous-tenure">Last tenure</label><select id="claim-comparison-previous-tenure" className="form-select" value={previousTenureId} onChange={(event) => { const nextId = event.target.value; const nextTenure = tenures.find((tenure) => tenure.id === nextId); setPreviousTenureId(nextId); setVendorFilter("all"); if (currentTenureId && (!nextTenure || currentTenureId === nextId || !sameBrand(tenures.find((tenure) => tenure.id === currentTenureId), nextTenure))) setCurrentTenureId(""); }}><option value="">Select tenure</option>{tenures.map((tenure) => <option key={tenure.id} value={tenure.id}>{tenureLabel(tenure)}</option>)}</select></div><div className="col-md-4"><label className="form-label" htmlFor="claim-comparison-tenure">Current tenure</label><select id="claim-comparison-tenure" className="form-select" value={currentTenureId} onChange={(event) => { setCurrentTenureId(event.target.value); setVendorFilter("all"); }}><option value="">Select tenure</option>{currentTenures.map((tenure) => <option key={tenure.id} value={tenure.id} disabled={tenure.id === previousTenureId}>{tenureLabel(tenure)}</option>)}</select></div><div className="col-md-4"><label className="form-label" htmlFor="claim-comparison-vendor">Vendor</label><select id="claim-comparison-vendor" className="form-select" value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)}><option value="all">All vendors</option>{(report?.filters?.vendors || []).map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}</select></div></div></div></div>
    {error && <div className="alert alert-danger">{error}</div>}
    {loading ? <div className="text-center py-4 text-secondary">Loading comparison...</div> : report && <>
      <div className="alert alert-info">Last tenure: <strong>{tenureLabel(report.previous_tenure)}</strong> · Current tenure: <strong>{tenureLabel(report.current_tenure)}</strong><br />Red: claim increased · Green: claim improved.</div>
      <ClaimRows rows={rows} status="missing" title="Not present in current tenure" emptyText="Every last-tenure item is present in the current tenure." />
      <ClaimRows rows={rows} status="new" title="Newly added in current tenure" emptyText="No new items were added in the current tenure." />
      <ClaimRows rows={rows} status="same" title="Present in both tenures" emptyText="No items are present in both tenures." />
    </>}
  </main></>;
};

export default ClaimComparison;
