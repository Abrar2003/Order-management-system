import { useCallback, useEffect, useState } from "react";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { ClaimPercentageModal } from "./Items";
import { usePermissions } from "../auth/PermissionContext";
import { formatDateDDMMYYYY } from "../utils/date";
import "../App.css";

const DEFAULT_FILTER = "all";
const formatPercentage = (value) => `${Number(value || 0).toFixed(2).replace(/\.00$/, "")}%`;

const CreateTenureModal = ({ brands, onClose, onSaved }) => {
  const [brand, setBrand] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      const response = await api.post("/reports/claims/tenures", {
        brand,
        from_date: fromDate,
        to_date: toDate,
      });
      onSaved(response?.data?.data);
    } catch (saveError) {
      setError(saveError?.response?.data?.message || "Failed to create tenure.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog"><div className="modal-dialog modal-dialog-centered" role="document"><form className="modal-content" onSubmit={submit}>
    <div className="modal-header"><h5 className="modal-title">Create tenure</h5><button type="button" className="btn-close" aria-label="Close" disabled={saving} onClick={onClose} /></div>
    <div className="modal-body"><div className="row g-2">
      <div className="col-12"><label className="form-label">Brand</label><select className="form-select" value={brand} required disabled={saving} onChange={(event) => setBrand(event.target.value)}><option value="">Select brand</option>{brands.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></div>
      <div className="col-md-6"><label className="form-label">From date</label><input type="date" className="form-control" value={fromDate} required disabled={saving} onChange={(event) => setFromDate(event.target.value)} /></div>
      <div className="col-md-6"><label className="form-label">To date</label><input type="date" className="form-control" value={toDate} required disabled={saving} onChange={(event) => setToDate(event.target.value)} /></div>
    </div>{error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}</div>
    <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Creating..." : "Create tenure"}</button></div>
  </form></div></div>;
};

const RaiseClaimModal = ({ onClose, onSaved }) => {
  const [itemCode, setItemCode] = useState("");
  const [verifiedItem, setVerifiedItem] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  const verifyItem = async (event) => {
    event.preventDefault();
    const code = itemCode.trim();
    if (!code) {
      setError("Enter an item code.");
      return;
    }

    try {
      setVerifying(true);
      setError("");
      const response = await api.get(`/reports/claims/items/${encodeURIComponent(code)}`);
      setVerifiedItem(response?.data?.data || null);
    } catch (verifyError) {
      setVerifiedItem(null);
      setError(verifyError?.response?.data?.message || "Failed to verify item code.");
    } finally {
      setVerifying(false);
    }
  };

  if (verifiedItem) {
    return <ClaimPercentageModal item={verifiedItem} onClose={onClose} onSaved={onSaved} />;
  }

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered" role="document">
        <form className="modal-content" onSubmit={verifyItem}>
          <div className="modal-header">
            <h5 className="modal-title">Raise Claim</h5>
            <button type="button" className="btn-close" aria-label="Close" disabled={verifying} onClick={onClose} />
          </div>
          <div className="modal-body">
            <label className="form-label" htmlFor="raise-claim-item-code">Item code</label>
            <input
              id="raise-claim-item-code"
              type="text"
              className="form-control"
              value={itemCode}
              autoFocus
              disabled={verifying}
              placeholder="Enter an exact item code"
              onChange={(event) => setItemCode(event.target.value)}
            />
            <div className="form-text">The item must be verified before claim details can be entered.</div>
            {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" disabled={verifying} onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={verifying}>{verifying ? "Verifying..." : "Verify Item"}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const Claims = () => {
  const { hasPermission } = usePermissions();
  const canRaiseClaim = hasPermission("items", "edit");
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ brands: [], vendors: [] });
  const [tenures, setTenures] = useState([]);
  const [tenureBrands, setTenureBrands] = useState([]);
  const [selectedTenureId, setSelectedTenureId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [draftSearchInput, setDraftSearchInput] = useState("");
  const [brandFilter, setBrandFilter] = useState(DEFAULT_FILTER);
  const [draftBrandFilter, setDraftBrandFilter] = useState(DEFAULT_FILTER);
  const [vendorFilter, setVendorFilter] = useState(DEFAULT_FILTER);
  const [draftVendorFilter, setDraftVendorFilter] = useState(DEFAULT_FILTER);
  const [showRaiseClaim, setShowRaiseClaim] = useState(false);
  const [showCreateTenure, setShowCreateTenure] = useState(false);
  const [deletingTenure, setDeletingTenure] = useState(false);

  const loadTenures = useCallback(async () => {
    try {
      const response = await api.get("/reports/claims/tenures");
      setTenures(Array.isArray(response?.data?.rows) ? response.data.rows : []);
      setTenureBrands(Array.isArray(response?.data?.brands) ? response.data.brands : []);
    } catch (loadError) {
      setError(loadError?.response?.data?.message || "Failed to fetch claim tenures.");
    }
  }, []);

  const loadClaims = useCallback(async () => {
    if (!selectedTenureId) {
      setRows([]);
      setFilters({ brands: [], vendors: [] });
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError("");
      const response = await api.get("/reports/claims", {
        params: { tenure_id: selectedTenureId, search: searchInput, brand: brandFilter, vendor: vendorFilter },
      });
      setRows(Array.isArray(response?.data?.rows) ? response.data.rows : []);
      setFilters(response?.data?.filters || { brands: [], vendors: [] });
    } catch (loadError) {
      setRows([]);
      setError(loadError?.response?.data?.message || "Failed to fetch claims.");
    } finally {
      setLoading(false);
    }
  }, [brandFilter, searchInput, selectedTenureId, vendorFilter]);

  useEffect(() => {
    loadTenures();
  }, [loadTenures]);

  useEffect(() => {
    loadClaims();
  }, [loadClaims]);

  const selectedTenure = tenures.find((tenure) => String(tenure.id) === selectedTenureId);

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

  const handleDeleteTenure = async () => {
    if (!selectedTenure || !window.confirm(`Delete ${selectedTenure.brand} tenure ${formatDateDDMMYYYY(selectedTenure.from_date)} - ${formatDateDDMMYYYY(selectedTenure.to_date)}?`)) return;
    try {
      setDeletingTenure(true);
      setError("");
      await api.delete(`/reports/claims/tenures/${selectedTenure.id}`);
      setSelectedTenureId("");
      await loadTenures();
    } catch (deleteError) {
      setError(deleteError?.response?.data?.message || "Failed to delete tenure.");
    } finally {
      setDeletingTenure(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className="container-fluid claims-report-container py-3">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <div>
            <h2 className="h4 mb-1">Claims</h2>
            <p className="text-secondary mb-0">Select a brand tenure to see every item, including items with a 0% claim.</p>
          </div>
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-outline-primary btn-sm" onClick={loadClaims}>
              Refresh
            </button>
            {canRaiseClaim && (
              <><button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setShowCreateTenure(true)}>Create tenure</button><button type="button" className="btn btn-primary btn-sm" onClick={() => setShowRaiseClaim(true)}>Raise Claim</button></>
            )}
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <div className="row g-2 mb-3"><div className="col-md-6"><label className="form-label">Brand tenure</label><select className="form-select" value={selectedTenureId} onChange={(event) => setSelectedTenureId(event.target.value)}><option value="">Select tenure</option>{tenures.map((tenure) => <option key={tenure.id} value={tenure.id}>{tenure.brand} · {formatDateDDMMYYYY(tenure.from_date)} - {formatDateDDMMYYYY(tenure.to_date)}</option>)}</select></div>{canRaiseClaim && <div className="col-md-2 d-flex align-items-end"><button type="button" className="btn btn-outline-danger w-100" disabled={!selectedTenure || deletingTenure} onClick={handleDeleteTenure}>{deletingTenure ? "Deleting..." : "Delete tenure"}</button></div>}</div>
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
                  <th>Tenure</th>
                  <th>Delivered</th>
                  <th>Rejected</th>
                  <th>Claim</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="8" className="text-center py-4">Loading claims...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan="8" className="text-center py-4 text-secondary">{selectedTenureId ? "No items match these filters." : "Select a tenure to view its items."}</td></tr>
                ) : rows.map((row) => (
                  <tr key={row.id}>
                    <td className="fw-semibold">{row.code || "-"}</td>
                    <td>{row.description || row.name || "-"}</td>
                    <td>{row.brand || "-"}</td>
                    <td>{(row.vendors || []).join(", ") || "-"}</td>
                    <td>{selectedTenure ? `${formatDateDDMMYYYY(selectedTenure.from_date)} - ${formatDateDDMMYYYY(selectedTenure.to_date)}` : "-"}</td>
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
      {showRaiseClaim && (
        <RaiseClaimModal
          onClose={() => setShowRaiseClaim(false)}
          onSaved={() => {
            setShowRaiseClaim(false);
            loadClaims();
          }}
        />
      )}
      {showCreateTenure && <CreateTenureModal brands={tenureBrands} onClose={() => setShowCreateTenure(false)} onSaved={(tenure) => { setShowCreateTenure(false); setSelectedTenureId(String(tenure?.id || "")); loadTenures(); }} />}
    </>
  );
};

export default Claims;
