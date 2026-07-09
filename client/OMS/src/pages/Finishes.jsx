import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/axios";
import { usePermissions } from "../auth/PermissionContext";
import Navbar from "../components/Navbar";
import ProductImageThumbnail from "../components/ProductImageThumbnail";
import UploadFinishModal from "../components/UploadFinishModal";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import "../App.css";

const DEFAULT_FILTER = "all";

const normalizeText = (value) => String(value || "").trim();
const normalizeFilter = (value) => normalizeText(value) || DEFAULT_FILTER;

const formatArray = (values = [], fallback = "N/A") => {
  const cleaned = (Array.isArray(values) ? values : [])
    .map(normalizeText)
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned.join(", ") : fallback;
};

const getFinishImageSrc = (value = "") => {
  const src = normalizeText(value);
  if (!src || !src.startsWith("/finishes/")) return src;

  const apiBase = normalizeText(import.meta.env.VITE_API_BASE_URL);
  return apiBase ? `${apiBase.replace(/\/$/, "")}${src}` : src;
};

const Finishes = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "finishes");
  const { hasPermission } = usePermissions();
  const canEditFinishes = hasPermission("finishes", "upload");

  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ brands: [], vendors: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [brandFilter, setBrandFilter] = useState(() => normalizeFilter(searchParams.get("brand")));
  const [vendorFilter, setVendorFilter] = useState(() => normalizeFilter(searchParams.get("vendor")));
  const [draftBrandFilter, setDraftBrandFilter] = useState(() => normalizeFilter(searchParams.get("brand")));
  const [draftVendorFilter, setDraftVendorFilter] = useState(() => normalizeFilter(searchParams.get("vendor")));
  const [editingFinish, setEditingFinish] = useState(null);

  const fetchFinishes = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.get("/finishes", {
        params: {
          brand: brandFilter === DEFAULT_FILTER ? "" : brandFilter,
          vendor: vendorFilter === DEFAULT_FILTER ? "" : vendorFilter,
        },
      });
      setRows(Array.isArray(response?.data?.data) ? response.data.data : []);
      setFilters({
        brands: Array.isArray(response?.data?.filters?.brands) ? response.data.filters.brands : [],
        vendors: Array.isArray(response?.data?.filters?.vendors) ? response.data.filters.vendors : [],
      });
    } catch (fetchError) {
      setRows([]);
      setError(fetchError?.response?.data?.message || "Failed to load finishes.");
    } finally {
      setLoading(false);
    }
  }, [brandFilter, vendorFilter]);

  useEffect(() => {
    fetchFinishes();
  }, [fetchFinishes]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (brandFilter !== DEFAULT_FILTER) next.set("brand", brandFilter);
    if (vendorFilter !== DEFAULT_FILTER) next.set("vendor", vendorFilter);
    setSearchParams(next, { replace: true });
  }, [brandFilter, setSearchParams, vendorFilter]);

  const handleApplyFilters = (event) => {
    event.preventDefault();
    setBrandFilter(normalizeFilter(draftBrandFilter));
    setVendorFilter(normalizeFilter(draftVendorFilter));
  };

  const handleClearFilters = () => {
    setDraftBrandFilter(DEFAULT_FILTER);
    setDraftVendorFilter(DEFAULT_FILTER);
    setBrandFilter(DEFAULT_FILTER);
    setVendorFilter(DEFAULT_FILTER);
  };

  return (
    <>
      <Navbar />

      <div className="page-shell py-3 finishes-page oms-responsive-list-page">
        <div className="d-flex justify-content-between align-items-center mb-3 gap-3 flex-wrap oms-responsive-page-header">
          <h2 className="h4 mb-0">Finishes</h2>
          <span className="om-summary-chip">Total: {rows.length}</span>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <form className="row g-2 align-items-end" onSubmit={handleApplyFilters}>
              <div className="col-md-4">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={draftBrandFilter}
                  onChange={(event) => setDraftBrandFilter(event.target.value)}
                >
                  <option value={DEFAULT_FILTER}>All Brands</option>
                  {filters.brands.map((brand) => (
                    <option key={brand} value={brand}>{brand}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label">Vendor</label>
                <select
                  className="form-select"
                  value={draftVendorFilter}
                  onChange={(event) => setDraftVendorFilter(event.target.value)}
                >
                  <option value={DEFAULT_FILTER}>All Vendors</option>
                  {filters.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>{vendor}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-4 d-flex gap-2">
                <button type="submit" className="btn btn-primary flex-fill" disabled={loading}>
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary flex-fill"
                  onClick={handleClearFilters}
                  disabled={loading}
                >
                  Clear
                </button>
              </div>
            </form>
          </div>
        </div>

        {error && <div className="alert alert-danger mb-3">{error}</div>}
        {success && <div className="alert alert-success mb-3">{success}</div>}

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-4">Loading...</div>
            ) : (
              <div className="table-responsive responsive-table-shell">
                <table className="table table-striped table-hover align-middle om-table responsive-card-table mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>Image</th>
                      <th>Unique Code</th>
                      <th>Vendor</th>
                      <th>Vendor Code</th>
                      <th>Color</th>
                      <th>Color Code</th>
                      <th>Brands</th>
                      <th>Items</th>
                      <th>Updated</th>
                      {canEditFinishes && <th>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr className="responsive-card-table-empty-row">
                        <td colSpan={canEditFinishes ? 10 : 9} className="text-center py-4">
                          No finishes found
                        </td>
                      </tr>
                    )}
                    {rows.map((finish) => {
                      const items = Array.isArray(finish?.items) ? finish.items : [];
                      const visibleItems = items.slice(0, 4);
                      return (
                        <tr key={finish?._id || finish?.unique_code}>
                          <td data-label="Image">
                            <ProductImageThumbnail
                              src={getFinishImageSrc(finish?.image_url || finish?.image?.link)}
                              originalName={finish?.image?.originalName}
                              alt={`${finish?.unique_code || "Finish"} image`}
                              size="sm"
                            />
                          </td>
                          <td data-label="Unique Code" className="fw-semibold">
                            {finish?.unique_code || "N/A"}
                          </td>
                          <td data-label="Vendor">{finish?.vendor || "N/A"}</td>
                          <td data-label="Vendor Code">{finish?.vendor_code || "N/A"}</td>
                          <td data-label="Color">{finish?.color || "N/A"}</td>
                          <td data-label="Color Code">{finish?.color_code || "N/A"}</td>
                          <td data-label="Brands">{formatArray(finish?.brands)}</td>
                          <td data-label="Items">
                            {visibleItems.length > 0 ? (
                              <div className="d-grid gap-1">
                                {visibleItems.map((item) => (
                                  <div key={item?.code || item?._id} className="small">
                                    <span className="fw-semibold">{item?.code || "N/A"}</span>
                                    <span className="text-secondary">
                                      {" "}({item?.brand || "N/A"})
                                    </span>
                                  </div>
                                ))}
                                {items.length > visibleItems.length && (
                                  <div className="small text-secondary">
                                    +{items.length - visibleItems.length} more
                                  </div>
                                )}
                              </div>
                            ) : (
                              "N/A"
                            )}
                          </td>
                          <td data-label="Updated">
                            {finish?.updated_at ? formatDateDDMMYYYY(finish.updated_at) : "N/A"}
                          </td>
                          {canEditFinishes && (
                            <td data-label="Action">
                              <button
                                type="button"
                                className="btn btn-outline-primary btn-sm"
                                onClick={() => setEditingFinish(finish)}
                              >
                                Edit
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {editingFinish && canEditFinishes && (
        <UploadFinishModal
          initialFinish={editingFinish}
          onClose={() => setEditingFinish(null)}
          onSaved={(message) => {
            setEditingFinish(null);
            setSuccess(message);
            fetchFinishes();
          }}
        />
      )}
    </>
  );
};

export default Finishes;
