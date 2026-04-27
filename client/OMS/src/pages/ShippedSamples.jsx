import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import SortHeaderButton from "../components/SortHeaderButton";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import { formatCbm } from "../utils/cbm";
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

const normalizeSearchParam = (value) => String(value || "").trim();

const normalizeFilterParam = (value, fallback = "all") => {
  const cleaned = String(value || "").trim();
  if (!cleaned) return fallback;
  return cleaned;
};

const ShippedSamples = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "shipped-samples");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState(() =>
    normalizeSearchParam(searchParams.get("search")),
  );
  const [draftSearchInput, setDraftSearchInput] = useState(() =>
    normalizeSearchParam(searchParams.get("search")),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [draftVendorFilter, setDraftVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [containerFilter, setContainerFilter] = useState(() =>
    normalizeSearchParam(searchParams.get("container")),
  );
  const [draftContainerFilter, setDraftContainerFilter] = useState(() =>
    normalizeSearchParam(searchParams.get("container")),
  );
  const [sortBy, setSortBy] = useState("stuffing_date");
  const [sortOrder, setSortOrder] = useState("desc");
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [summary, setSummary] = useState({ total: 0, total_quantity: 0, checked: 0 });
  const [filters, setFilters] = useState({
    vendors: [],
    containers: [],
    sample_codes: [],
  });
  const [syncedQuery, setSyncedQuery] = useState(null);

  const fetchRows = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await api.get("/samples/shipped", {
        params: {
          search: searchInput,
          vendor: vendorFilter,
          container: containerFilter,
          page,
          limit,
        },
      });

      setRows(Array.isArray(response?.data?.data) ? response.data.data : []);
      setPage(Math.max(1, Number(response?.data?.pagination?.page || 1)));
      setTotalPages(Math.max(1, Number(response?.data?.pagination?.totalPages || 1)));
      setTotalRecords(Number(response?.data?.pagination?.totalRecords || 0));
      setSummary(response?.data?.summary || { total: 0, total_quantity: 0, checked: 0 });
      setFilters({
        vendors: Array.isArray(response?.data?.filters?.vendors)
          ? response.data.filters.vendors
          : [],
        containers: Array.isArray(response?.data?.filters?.containers)
          ? response.data.filters.containers
          : [],
        sample_codes: Array.isArray(response?.data?.filters?.sample_codes)
          ? response.data.filters.sample_codes
          : [],
      });
    } catch (fetchError) {
      setRows([]);
      setTotalPages(1);
      setTotalRecords(0);
      setSummary({ total: 0, total_quantity: 0, checked: 0 });
      setFilters({ vendors: [], containers: [], sample_codes: [] });
      setError(
        fetchError?.response?.data?.message || "Failed to load shipped samples.",
      );
    } finally {
      setLoading(false);
    }
  }, [containerFilter, limit, page, searchInput, vendorFilter]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextSearch = normalizeSearchParam(searchParams.get("search"));
    const nextVendor = normalizeFilterParam(searchParams.get("vendor"), "all");
    const nextContainer = normalizeSearchParam(searchParams.get("container"));
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setSearchInput((prev) => (prev === nextSearch ? prev : nextSearch));
    setDraftSearchInput((prev) => (prev === nextSearch ? prev : nextSearch));
    setVendorFilter((prev) => (prev === nextVendor ? prev : nextVendor));
    setDraftVendorFilter((prev) => (prev === nextVendor ? prev : nextVendor));
    setContainerFilter((prev) => (prev === nextContainer ? prev : nextContainer));
    setDraftContainerFilter((prev) => (prev === nextContainer ? prev : nextContainer));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    const searchValue = normalizeSearchParam(searchInput);
    const containerValue = normalizeSearchParam(containerFilter);

    if (searchValue) next.set("search", searchValue);
    if (vendorFilter && vendorFilter !== "all") next.set("vendor", vendorFilter);
    if (containerValue) next.set("container", containerValue);
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    containerFilter,
    limit,
    page,
    searchInput,
    searchParams,
    setSearchParams,
    syncedQuery,
    vendorFilter,
  ]);

  const handleApplyFilters = (event) => {
    event?.preventDefault();
    setPage(1);
    setSearchInput(normalizeSearchParam(draftSearchInput));
    setVendorFilter(normalizeFilterParam(draftVendorFilter, "all"));
    setContainerFilter(normalizeSearchParam(draftContainerFilter));
  };

  const handleClearFilters = () => {
    setPage(1);
    setDraftSearchInput("");
    setDraftVendorFilter("all");
    setDraftContainerFilter("");
    setSearchInput("");
    setVendorFilter("all");
    setContainerFilter("");
  };

  const handleSortColumn = (column, defaultDirection = "asc") => {
    if (sortBy === column) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortOrder(defaultDirection);
  };

  const sortedRows = useMemo(() => {
    const rowsCopy = [...rows];
    rowsCopy.sort((left, right) => {
      const leftValue =
        columnValue(left, sortBy);
      const rightValue =
        columnValue(right, sortBy);

      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * (sortOrder === "asc" ? 1 : -1);
      }

      return String(leftValue || "").localeCompare(String(rightValue || ""))
        * (sortOrder === "asc" ? 1 : -1);
    });
    return rowsCopy;
  }, [rows, sortBy, sortOrder]);

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
          <h2 className="h4 mb-0">Shipped Samples</h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={fetchRows}
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <form className="row g-2 align-items-end" onSubmit={handleApplyFilters}>
              <div className="col-md-4">
                <label className="form-label">Search Sample</label>
                <input
                  type="text"
                  className="form-control"
                  list="shipped-sample-code-options"
                  value={draftSearchInput}
                  onChange={(event) => setDraftSearchInput(event.target.value)}
                  placeholder="Code, name, description, or Sample"
                />
                <datalist id="shipped-sample-code-options">
                  {filters.sample_codes.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
              </div>
              <div className="col-md-3">
                <label className="form-label">Filter by Vendor</label>
                <select
                  className="form-select"
                  value={draftVendorFilter}
                  onChange={(event) => setDraftVendorFilter(event.target.value)}
                >
                  <option value="all">All Vendors</option>
                  {filters.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-3">
                <label className="form-label">Filter by Container</label>
                <input
                  type="text"
                  className="form-control"
                  list="shipped-sample-container-options"
                  value={draftContainerFilter}
                  onChange={(event) => setDraftContainerFilter(event.target.value)}
                  placeholder="Enter container number"
                />
                <datalist id="shipped-sample-container-options">
                  {filters.containers.map((container) => (
                    <option key={container} value={container} />
                  ))}
                </datalist>
              </div>
              <div className="col-md-2 d-flex gap-2">
                <button type="submit" className="btn btn-primary flex-fill">
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary flex-fill"
                  onClick={handleClearFilters}
                >
                  Clear
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Total Rows: {summary.total ?? 0}</span>
            <span className="om-summary-chip">Total Quantity: {summary.total_quantity ?? 0}</span>
            <span className="om-summary-chip">Checked: {summary.checked ?? 0}</span>
            <span className="om-summary-chip">Total Records: {totalRecords}</span>
          </div>
        </div>

        {error && <div className="alert alert-danger mb-3">{error}</div>}

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
                          label="Sample"
                          isActive={sortBy === "sample"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("sample", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Vendor"
                          isActive={sortBy === "vendor"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("vendor", "asc")}
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
                      <th>Description</th>
                      <th>
                        <SortHeaderButton
                          label="Quantity"
                          isActive={sortBy === "quantity"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("quantity", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Container"
                          isActive={sortBy === "container"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("container", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Shipment Date"
                          isActive={sortBy === "stuffing_date"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("stuffing_date", "desc")}
                        />
                      </th>
                      <th>Status</th>
                      <th>Stuffed CBM</th>
                      <th>
                        <SortHeaderButton
                          label="Updated"
                          isActive={sortBy === "updatedAt"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("updatedAt", "desc")}
                        />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.length === 0 ? (
                      <tr>
                        <td colSpan="10" className="text-center py-4">
                          No shipped samples found
                        </td>
                      </tr>
                    ) : (
                      sortedRows.map((row) => (
                        <tr key={row.shipment_id || `${row._id}-${row.container}`}>
                          <td>{row.sample_code || row.item_code || "N/A"}</td>
                          <td>{row.vendor || "N/A"}</td>
                          <td>{row.brand || "N/A"}</td>
                          <td>{row.description || row.sample_name || "N/A"}</td>
                          <td>{row.quantity ?? 0}</td>
                          <td>{row.container || "N/A"}</td>
                          <td>{formatDateDDMMYYYY(row.stuffing_date)}</td>
                          <td>{row.shipment_checked ? "Checked" : "Shipped"}</td>
                          <td>{formatCbm(row.shipment_cbm)}</td>
                          <td>{formatDateDDMMYYYY(row.updatedAt)}</td>
                        </tr>
                      ))
                    )}
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
            disabled={page <= 1 || loading}
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
            disabled={page >= totalPages || loading}
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
              onChange={(event) => {
                setPage(1);
                setLimit(Number(event.target.value));
              }}
            >
              {LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </>
  );
};

const columnValue = (row = {}, sortBy = "") => {
  switch (sortBy) {
    case "sample":
      return row?.sample_code || row?.item_code || "";
    case "vendor":
      return row?.vendor || "";
    case "brand":
      return row?.brand || "";
    case "quantity":
      return Number(row?.quantity || 0);
    case "container":
      return row?.container || "";
    case "stuffing_date":
      return new Date(row?.stuffing_date || 0).getTime();
    case "updatedAt":
      return new Date(row?.updatedAt || 0).getTime();
    default:
      return row?.sample_code || row?.item_code || "";
  }
};

export default ShippedSamples;
