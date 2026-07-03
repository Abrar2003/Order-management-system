import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import SortHeaderButton from "../components/SortHeaderButton";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];
const OPERATION_LABELS = {
  pis_update: "PIS Update",
  pis_diff_update: "PIS Diff Update",
  pis_database_sync: "PIS Database Sync",
  product_database_update: "Product Database Update",
  product_database_check: "Product Database Check",
  product_database_approve: "Product Database Approve",
  master_update: "Master Update",
};
const DATA_SCOPE_OPTIONS = ["PIS", "PD", "Master", "Item"];
const OPERATION_OPTIONS = Object.keys(OPERATION_LABELS);

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
  return cleaned || fallback;
};

const normalizeSearchParam = (value) => String(value || "").trim();

const formatArray = (values = [], fallback = "N/A") => {
  const cleaned = (Array.isArray(values) ? values : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned.join(", ") : fallback;
};

const formatOperation = (value = "") => OPERATION_LABELS[value] || value || "N/A";

const PisUpdateLogs = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "pis-update-logs");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState(() =>
    normalizeSearchParam(searchParams.get("search")),
  );
  const [draftSearchInput, setDraftSearchInput] = useState(() =>
    normalizeSearchParam(searchParams.get("search")),
  );
  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("brand"), "all"),
  );
  const [draftBrandFilter, setDraftBrandFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("brand"), "all"),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [draftVendorFilter, setDraftVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [scopeFilter, setScopeFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("data_scope"), "all"),
  );
  const [draftScopeFilter, setDraftScopeFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("data_scope"), "all"),
  );
  const [operationFilter, setOperationFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("operation_type"), "all"),
  );
  const [draftOperationFilter, setDraftOperationFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("operation_type"), "all"),
  );
  const [missingOnly, setMissingOnly] = useState(
    () => searchParams.get("missing_only") === "true",
  );
  const [draftMissingOnly, setDraftMissingOnly] = useState(
    () => searchParams.get("missing_only") === "true",
  );
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [sortBy, setSortBy] = useState("updatedAt");
  const [sortOrder, setSortOrder] = useState("desc");
  const [filters, setFilters] = useState({
    brands: [],
    vendors: [],
    data_scopes: [],
    operation_types: [],
  });
  const [summary, setSummary] = useState({
    total_logs: 0,
    total_field_changes: 0,
    total_missing_fields: 0,
  });
  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    totalRecords: 0,
  });

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await api.get("/items/pis-update-logs", {
        params: {
          page,
          limit,
          search: searchInput,
          brand: brandFilter,
          vendor: vendorFilter,
          data_scope: scopeFilter,
          operation_type: operationFilter,
          missing_only: missingOnly ? "true" : "",
        },
      });
      const payload = response?.data || {};

      setRows(Array.isArray(payload?.data) ? payload.data : []);
      setFilters({
        brands: Array.isArray(payload?.filters?.brands) ? payload.filters.brands : [],
        vendors: Array.isArray(payload?.filters?.vendors) ? payload.filters.vendors : [],
        data_scopes: Array.isArray(payload?.filters?.data_scopes)
          ? payload.filters.data_scopes
          : [],
        operation_types: Array.isArray(payload?.filters?.operation_types)
          ? payload.filters.operation_types
          : [],
      });
      setSummary({
        total_logs: Number(payload?.summary?.total_logs || 0),
        total_field_changes: Number(payload?.summary?.total_field_changes || 0),
        total_missing_fields: Number(payload?.summary?.total_missing_fields || 0),
      });
      setPagination({
        page: Number(payload?.pagination?.page || 1),
        totalPages: Number(payload?.pagination?.totalPages || 1),
        totalRecords: Number(payload?.pagination?.totalRecords || 0),
      });
    } catch (fetchError) {
      setRows([]);
      setError(fetchError?.response?.data?.message || "Failed to fetch PIS update logs.");
      setSummary({
        total_logs: 0,
        total_field_changes: 0,
        total_missing_fields: 0,
      });
      setPagination({ page: 1, totalPages: 1, totalRecords: 0 });
    } finally {
      setLoading(false);
    }
  }, [
    brandFilter,
    limit,
    missingOnly,
    operationFilter,
    page,
    scopeFilter,
    searchInput,
    vendorFilter,
  ]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextSearchInput = normalizeSearchParam(searchParams.get("search"));
    const nextBrandFilter = normalizeFilterParam(searchParams.get("brand"), "all");
    const nextVendorFilter = normalizeFilterParam(searchParams.get("vendor"), "all");
    const nextScopeFilter = normalizeFilterParam(searchParams.get("data_scope"), "all");
    const nextOperationFilter = normalizeFilterParam(
      searchParams.get("operation_type"),
      "all",
    );
    const nextMissingOnly = searchParams.get("missing_only") === "true";
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setSearchInput((prev) => (prev === nextSearchInput ? prev : nextSearchInput));
    setDraftSearchInput((prev) => (prev === nextSearchInput ? prev : nextSearchInput));
    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setDraftBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setDraftVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setScopeFilter((prev) => (prev === nextScopeFilter ? prev : nextScopeFilter));
    setDraftScopeFilter((prev) => (prev === nextScopeFilter ? prev : nextScopeFilter));
    setOperationFilter((prev) =>
      (prev === nextOperationFilter ? prev : nextOperationFilter));
    setDraftOperationFilter((prev) =>
      (prev === nextOperationFilter ? prev : nextOperationFilter));
    setMissingOnly((prev) => (prev === nextMissingOnly ? prev : nextMissingOnly));
    setDraftMissingOnly((prev) => (prev === nextMissingOnly ? prev : nextMissingOnly));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (searchInput) next.set("search", searchInput);
    if (brandFilter && brandFilter !== "all") next.set("brand", brandFilter);
    if (vendorFilter && vendorFilter !== "all") next.set("vendor", vendorFilter);
    if (scopeFilter && scopeFilter !== "all") next.set("data_scope", scopeFilter);
    if (operationFilter && operationFilter !== "all") {
      next.set("operation_type", operationFilter);
    }
    if (missingOnly) next.set("missing_only", "true");
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    limit,
    missingOnly,
    operationFilter,
    page,
    scopeFilter,
    searchInput,
    searchParams,
    setSearchParams,
    syncedQuery,
    vendorFilter,
  ]);

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

  const handleApplyFilters = useCallback((event) => {
    event?.preventDefault();
    setPage(1);
    setSearchInput(normalizeSearchParam(draftSearchInput));
    setBrandFilter(normalizeFilterParam(draftBrandFilter, "all"));
    setVendorFilter(normalizeFilterParam(draftVendorFilter, "all"));
    setScopeFilter(normalizeFilterParam(draftScopeFilter, "all"));
    setOperationFilter(normalizeFilterParam(draftOperationFilter, "all"));
    setMissingOnly(Boolean(draftMissingOnly));
  }, [
    draftBrandFilter,
    draftMissingOnly,
    draftOperationFilter,
    draftScopeFilter,
    draftSearchInput,
    draftVendorFilter,
  ]);

  const handleClearFilters = useCallback(() => {
    setPage(1);
    setDraftSearchInput("");
    setDraftBrandFilter("all");
    setDraftVendorFilter("all");
    setDraftScopeFilter("all");
    setDraftOperationFilter("all");
    setDraftMissingOnly(false);
    setSearchInput("");
    setBrandFilter("all");
    setVendorFilter("all");
    setScopeFilter("all");
    setOperationFilter("all");
    setMissingOnly(false);
  }, []);

  const sortedRows = useMemo(
    () =>
      sortClientRows(rows, {
        sortBy,
        sortOrder,
        getSortValue: (log, column) => {
          if (column === "updatedAt") return new Date(log?.createdAt || 0).getTime();
          if (column === "user") return log?.edited_by_name;
          if (column === "item") return log?.item_code;
          if (column === "brand") return log?.brand;
          if (column === "vendor") return formatArray(log?.vendors, "");
          if (column === "page") return log?.page_name;
          if (column === "type") return formatOperation(log?.operation_type);
          if (column === "scope") return formatArray(log?.data_scope, "");
          if (column === "changed") return Number(log?.changed_fields_count || 0);
          if (column === "missing") return Number(log?.missing_fields_count || 0);
          return "";
        },
      }),
    [rows, sortBy, sortOrder],
  );

  return (
    <>
      <Navbar />

      <div className="page-shell py-3 pis-update-logs-page oms-responsive-list-page">
        <div className="d-flex justify-content-between align-items-center mb-3 gap-3 flex-wrap oms-responsive-page-header">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(-1)}
          >
            Back
          </button>
          <h2 className="h4 mb-0">PIS Update Logs</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <form className="row g-2 align-items-end" onSubmit={handleApplyFilters}>
              <div className="col-lg-3 col-md-6">
                <label className="form-label">Search</label>
                <input
                  type="text"
                  className="form-control"
                  value={draftSearchInput}
                  placeholder="Item code, name, description"
                  onChange={(event) => setDraftSearchInput(event.target.value)}
                />
              </div>
              <div className="col-lg-2 col-md-6">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={draftBrandFilter}
                  onChange={(event) => setDraftBrandFilter(event.target.value)}
                >
                  <option value="all">All Brands</option>
                  {filters.brands.map((brand) => (
                    <option key={brand} value={brand}>{brand}</option>
                  ))}
                </select>
              </div>
              <div className="col-lg-2 col-md-6">
                <label className="form-label">Vendor</label>
                <select
                  className="form-select"
                  value={draftVendorFilter}
                  onChange={(event) => setDraftVendorFilter(event.target.value)}
                >
                  <option value="all">All Vendors</option>
                  {filters.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>{vendor}</option>
                  ))}
                </select>
              </div>
              <div className="col-lg-2 col-md-6">
                <label className="form-label">Data</label>
                <select
                  className="form-select"
                  value={draftScopeFilter}
                  onChange={(event) => setDraftScopeFilter(event.target.value)}
                >
                  <option value="all">All Data</option>
                  {[...new Set([...DATA_SCOPE_OPTIONS, ...filters.data_scopes])].map((scope) => (
                    <option key={scope} value={scope}>{scope}</option>
                  ))}
                </select>
              </div>
              <div className="col-lg-2 col-md-6">
                <label className="form-label">Type</label>
                <select
                  className="form-select"
                  value={draftOperationFilter}
                  onChange={(event) => setDraftOperationFilter(event.target.value)}
                >
                  <option value="all">All Types</option>
                  {[...new Set([...OPERATION_OPTIONS, ...filters.operation_types])].map((operationType) => (
                    <option key={operationType} value={operationType}>
                      {formatOperation(operationType)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-lg-1 col-md-6">
                <div className="form-check mb-2">
                  <input
                    id="pis-update-missing-only"
                    type="checkbox"
                    className="form-check-input"
                    checked={draftMissingOnly}
                    onChange={(event) => setDraftMissingOnly(event.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="pis-update-missing-only">
                    Missing
                  </label>
                </div>
                <div className="d-grid gap-2">
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    Apply
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={handleClearFilters}
                    disabled={loading}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Total Logs: {summary.total_logs}</span>
            <span className="om-summary-chip">
              Field Changes: {summary.total_field_changes}
            </span>
            <span className="om-summary-chip">
              Missing Fields: {summary.total_missing_fields}
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
              <div className="table-responsive responsive-table-shell">
                <table className="table table-striped table-hover align-middle om-table responsive-card-table pis-update-logs-table mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>
                        <SortHeaderButton
                          label="Updated"
                          isActive={sortBy === "updatedAt"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("updatedAt", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="User"
                          isActive={sortBy === "user"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("user", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Item"
                          isActive={sortBy === "item"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("item", "asc")}
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
                          label="Vendor"
                          isActive={sortBy === "vendor"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("vendor", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Page"
                          isActive={sortBy === "page"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("page", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Type"
                          isActive={sortBy === "type"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("type", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Data"
                          isActive={sortBy === "scope"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("scope", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Changed"
                          isActive={sortBy === "changed"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("changed", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Missing"
                          isActive={sortBy === "missing"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("missing", "desc")}
                        />
                      </th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.length === 0 && (
                      <tr className="responsive-card-table-empty-row">
                        <td colSpan="11" className="text-center py-4">
                          No PIS update logs found
                        </td>
                      </tr>
                    )}

                    {sortedRows.map((log) => {
                      const changes = Array.isArray(log?.changes) ? log.changes : [];
                      const missingFields = Array.isArray(log?.missing_fields)
                        ? log.missing_fields
                        : [];
                      return (
                        <tr key={log?._id || `${log?.createdAt || ""}-${log?.item_code || ""}`}>
                          <td data-label="Updated">{formatDateDDMMYYYY(log?.createdAt)}</td>
                          <td data-label="User">{log?.edited_by_name || "N/A"}</td>
                          <td data-label="Item">
                            <div className="fw-semibold">{log?.item_code || "N/A"}</div>
                            <div className="small text-secondary">
                              {log?.description || log?.item_name || "N/A"}
                            </div>
                          </td>
                          <td data-label="Brand">{log?.brand || "N/A"}</td>
                          <td data-label="Vendor">{formatArray(log?.vendors)}</td>
                          <td data-label="Page">{log?.page_name || "N/A"}</td>
                          <td data-label="Type">{formatOperation(log?.operation_type)}</td>
                          <td data-label="Data">{formatArray(log?.data_scope)}</td>
                          <td data-label="Changed">{Number(log?.changed_fields_count || changes.length || 0)}</td>
                          <td data-label="Missing">{Number(log?.missing_fields_count || missingFields.length || 0)}</td>
                          <td data-label="Details">
                            {changes.length > 0 || missingFields.length > 0 ? (
                              <details>
                                <summary>View</summary>
                                <div className="small mt-2 d-grid gap-2">
                                  {changes.length > 0 && (
                                    <div>
                                      <div className="fw-semibold mb-1">Changed Fields</div>
                                      <div className="d-grid gap-1">
                                        {changes.map((entry, index) => (
                                          <div
                                            key={`${log?._id || "log"}-change-${entry?.field || index}`}
                                          >
                                            <strong>
                                              {entry?.scope ? `${entry.scope} ` : ""}
                                              {entry?.field || `Field ${index + 1}`}:
                                            </strong>{" "}
                                            {entry?.before || "Not Set"} {"->"}{" "}
                                            {entry?.after || "Not Set"}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {missingFields.length > 0 && (
                                    <div>
                                      <div className="fw-semibold mb-1">Missing Fields</div>
                                      <div className="d-flex flex-wrap gap-1">
                                        {missingFields.map((entry, index) => (
                                          <span
                                            key={`${log?._id || "log"}-missing-${entry?.field || index}`}
                                            className="badge text-bg-warning"
                                          >
                                            {entry?.scope ? `${entry.scope}: ` : ""}
                                            {entry?.label || entry?.field || `Field ${index + 1}`}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </details>
                            ) : (
                              "N/A"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="d-flex justify-content-center align-items-center gap-3 mt-3 oms-responsive-pagination">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Prev
          </button>
          <span className="small fw-semibold">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((prev) => Math.min(pagination.totalPages, prev + 1))}
          >
            Next
          </button>
        </div>

        <div className="d-flex justify-content-end mt-3 oms-responsive-limit-row">
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
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </>
  );
};

export default PisUpdateLogs;
