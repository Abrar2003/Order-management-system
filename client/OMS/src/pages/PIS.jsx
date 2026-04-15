import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import EditPisModal from "../components/EditPisModal";
import SortHeaderButton from "../components/SortHeaderButton";
import UploadFinishModal from "../components/UploadFinishModal";
import { getUserFromToken } from "../auth/auth.utils";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import { formatCbm } from "../utils/cbm";
import { formatFixedNumber, formatLbhValue } from "../utils/measurementDisplay";
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

const normalizeMeasurementEntries = (entries = [], weightKey = "") =>
  (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const L = Number(entry?.L || 0);
      const B = Number(entry?.B || 0);
      const H = Number(entry?.H || 0);
      const weight = Number(weightKey ? entry?.[weightKey] : 0);
      return {
        L: Number.isFinite(L) ? L : 0,
        B: Number.isFinite(B) ? B : 0,
        H: Number.isFinite(H) ? H : 0,
        weight: Number.isFinite(weight) ? weight : 0,
      };
    })
    .filter((entry) => entry.L > 0 && entry.B > 0 && entry.H > 0)
    .slice(0, 3);
const getPrimaryMeasurementLbh = (entries = [], fallback = {}) =>
  normalizeMeasurementEntries(entries)[0] || fallback || {};
const sumMeasurementWeights = (entries = [], weightKey = "") =>
  normalizeMeasurementEntries(entries, weightKey).reduce(
    (sum, entry) => sum + (Number(entry?.weight || 0) || 0),
    0,
  );

const getBrand = (item) =>
  item?.brand_name
  || item?.brand
  || (Array.isArray(item?.brands) && item.brands.length > 0 ? item.brands[0] : "N/A");

const getVendors = (item) =>
  Array.isArray(item?.vendors) && item.vendors.length > 0
    ? item.vendors.join(", ")
    : "N/A";

