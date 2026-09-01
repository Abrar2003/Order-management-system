import { useCallback, useEffect, useState } from "react";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { formatDateDDMMYYYY } from "../utils/date";
import "../App.css";

const DEFAULT_FILTER = "all";
const formatPercentage = (value) => `${Number(value || 0).toFixed(2).replace(/\.00$/, "")}%`;

const Claims = () => {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ brands: [], vendors: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [draftSearchInput, setDraftSearchInput] = useState("");
  const [brandFilter, setBrandFilter] = useState(DEFAULT_FILTER);
  const [draftBrandFilter, setDraftBrandFilter] = useState(DEFAULT_FILTER);
  const [vendorFilter, setVendorFilter] = useState(DEFAULT_FILTER);
  const [draftVendorFilter, setDraftVendorFilter] = useState(DEFAULT_FILTER);

  const loadClaims = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.get("/reports/claims", {
        params: { search: searchInput, brand: brandFilter, vendor: vendorFilter },
      });
      setRows(Array.isArray(response?.data?.rows) ? response.data.rows : []);
      setFilters(response?.data?.filters || { brands: [], vendors: [] });
    } catch (loadError) {
      setRows([]);
      setError(loadError?.response?.data?.message || "Failed to fetch claims.");
    } finally {
      setLoading(false);
    }
  }, [brandFilter, searchInput, vendorFilter]);

  useEffect(() => {
    loadClaims();
  }, [loadClaims]);

  const handleApplyFilters = (event) => {
    event.preventDefault();
    setSearchInput(draftSearchInput.trim());
    setBrandFilter(draftBrandFilter || DEFAULT_FILTER);
    setVendorFilter(draftVendorFilter || DEFAULT_FILTER);
  };

  const handleClearFilters = () => {
    setSearchInput("");
    setDraftSearchInput("");
    setBrandFilter(DEFAULT_FILTER);
    setDraftBrandFilter(DEFAULT_FILTER);
    setVendorFilter(DEFAULT_FILTER);
    setDraftVendorFilter(DEFAULT_FILTER);
  };

  return (
    <>
      <Navbar />
      <main className="container-fluid claims-report-container py-3">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <div>
            <h2 className="h4 mb-1">Claims</h2>
            <p className="text-secondary mb-0">Only claims recorded with claim tenures are shown.</p>
          </div>
          <button type="button" className="btn btn-outline-primary btn-sm" onClick={loadClaims}>
            Refresh
          </button>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <form className="row g-2 align-items-end" onSubmit={handleApplyFilters}>
              <div className="col-md-4">
                <label className="form-label">Search (Code / Name / Description)</label>
                <input
                  type="search"
                  className="form-control"
                  value={draftSearchInput}
                  placeholder="Search claims"
                  onChange={(event) => setDraftSearchInput(event.target.value)}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label">Brand</label>
                <select className="form-select" value={draftBrandFilter} onChange={(event) => setDraftBrandFilter(event.target.value)}>
                  <option value={DEFAULT_FILTER}>All Brands</option>
                  {filters.brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                </select>
              </div>
              <div className="col-md-3">
                <label className="form-label">Vendor</label>
                <select className="form-select" value={draftVendorFilter} onChange={(event) => setDraftVendorFilter(event.target.value)}>
                  <option value={DEFAULT_FILTER}>All Vendors</option>
                  {filters.vendors.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}
                </select>
              </div>
              <div className="col-md-2 d-grid gap-2">
                <button type="submit" className="btn btn-primary" disabled={loading}>Apply</button>
                <button type="button" className="btn btn-outline-secondary" onClick={handleClearFilters} disabled={loading}>Clear</button>
              </div>
            </form>
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <div className="card om-card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Description</th>
                  <th>Brand</th>
                  <th>Vendors</th>
                  <th>Claim Tenures</th>
                  <th>Delivered</th>
                  <th>Rejected</th>
                  <th>Claim</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="8" className="text-center py-4">Loading claims...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan="8" className="text-center py-4 text-secondary">No claims updated with the new system.</td></tr>
                ) : rows.map((row) => (
                  <tr key={row.id}>
                    <td className="fw-semibold">{row.code || "-"}</td>
                    <td>{row.description || row.name || "-"}</td>
                    <td>{row.brand || "-"}</td>
                    <td>{(row.vendors || []).join(", ") || "-"}</td>
                    <td>
                      {(row.tenures || []).map((tenure) => (
                        <div key={tenure.id} className="small">
                          {formatDateDDMMYYYY(tenure.from_date)} - {formatDateDDMMYYYY(tenure.to_date)}
                        </div>
                      ))}
                    </td>
                    <td>{row.delivered_quantity}</td>
                    <td>{row.rejected_quantity}</td>
                    <td><span className="badge text-bg-warning">{formatPercentage(row.claim_percentage)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
};

export default Claims;