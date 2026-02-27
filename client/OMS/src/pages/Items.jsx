import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.utils";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};

const normalizeFilterParam = (value, fallback = "all") => {
  const cleaned = String(value || "").trim();
  if (!cleaned) return fallback;
  return cleaned;
};

const normalizeSearchParam = (value) => String(value || "").trim();

const useDebouncedValue = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
};

const formatLbh = (value) => {
  const l = Number(value?.L || 0);
  const b = Number(value?.B || 0);
  const h = Number(value?.H || 0);
  const safeL = Number.isFinite(l) ? l : 0;
  const safeB = Number.isFinite(b) ? b : 0;
  const safeH = Number.isFinite(h) ? h : 0;
  return `${safeL} x ${safeB} x ${safeH}`;
};

const Items = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "items");
  const user = getUserFromToken();
  const normalizedRole = String(user?.role || "").trim().toLowerCase();
  const canSyncItems = ["admin", "manager", "dev"].includes(normalizedRole);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchInput, setSearchInput] = useState(() =>
    normalizeSearchParam(searchParams.get("search")),
  );
  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("brand"), "all"),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [filters, setFilters] = useState({
    brands: [],
    vendors: [],
    item_codes: [],
  });

  const debouncedSearch = useDebouncedValue(searchInput, 300);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await api.get("/items", {
        params: {
          search: debouncedSearch,
          brand: brandFilter,
          vendor: vendorFilter,
          page,
          limit,
        },
      });

      setRows(Array.isArray(res?.data?.data) ? res.data.data : []);
      setTotalPages(Number(res?.data?.pagination?.totalPages || 1));
      setTotalRecords(Number(res?.data?.pagination?.totalRecords || 0));
      setFilters({
        brands: Array.isArray(res?.data?.filters?.brands)
          ? res.data.filters.brands
          : [],
        vendors: Array.isArray(res?.data?.filters?.vendors)
          ? res.data.filters.vendors
          : [],
        item_codes: Array.isArray(res?.data?.filters?.item_codes)
          ? res.data.filters.item_codes
          : [],
      });
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load items.");
      setRows([]);
      setTotalPages(1);
      setTotalRecords(0);
      setFilters({
        brands: [],
        vendors: [],
        item_codes: [],
      });
    } finally {
      setLoading(false);
    }
  }, [brandFilter, debouncedSearch, limit, page, vendorFilter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    const nextSearchInput = normalizeSearchParam(searchParams.get("search"));
    const nextBrandFilter = normalizeFilterParam(searchParams.get("brand"), "all");
    const nextVendorFilter = normalizeFilterParam(searchParams.get("vendor"), "all");
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setSearchInput((prev) => (prev === nextSearchInput ? prev : nextSearchInput));
    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams();
    const searchValue = normalizeSearchParam(searchInput);

    if (searchValue) next.set("search", searchValue);
    if (brandFilter && brandFilter !== "all") next.set("brand", brandFilter);
    if (vendorFilter && vendorFilter !== "all") next.set("vendor", vendorFilter);
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    limit,
    page,
    searchInput,
    searchParams,
    setSearchParams,
    vendorFilter,
  ]);

  const handleSync = async () => {
    try {
      setSyncing(true);
      setError("");
      setSuccess("");

      const res = await api.post("/items/sync");
      const totalItems = Number(res?.data?.summary?.total_items || 0);
      const orderCreated = Number(res?.data?.summary?.order_sync?.created || 0);
      const orderUpdated = Number(res?.data?.summary?.order_sync?.updated || 0);
      const qcCreated = Number(res?.data?.summary?.qc_sync?.created || 0);
      const qcUpdated = Number(res?.data?.summary?.qc_sync?.updated || 0);
      const qcCbmUpdated = Number(res?.data?.summary?.qc_cbm_sync?.updated || 0);
      const derivedUpdated = Number(res?.data?.summary?.derived_sync?.updated || 0);

      setSuccess(
        `Item sync complete. Total Items: ${totalItems}. QC CBM totals updated: ${qcCbmUpdated}. Orders created/updated: ${orderCreated}/${orderUpdated}. QC created/updated: ${qcCreated}/${qcUpdated}. Derived fields updated: ${derivedUpdated}.`,
      );
      await fetchItems();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to sync items.");
    } finally {
      setSyncing(false);
    }
  };

  const itemCodeOptions = useMemo(
    () => (Array.isArray(filters.item_codes) ? filters.item_codes : []),
    [filters.item_codes],
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
          <h2 className="h4 mb-0">Items</h2>
          {canSyncItems ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={syncing}
              onClick={handleSync}
            >
              {syncing ? "Syncing..." : "Sync Items"}
            </button>
          ) : (
            <span className="d-none d-md-inline" />
          )}
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <div className="row g-2 align-items-end">
              <div className="col-md-4">
                <label className="form-label">Search (Code / Name / Description)</label>
                <input
                  type="text"
                  className="form-control"
                  value={searchInput}
                  list="item-code-options"
                  placeholder="Search items"
                  onChange={(e) => {
                    setPage(1);
                    setSearchInput(e.target.value);
                  }}
                />
                <datalist id="item-code-options">
                  {itemCodeOptions.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
              </div>
              <div className="col-md-3">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={brandFilter}
                  onChange={(e) => {
                    setPage(1);
                    setBrandFilter(e.target.value);
                  }}
                >
                  <option value="all">All Brands</option>
                  {filters.brands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-3">
                <label className="form-label">Vendor</label>
                <select
                  className="form-select"
                  value={vendorFilter}
                  onChange={(e) => {
                    setPage(1);
                    setVendorFilter(e.target.value);
                  }}
                >
                  <option value="all">All Vendors</option>
                  {filters.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-2 d-grid">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    setPage(1);
                    setSearchInput("");
                    setBrandFilter("all");
                    setVendorFilter("all");
                    setSuccess("");
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
            <span className="om-summary-chip">Records: {totalRecords}</span>
            <span className="om-summary-chip">Page: {page}</span>
            <span className="om-summary-chip">Limit: {limit}</span>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            {error}
          </div>
        )}

        {success && (
          <div className="alert alert-success mb-3" role="alert">
            {success}
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
                      <th>Item Code</th>
                      <th>Name</th>
                      <th>Brand Name</th>
                      <th>Weight Net</th>
                      <th>Weight Gross</th>
                      <th>Inspected CBM</th>
                      <th>Calculated CBM</th>
                      <th>Item LBH</th>
                      <th>Box LBH</th>
                      {/* <th>Source</th> */}
                      {/* <th>Updated At</th> */}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan="20" className="text-center py-4">
                          No items found
                        </td>
                      </tr>
                    )}
                    {rows.map((item) => (
                      <tr key={item?._id || item?.code}>
                        <td>{item?.code || "N/A"}</td>
                        <td>{item?.name || "N/A"}</td>
                        <td>
                          {item?.brand_name
                            || (Array.isArray(item?.brands) && item.brands.length > 0
                              ? item.brands[0]
                              : "N/A")}
                        </td>
                        {/* <td>{Array.isArray(item?.brands) && item.brands.length > 0 ? item.brands.join(", ") : "N/A"}</td>
                        <td>{Array.isArray(item?.vendors) && item.vendors.length > 0 ? item.vendors.join(", ") : "N/A"}</td> */}
                        <td>{item?.weight?.net ?? 0}</td>
                        <td>{item?.weight?.gross ?? 0}</td>
                        <td>
                          {item?.cbm?.inspected_total ?? item?.cbm?.total ?? "0"}
                        </td>
                        <td>{item?.cbm?.calculated_total ?? "0"}</td>
                        <td>{formatLbh(item?.item_LBH)}</td>
                        <td>{formatLbh(item?.box_LBH)}</td>
                        {/* <td>
                          {item?.source?.from_orders ? "Orders" : ""}
                          {item?.source?.from_orders && item?.source?.from_qc ? " + " : ""}
                          {item?.source?.from_qc ? "QC" : ""}
                          {!item?.source?.from_orders && !item?.source?.from_qc ? "N/A" : ""}
                        </td> */}
                        {/* <td>{formatDateLabel(item?.updatedAt)}</td> */}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="d-flex justify-content-center align-items-center gap-3 mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Prev
          </button>
          <span className="small fw-semibold">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page >= totalPages}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          >
            Next
          </button>
        </div>

        <div className="d-flex justify-content-end mt-3">
          <div className="input-group om-limit-control">
            <span className="input-group-text">Limit</span>
            <select
              className="form-select"
              value={limit}
              onChange={(e) => {
                setPage(1);
                setLimit(Number(e.target.value));
              }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      </div>
    </>
  );
};

export default Items;