const getPisWeight = (item, key) => {
  const sizeEntryWeight =
    key === "net"
      ? sumMeasurementWeights(item?.pis_item_sizes, "net_weight")
      : sumMeasurementWeights(item?.pis_box_sizes, "gross_weight");
  const value = sizeEntryWeight || (item?.pis_weight?.[key] ?? 0);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const PIS = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "pis");
  const user = getUserFromToken();
  const normalizedRole = String(user?.role || "").trim().toLowerCase();
  const canEditPis = ["admin", "manager", "dev"].includes(normalizedRole);

  const [rows, setRows] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [showUploadFinishModal, setShowUploadFinishModal] = useState(false);
  const [loading, setLoading] = useState(true);
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
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [sortBy, setSortBy] = useState("code");
  const [sortOrder, setSortOrder] = useState("asc");

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
    const shouldOpenFinishModal =
      canEditPis &&
      String(searchParams.get("open_finish") || "").trim().toLowerCase() === "1";

    if (shouldOpenFinishModal) {
      setShowUploadFinishModal(true);
    }
  }, [canEditPis, searchParams]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

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
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

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
    syncedQuery,
    vendorFilter,
  ]);

  const itemCodeOptions = useMemo(
    () => (Array.isArray(filters.item_codes) ? filters.item_codes : []),
    [filters.item_codes],
  );

  const handleSortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      const nextSortState = getNextClientSortState(
        sortBy,
        sortOrder,
        column,
        defaultDirection,
      );
      setSortBy(nextSortState.sortBy);
      setSortOrder(nextSortState.sortOrder);
    },
    [sortBy, sortOrder],
  );

  const sortedRows = useMemo(
    () =>
      sortClientRows(rows, {
        sortBy,
        sortOrder,
        getSortValue: (item, column) => {
          if (column === "code") return item?.code;
          if (column === "description") return item?.description || item?.name;
          if (column === "brand") return getBrand(item);
          if (column === "vendors") return getVendors(item);
          if (column === "pisNet") return getPisWeight(item, "net");
          if (column === "pisGross") return getPisWeight(item, "gross");
          if (column === "itemLbh") {
            const value = getPrimaryMeasurementLbh(
              item?.pis_item_sizes,
              item?.pis_item_LBH || {},
            );
            return [value?.L || 0, value?.B || 0, value?.H || 0];
          }
          if (column === "boxLbh") {
            const value = getPrimaryMeasurementLbh(
              item?.pis_box_sizes,
              item?.pis_box_LBH || {},
            );
            return [value?.L || 0, value?.B || 0, value?.H || 0];
          }
          if (column === "cbm") return Number(item?.cbm?.calculated_pis_total || 0);
          return "";
        },
      }),
    [rows, sortBy, sortOrder],
  );

  return (
    <>
      <Navbar />
      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="h4 mb-0">PIS</h2>
          {canEditPis ? (
            <div className="d-flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={() => setShowUploadFinishModal(true)}
              >
                Upload Finish
              </button>
            </div>
          ) : (
            <span className="d-none d-md-inline" />
          )}
        </div>

        {!canEditPis && (
          <div className="alert alert-warning" role="alert">
            You do not have access to update PIS values.
          </div>
        )}

        <div className="card om-card mb-3">
          <div className="card-body">
            <div className="row g-2 align-items-end">
              <div className="col-md-4">
                <label className="form-label">Search (Code / Name / Description)</label>
                <input
                  type="text"
                  className="form-control"
                  value={searchInput}
                  list="pis-item-code-options"
                  placeholder="Search items"
                  onChange={(e) => {
                    setPage(1);
                    setSearchInput(e.target.value);
                  }}
                />
                <datalist id="pis-item-code-options">
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
                      <th>
                        <SortHeaderButton
                          label="Item Code"
                          isActive={sortBy === "code"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("code", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Description"
                          isActive={sortBy === "description"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("description", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Brand"
                          isActive={sortBy === "brand"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("brand", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Vendors"
                          isActive={sortBy === "vendors"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("vendors", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="PIS Net"
                          isActive={sortBy === "pisNet"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("pisNet", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="PIS Gross"
                          isActive={sortBy === "pisGross"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("pisGross", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="PIS Item LBH"
                          isActive={sortBy === "itemLbh"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("itemLbh", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="PIS Box LBH"
                          isActive={sortBy === "boxLbh"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("boxLbh", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="PIS CBM"
                          isActive={sortBy === "cbm"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("cbm", "desc")}
                        />
                      </th>
                      {canEditPis && <th>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.length === 0 && (
                      <tr>
                        <td colSpan={canEditPis ? "10" : "9"} className="text-center py-4">
                          No items found
                        </td>
                      </tr>
                    )}
                    {sortedRows.map((item) => (
                      <tr key={item?._id || item?.code}>
                        <td>{item?.code || "N/A"}</td>
                        <td>{item?.description || item?.name || "N/A"}</td>
                        <td>{getBrand(item) || "N/A"}</td>
                        <td>{getVendors(item)}</td>
                        <td>{formatFixedNumber(getPisWeight(item, "net"))}</td>
                        <td>{formatFixedNumber(getPisWeight(item, "gross"))}</td>
                        <td>{formatLbhValue(getPrimaryMeasurementLbh(item?.pis_item_sizes, item?.pis_item_LBH || {}), { fallback: "0.00 x 0.00 x 0.00" })}</td>
                        <td>{formatLbhValue(getPrimaryMeasurementLbh(item?.pis_box_sizes, item?.pis_box_LBH || {}), { fallback: "0.00 x 0.00 x 0.00" })}</td>
                        <td>{formatCbm(item?.cbm?.calculated_pis_total)}</td>
                        {canEditPis && (
                          <td>
                            <button
                              type="button"
                              className="btn btn-outline-primary btn-sm"
                              onClick={() => setSelectedItem(item)}
                            >
                              Update PIS
                            </button>
                          </td>
                        )}
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

      {selectedItem && canEditPis && (
        <EditPisModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdated={() => {
            setSelectedItem(null);
            fetchItems();
          }}
        />
      )}

      {showUploadFinishModal && canEditPis && (
        <UploadFinishModal
          onClose={() => setShowUploadFinishModal(false)}
          onSaved={(message) => {
            setShowUploadFinishModal(false);
            setSuccess(message);
            fetchItems();
          }}
        />
      )}
    </>
  );
};

export default PIS;
