import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import SortHeaderButton from "../components/SortHeaderButton";
import { getOrderEditLogs } from "../services/orders.service";
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
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
};

const OPERATION_LABELS = {
  order_edit: "Order Edit",
  order_edit_archive: "Archived By Edit",
};

const OrderEditLogs = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "order-edit-logs");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("brand"), "all"),
  );
  const [operationFilter, setOperationFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("operation_type"), "all"),
  );
  const [orderIdInput, setOrderIdInput] = useState(() =>
    normalizeSearchParam(searchParams.get("order_id")),
  );
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [sortBy, setSortBy] = useState("editedAt");
  const [sortOrder, setSortOrder] = useState("desc");

  const [filters, setFilters] = useState({
    brands: [],
    vendors: [],
    operation_types: [],
  });

  const [summary, setSummary] = useState({
    total_logs: 0,
    total_field_changes: 0,
  });

  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    totalRecords: 0,
  });

  const debouncedOrderId = useDebouncedValue(orderIdInput, 300);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await getOrderEditLogs({
        page,
        limit,
        brand: brandFilter,
        vendor: vendorFilter,
        operation_type: operationFilter,
        order_id: debouncedOrderId,
      });

      setRows(Array.isArray(res?.data) ? res.data : []);
      setFilters({
        brands: Array.isArray(res?.filters?.brands) ? res.filters.brands : [],
        vendors: Array.isArray(res?.filters?.vendors) ? res.filters.vendors : [],
        operation_types: Array.isArray(res?.filters?.operation_types)
          ? res.filters.operation_types
          : [],
      });
      setSummary({
        total_logs: Number(res?.summary?.total_logs || 0),
        total_field_changes: Number(res?.summary?.total_field_changes || 0),
      });
      setPagination({
        page: Number(res?.pagination?.page || 1),
        totalPages: Number(res?.pagination?.totalPages || 1),
        totalRecords: Number(res?.pagination?.totalRecords || 0),
      });
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to fetch order edit logs.");
      setRows([]);
      setSummary({
        total_logs: 0,
        total_field_changes: 0,
      });
      setPagination({
        page: 1,
        totalPages: 1,
        totalRecords: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [brandFilter, debouncedOrderId, limit, operationFilter, page, vendorFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextBrandFilter = normalizeFilterParam(searchParams.get("brand"), "all");
    const nextVendorFilter = normalizeFilterParam(searchParams.get("vendor"), "all");
    const nextOperationFilter = normalizeFilterParam(
      searchParams.get("operation_type"),
      "all",
    );
    const nextOrderIdInput = normalizeSearchParam(searchParams.get("order_id"));
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setOperationFilter((prev) =>
      (prev === nextOperationFilter ? prev : nextOperationFilter));
    setOrderIdInput((prev) => (prev === nextOrderIdInput ? prev : nextOrderIdInput));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    const orderIdValue = normalizeSearchParam(orderIdInput);

    if (orderIdValue) next.set("order_id", orderIdValue);
    if (brandFilter && brandFilter !== "all") next.set("brand", brandFilter);
    if (vendorFilter && vendorFilter !== "all") next.set("vendor", vendorFilter);
    if (operationFilter && operationFilter !== "all") {
      next.set("operation_type", operationFilter);
    }
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    limit,
    operationFilter,
    orderIdInput,
    page,
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

  const sortedRows = useMemo(
    () =>
      sortClientRows(rows, {
        sortBy,
        sortOrder,
        getSortValue: (log, column) => {
          const changes = Array.isArray(log?.changes) ? log.changes : [];
          const changedFields = Array.isArray(log?.changed_fields)
            ? log.changed_fields
            : [];
          const remarks = Array.isArray(log?.remarks) ? log.remarks : [];

          if (column === "editedAt") return new Date(log?.createdAt || 0).getTime();
          if (column === "editedBy") return log?.edited_by_name;
          if (column === "orderId") return log?.order_id;
          if (column === "brand") return log?.brand;
          if (column === "vendor") return log?.vendor;
          if (column === "type") {
            return OPERATION_LABELS[log?.operation_type] || log?.operation_type;
          }
          if (column === "changedCount") {
            return Number(log?.changed_fields_count || changes.length || 0);
          }
          if (column === "fieldsUpdated") return changedFields.join(", ");
          if (column === "remarks") return remarks.join(" | ");
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
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(-1)}
          >
            Back
          </button>
          <h2 className="h4 mb-0">Order Edit Logs</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <div className="row g-2 align-items-end">
              <div className="col-md-3">
                <label className="form-label">Order ID</label>
                <input
                  type="text"
                  className="form-control"
                  value={orderIdInput}
                  placeholder="Search order id"
                  onChange={(e) => {
                    setPage(1);
                    setOrderIdInput(e.target.value);
                  }}
                />
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
              <div className="col-md-2">
                <label className="form-label">Type</label>
                <select
                  className="form-select"
                  value={operationFilter}
                  onChange={(e) => {
                    setPage(1);
                    setOperationFilter(e.target.value);
                  }}
                >
                  <option value="all">All Types</option>
                  {filters.operation_types.map((operationType) => (
                    <option key={operationType} value={operationType}>
                      {OPERATION_LABELS[operationType] || operationType}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-1 d-grid">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    setPage(1);
                    setBrandFilter("all");
                    setVendorFilter("all");
                    setOperationFilter("all");
                    setOrderIdInput("");
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
            <span className="om-summary-chip">Total Logs: {summary.total_logs}</span>
            <span className="om-summary-chip">
              Total Field Changes: {summary.total_field_changes}
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
                      <th>
                        <SortHeaderButton
                          label="Edited At"
                          isActive={sortBy === "editedAt"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("editedAt", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Edited By"
                          isActive={sortBy === "editedBy"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("editedBy", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Order ID"
                          isActive={sortBy === "orderId"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("orderId", "asc")}
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
                          label="Type"
                          isActive={sortBy === "type"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("type", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Changed Fields"
                          isActive={sortBy === "changedCount"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("changedCount", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Fields Updated"
                          isActive={sortBy === "fieldsUpdated"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("fieldsUpdated", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Remarks"
                          isActive={sortBy === "remarks"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("remarks", "asc")}
                        />
                      </th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.length === 0 && (
                      <tr>
                        <td colSpan="10" className="text-center py-4">
                          No edit logs found
                        </td>
                      </tr>
                    )}

                    {sortedRows.map((log) => {
                      const changedFields = Array.isArray(log?.changed_fields)
                        ? log.changed_fields
                        : [];
                      const changes = Array.isArray(log?.changes) ? log.changes : [];
                      const remarks = Array.isArray(log?.remarks) ? log.remarks : [];
                      return (
                        <tr key={log?._id || `${log?.createdAt || ""}-${log?.order_id || ""}`}>
                          <td>{formatDateDDMMYYYY(log?.createdAt)}</td>
                          <td>{log?.edited_by_name || "N/A"}</td>
                          <td>{log?.order_id || "N/A"}</td>
                          <td>{log?.brand || "N/A"}</td>
                          <td>{log?.vendor || "N/A"}</td>
                          <td>
                            {OPERATION_LABELS[log?.operation_type] || log?.operation_type || "N/A"}
                          </td>
                          <td>{Number(log?.changed_fields_count || changes.length || 0)}</td>
                          <td>
                            {changedFields.length > 0
                              ? changedFields.join(", ")
                              : "No net changes"}
                          </td>
                          <td>
                            {remarks.length > 0
                              ? remarks.join(" | ")
                              : "N/A"}
                          </td>
                          <td>
                            {changes.length > 0 ? (
                              <details>
                                <summary>View</summary>
                                <div className="small mt-2 d-grid gap-1">
                                  {changes.map((entry, index) => (
                                    <div
                                      key={`${log?._id || "log"}-${entry?.field || "field"}-${index}`}
                                    >
                                      <strong>{entry?.field || `Field ${index + 1}`}:</strong>{" "}
                                      {String(entry?.before ?? "").trim() || "Not Set"} {"->"}{" "}
                                      {String(entry?.after ?? "").trim() || "Not Set"}
                                    </div>
                                  ))}
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

export default OrderEditLogs;
