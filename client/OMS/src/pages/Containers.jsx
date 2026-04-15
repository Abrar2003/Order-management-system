import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const useDebouncedValue = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
};

const normalizeSearchParam = (value) => String(value || "").trim();

const normalizeFilterParam = (value, fallback = "all") => {
  const cleaned = String(value || "").trim();
  if (!cleaned) return fallback;
  return cleaned;
};

const Containers = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "containers-list");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [containerSearch, setContainerSearch] = useState(() =>
    normalizeSearchParam(searchParams.get("container")),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("brand"), "all"),
  );
  const [summary, setSummary] = useState({ total: 0 });
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [filterOptions, setFilterOptions] = useState({
    brands: [],
    vendors: [],
    containers: [],
  });

  const debouncedContainerSearch = useDebouncedValue(containerSearch, 300);

  const fetchContainers = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await api.get("/orders/containers", {
        params: {
          container: debouncedContainerSearch,
          vendor: vendorFilter,
          brand: brandFilter,
        },
      });
console.log("API response:", response);
      setRows(Array.isArray(response?.data?.data) ? response.data.data : []);
      setSummary(response?.data?.summary || { total: 0 });
      setFilterOptions({
        brands: Array.isArray(response?.data?.filters?.brands)
          ? response.data.filters.brands
          : [],
        vendors: Array.isArray(response?.data?.filters?.vendors)
          ? response.data.filters.vendors
          : [],
        containers: Array.isArray(response?.data?.filters?.containers)
          ? response.data.filters.containers
          : [],
      });
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load containers.");
      setRows([]);
      setSummary({ total: 0 });
      setFilterOptions({
        brands: [],
        vendors: [],
        containers: [],
      });
    } finally {
      setLoading(false);
    }
  }, [brandFilter, debouncedContainerSearch, vendorFilter]);

  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    const nextContainerSearch = normalizeSearchParam(searchParams.get("container"));
    const nextVendorFilter = normalizeFilterParam(searchParams.get("vendor"), "all");
    const nextBrandFilter = normalizeFilterParam(searchParams.get("brand"), "all");

    setContainerSearch((prev) =>
      prev === nextContainerSearch ? prev : nextContainerSearch,
    );
    setVendorFilter((prev) =>
      prev === nextVendorFilter ? prev : nextVendorFilter,
    );
    setBrandFilter((prev) =>
      prev === nextBrandFilter ? prev : nextBrandFilter,
    );
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    const containerValue = normalizeSearchParam(containerSearch);

    if (containerValue) next.set("container", containerValue);
    if (vendorFilter && vendorFilter !== "all") next.set("vendor", vendorFilter);
    if (brandFilter && brandFilter !== "all") next.set("brand", brandFilter);

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    containerSearch,
    searchParams,
    setSearchParams,
    syncedQuery,
    vendorFilter,
  ]);

  const handleOpenShipments = useCallback(
    (containerNumber) => {
      const normalizedContainer = String(containerNumber || "").trim();
      if (!normalizedContainer) return;

      navigate({
        pathname: "/shipments",
        search: `?container=${encodeURIComponent(normalizedContainer)}`,
      });
    },
    [navigate],
  );

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(-1)}
          >
            Back
          </button>
          <h2 className="h4 mb-0">Containers</h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={fetchContainers}
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <div className="row g-2 align-items-end">
              <div className="col-md-4">
                <label className="form-label">Search by Container</label>
                <input
                  type="text"
                  className="form-control"
                  value={containerSearch}
                  list="containers-page-container-options"
                  onChange={(event) => setContainerSearch(event.target.value)}
                  placeholder="Enter container number"
                />
                <datalist id="containers-page-container-options">
                  {filterOptions.containers.map((containerValue) => (
                    <option key={containerValue} value={containerValue} />
                  ))}
                </datalist>
              </div>
              <div className="col-md-3">
                <label className="form-label">Filter by Vendor</label>
                <select
                  className="form-select"
                  value={vendorFilter}
                  onChange={(event) => setVendorFilter(event.target.value)}
                >
                  <option value="all">All Vendors</option>
                  {filterOptions.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-3">
                <label className="form-label">Filter by Brand</label>
                <select
                  className="form-select"
                  value={brandFilter}
                  onChange={(event) => setBrandFilter(event.target.value)}
                >
                  <option value="all">All Brands</option>
                  {filterOptions.brands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-2 d-grid">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    setContainerSearch("");
                    setVendorFilter("all");
                    setBrandFilter("all");
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Total Containers: {summary?.total ?? 0}</span>
            <span className="om-summary-chip">
              Showing: {rows.length} {rows.length === 1 ? "container" : "containers"}
            </span>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            {error}
          </div>
        )}

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-4">Loading...</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle om-table mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>Container</th>
                      <th>Brand</th>
                      <th>Vendor</th>
                      <th>Shipping Date</th>
                      <th>Item Count</th>
                      <th>Total Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="text-center py-4">
                          No containers found
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr
                          key={row.container}
                          className="table-clickable"
                          onClick={() => handleOpenShipments(row.container)}
                          title="Open shipments filtered by this container"
                        >
                          <td>{row.container || "N/A"}</td>
                          <td>{row.brand || "N/A"}</td>
                          <td>{row.vendor || "N/A"}</td>
                          <td>{formatDateDDMMYYYY(row.shipping_date)}</td>
                          <td>{row.item_count ?? 0}</td>
                          <td>{row.total_quantity ?? 0}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default Containers;
