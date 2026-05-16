import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import ProductImageThumbnail from "../components/ProductImageThumbnail";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { formatDateDDMMYYYY } from "../utils/date";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_FILTER = "all";
const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [20, 50, 100];
const STATUS_OPTIONS = [
  { value: DEFAULT_FILTER, label: "All PD Statuses" },
  { value: "not_set", label: "Not Set" },
  { value: "created", label: "Created" },
  { value: "checked", label: "Checked" },
  { value: "approved", label: "Approved" },
];
const RUNNING_PO_OPTIONS = [
  { value: DEFAULT_FILTER, label: "All PO States" },
  { value: "yes", label: "Has Running POs" },
  { value: "no", label: "No Running POs" },
];

const normalizeText = (value) => String(value || "").trim();
const normalizeFilter = (value, fallback = DEFAULT_FILTER) => {
  const normalized = normalizeText(value);
  return normalized || fallback;
};
const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};
const getStatusLabel = (value) => {
  const normalized = normalizeText(value).toLowerCase().replace(/\s+/g, "_");
  const match = STATUS_OPTIONS.find((option) => option.value === normalized);
  return match ? match.label : "Not Set";
};
const getStatusBadgeClass = (value) => {
  const normalized = normalizeText(value).toLowerCase().replace(/\s+/g, "_");
  if (normalized === "approved") return "text-bg-success";
  if (normalized === "checked") return "text-bg-info";
  if (normalized === "created") return "text-bg-warning";
  return "text-bg-secondary";
};

const ItemDatabase = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "item-database");

  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ brand_options: [], vendor_options: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState(() => normalizeText(searchParams.get("search")));
  const [draftSearchInput, setDraftSearchInput] = useState(() => normalizeText(searchParams.get("search")));
  const [brandFilter, setBrandFilter] = useState(() => normalizeFilter(searchParams.get("brand")));
  const [draftBrandFilter, setDraftBrandFilter] = useState(() => normalizeFilter(searchParams.get("brand")));
  const [vendorFilter, setVendorFilter] = useState(() => normalizeFilter(searchParams.get("vendor")));
  const [draftVendorFilter, setDraftVendorFilter] = useState(() => normalizeFilter(searchParams.get("vendor")));
  const [statusFilter, setStatusFilter] = useState(() => normalizeFilter(searchParams.get("status")));
  const [draftStatusFilter, setDraftStatusFilter] = useState(() => normalizeFilter(searchParams.get("status")));
  const [runningPoFilter, setRunningPoFilter] = useState(() => normalizeFilter(searchParams.get("running_po")));
  const [draftRunningPoFilter, setDraftRunningPoFilter] = useState(() => normalizeFilter(searchParams.get("running_po")));
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1));
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const fetchRows = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.get("/items/item-database", {
        params: {
          search: searchInput,
          brand: brandFilter,
          vendor: vendorFilter,
          status: statusFilter,
          running_po: runningPoFilter,
          include_product_image_thumbnail: true,
          page,
          limit,
        },
      });

      setRows(Array.isArray(response?.data?.rows) ? response.data.rows : []);
      setFilters(response?.data?.filters || { brand_options: [], vendor_options: [] });
      setTotalRecords(Number(response?.data?.pagination?.total || 0));
      setTotalPages(Number(response?.data?.pagination?.totalPages || 1));
    } catch (fetchError) {
      setRows([]);
      setError(fetchError?.response?.data?.message || "Failed to fetch Item Database.");
    } finally {
      setLoading(false);
    }
  }, [brandFilter, limit, page, runningPoFilter, searchInput, statusFilter, vendorFilter]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    const nextParams = new URLSearchParams();
    if (searchInput) nextParams.set("search", searchInput);
    if (brandFilter !== DEFAULT_FILTER) nextParams.set("brand", brandFilter);
    if (vendorFilter !== DEFAULT_FILTER) nextParams.set("vendor", vendorFilter);
    if (statusFilter !== DEFAULT_FILTER) nextParams.set("status", statusFilter);
    if (runningPoFilter !== DEFAULT_FILTER) nextParams.set("running_po", runningPoFilter);
    if (page > 1) nextParams.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) nextParams.set("limit", String(limit));

    if (!areSearchParamsEquivalent(searchParams, nextParams)) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    brandFilter,
    limit,
    page,
    runningPoFilter,
    searchInput,
    searchParams,
    setSearchParams,
    statusFilter,
    vendorFilter,
  ]);

  const applyFilters = (event) => {
    event.preventDefault();
    setSearchInput(normalizeText(draftSearchInput));
    setBrandFilter(draftBrandFilter);
    setVendorFilter(draftVendorFilter);
    setStatusFilter(draftStatusFilter);
    setRunningPoFilter(draftRunningPoFilter);
    setPage(1);
  };

  const resetFilters = () => {
    setDraftSearchInput("");
    setDraftBrandFilter(DEFAULT_FILTER);
    setDraftVendorFilter(DEFAULT_FILTER);
    setDraftStatusFilter(DEFAULT_FILTER);
    setDraftRunningPoFilter(DEFAULT_FILTER);
    setSearchInput("");
    setBrandFilter(DEFAULT_FILTER);
    setVendorFilter(DEFAULT_FILTER);
    setStatusFilter(DEFAULT_FILTER);
    setRunningPoFilter(DEFAULT_FILTER);
    setPage(1);
  };

  return (
    <>
      <Navbar />
      <div className="container-fluid py-4 om-page item-database-page">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
          <div>
            <h2 className="h4 mb-1">Item Database</h2>
            <div className="text-secondary small">
              {totalRecords} item{totalRecords === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        <div className="card om-card mb-4">
          <div className="card-body">
            <form className="row g-3 align-items-end" onSubmit={applyFilters}>
              <div className="col-md-3">
                <label className="form-label">Search</label>
                <input
                  className="form-control"
                  value={draftSearchInput}
                  onChange={(event) => setDraftSearchInput(event.target.value)}
                  placeholder="Item code, brand, description"
                />
              </div>
              <div className="col-md-2">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={draftBrandFilter}
                  onChange={(event) => setDraftBrandFilter(event.target.value)}
                >
                  <option value={DEFAULT_FILTER}>All Brands</option>
                  {(filters.brand_options || []).map((brand) => (
                    <option key={brand} value={brand}>{brand}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Vendor</label>
                <select
                  className="form-select"
                  value={draftVendorFilter}
                  onChange={(event) => setDraftVendorFilter(event.target.value)}
                >
                  <option value={DEFAULT_FILTER}>All Vendors</option>
                  {(filters.vendor_options || []).map((vendor) => (
                    <option key={vendor} value={vendor}>{vendor}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">PD Status</label>
                <select
                  className="form-select"
                  value={draftStatusFilter}
                  onChange={(event) => setDraftStatusFilter(event.target.value)}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Running POs</label>
                <select
                  className="form-select"
                  value={draftRunningPoFilter}
                  onChange={(event) => setDraftRunningPoFilter(event.target.value)}
                >
                  {RUNNING_PO_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-1 d-flex gap-2">
                <button type="submit" className="btn btn-primary w-100">Apply</button>
              </div>
              <div className="col-md-2">
                <button type="button" className="btn btn-outline-secondary w-100" onClick={resetFilters}>
                  Reset Filters
                </button>
              </div>
              <div className="col-md-2">
                <label className="form-label">Rows</label>
                <select
                  className="form-select"
                  value={limit}
                  onChange={(event) => {
                    setLimit(parseLimit(event.target.value));
                    setPage(1);
                  }}
                >
                  {LIMIT_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
            </form>
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-4">Loading...</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle om-table mb-0 item-database-table">
                  <thead className="table-primary">
                    <tr>
                      <th>Item Code</th>
                      <th>Image</th>
                      <th>Brand</th>
                      <th>Vendor</th>
                      <th>Current Running POs</th>
                      <th>Last Inspected Date</th>
                      <th>PD Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="fw-semibold">{row.item_code || "N/A"}</td>
                        <td>
                          <ProductImageThumbnail
                            src={row.product_image_url}
                            originalName={row.product_image?.originalName}
                            alt={`${row.item_code || "Item"} product image`}
                            size="sm"
                          />
                        </td>
                        <td>{row.brand || (row.brands || []).join(", ") || "N/A"}</td>
                        <td>{row.vendor || "N/A"}</td>
                        <td>
                          <div className="fw-semibold">{row.current_running_pos || 0}</div>
                          {Array.isArray(row.current_running_po_ids) && row.current_running_po_ids.length > 0 && (
                            <div className="small text-secondary">
                              {row.current_running_po_ids.slice(0, 4).join(", ")}
                              {row.current_running_po_ids.length > 4 ? "..." : ""}
                            </div>
                          )}
                        </td>
                        <td>{row.last_inspected_date ? formatDateDDMMYYYY(row.last_inspected_date) : "N/A"}</td>
                        <td>
                          <span className={`badge ${getStatusBadgeClass(row.product_database_status)}`}>
                            {getStatusLabel(row.product_database_status)}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-outline-primary btn-sm"
                            onClick={() => navigate(`/product-database-details/${row.id}`)}
                          >
                            See Details
                          </button>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td className="text-center py-4" colSpan={8}>No items found</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="d-flex justify-content-between align-items-center mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </button>
          <span className="text-secondary small">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
};

export default ItemDatabase;
