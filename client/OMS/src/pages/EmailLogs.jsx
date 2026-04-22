import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import EmailLogsModal from "../components/EmailLogsModal";
import SortHeaderButton from "../components/SortHeaderButton";
import api from "../api/axios";
import { getUserFromToken } from "../auth/auth.utils";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_LIMIT = 30;
const LIMIT_OPTIONS = [7, 30, 50, 90];

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

const EmailLogs = () => {
  const navigate = useNavigate();
  const user = getUserFromToken();
  const normalizedRole = String(user?.role || "").trim().toLowerCase();
  const canManageEmailLogs = ["admin", "manager", "dev"].includes(normalizedRole);
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "email-logs");

  const [emailLogs, setEmailLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingLog, setEditingLog] = useState(null);
  const [deletingLogId, setDeletingLogId] = useState("");
  const [syncedQuery, setSyncedQuery] = useState(null);

  const [orderIdInput, setOrderIdInput] = useState(() =>
    normalizeSearchParam(searchParams.get("order_id")),
  );
  const [draftOrderIdInput, setDraftOrderIdInput] = useState(() =>
    normalizeSearchParam(searchParams.get("order_id")),
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
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [sortBy, setSortBy] = useState("creationDate");
  const [sortOrder, setSortOrder] = useState("desc");

  const [filterOptions, setFilterOptions] = useState({
    brands: [],
    vendors: [],
  });
  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    totalRecords: 0,
  });

  const fetchFilterOptions = useCallback(async () => {
    try {
      const response = await api.get("/email-logs/filters/options");
      if (response.data.success) {
        setFilterOptions(response.data.data);
      }
    } catch (err) {
      console.error("Error fetching filter options:", err);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const params = {
        page,
        limit,
      };
      if (orderIdInput) {
        params.order_id = orderIdInput;
      }
      if (brandFilter !== "all") {
        params.brand = brandFilter;
      }
      if (vendorFilter !== "all") {
        params.vendor = vendorFilter;
      }

      const response = await api.get("/email-logs", { params });

      if (response.data.success) {
        setEmailLogs(Array.isArray(response.data.data) ? response.data.data : []);
        const nextPage = Number(response?.data?.pagination?.page || 1);
        const nextTotalPages = Number(response?.data?.pagination?.totalPages || 1);
        const nextTotalRecords = Number(response?.data?.pagination?.totalRecords || 0);

        setPagination({
          page: nextPage,
          totalPages: nextTotalPages,
          totalRecords: nextTotalRecords,
        });
        setPage((prev) => (prev === nextPage ? prev : nextPage));
      } else {
        setEmailLogs([]);
        setPagination({
          page: 1,
          totalPages: 1,
          totalRecords: 0,
        });
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to fetch email logs");
      setEmailLogs([]);
      setPagination({
        page: 1,
        totalPages: 1,
        totalRecords: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [orderIdInput, brandFilter, limit, page, vendorFilter]);

  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextOrderIdInput = normalizeSearchParam(searchParams.get("order_id"));
    const nextBrandFilter = normalizeFilterParam(searchParams.get("brand"), "all");
    const nextVendorFilter = normalizeFilterParam(searchParams.get("vendor"), "all");
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setOrderIdInput((prev) => (prev === nextOrderIdInput ? prev : nextOrderIdInput));
    setDraftOrderIdInput((prev) => (prev === nextOrderIdInput ? prev : nextOrderIdInput));
    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setDraftBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setDraftVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    fetchLogs();
  }, [fetchLogs, searchParams, syncedQuery]);

  useEffect(() => {
    const next = new URLSearchParams();
    const orderIdValue = normalizeSearchParam(orderIdInput);

    if (orderIdValue) next.set("order_id", orderIdValue);
    if (brandFilter !== "all") next.set("brand", brandFilter);
    if (vendorFilter !== "all") next.set("vendor", vendorFilter);
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    limit,
    orderIdInput,
    page,
    searchParams,
    setSearchParams,
    vendorFilter,
  ]);

  const handleSearchChange = (e) => {
    setDraftOrderIdInput(e.target.value);
  };

  const handleBrandFilterChange = (e) => {
    setDraftBrandFilter(e.target.value);
  };

  const handleVendorFilterChange = (e) => {
    setDraftVendorFilter(e.target.value);
  };

  const handleApplyFilters = (event) => {
    event?.preventDefault();
    setPage(1);
    setOrderIdInput(normalizeSearchParam(draftOrderIdInput));
    setBrandFilter(normalizeFilterParam(draftBrandFilter, "all"));
    setVendorFilter(normalizeFilterParam(draftVendorFilter, "all"));
  };

  const handleClearFilters = () => {
    setPage(1);
    setDraftOrderIdInput("");
    setDraftBrandFilter("all");
    setDraftVendorFilter("all");
    setOrderIdInput("");
    setBrandFilter("all");
    setVendorFilter("all");
    setSuccess("");
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingLog(null);
  };

  const handleModalSuccess = (message) => {
    handleCloseModal();
    setSuccess(message || "Email log saved successfully.");
    fetchLogs();
    fetchFilterOptions();
  };

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

  const sortedEmailLogs = useMemo(
    () =>
      sortClientRows(emailLogs, {
        sortBy,
        sortOrder,
        getSortValue: (log, column) => {
          if (column === "creationDate") {
            return new Date(log?.creation_date || 0).getTime();
          }
          if (column === "orderId") return log?.order_id?.order_id;
          if (column === "brand") return log?.brand?.name;
          if (column === "vendor") return log?.vendor?.name;
          if (column === "logMatter") return log?.log;
          if (column === "createdBy") return log?.created_by?.name;
          return "";
        },
      }),
    [emailLogs, sortBy, sortOrder],
  );

  const handleOpenCreateModal = () => {
    if (!canManageEmailLogs) return;
    setEditingLog(null);
    setShowModal(true);
  };

  const handleOpenUpdateModal = (log) => {
    if (!canManageEmailLogs) return;
    setEditingLog(log);
    setShowModal(true);
  };

  const handleDeleteLog = useCallback(
    async (logId) => {
      if (!canManageEmailLogs || !logId) return;

      const confirmed = window.confirm(
        "Are you sure you want to delete this email log?",
      );
      if (!confirmed) return;

      try {
        setDeletingLogId(String(logId));
        setError("");
        setSuccess("");

        await api.delete(`/email-logs/${logId}`);

        setSuccess("Email log deleted successfully.");
        await fetchLogs();
        await fetchFilterOptions();
      } catch (err) {
        setError(err?.response?.data?.message || "Failed to delete email log.");
      } finally {
        setDeletingLogId("");
      }
    },
    [canManageEmailLogs, fetchFilterOptions, fetchLogs],
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
          <h2 className="h4 mb-0">Email Logs</h2>
          {canManageEmailLogs ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleOpenCreateModal}
            >
              Add Log
            </button>
          ) : (
            <span className="d-none d-md-inline" />
          )}
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <form className="row g-3" onSubmit={handleApplyFilters}>
              <div className="col-md-6">
                <label className="form-label">Search by PO Number</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Enter PO number..."
                  value={draftOrderIdInput}
                  onChange={handleSearchChange}
                  disabled={loading}
                />
              </div>

              <div className="col-md-2">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={draftBrandFilter}
                  onChange={handleBrandFilterChange}
                  disabled={loading}
                >
                  <option value="all">All Brands</option>
                  {filterOptions.brands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-md-2">
                <label className="form-label">Vendor</label>
                <select
                  className="form-select"
                  value={draftVendorFilter}
                  onChange={handleVendorFilterChange}
                  disabled={loading}
                >
                  <option value="all">All Vendors</option>
                  {filterOptions.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-md-2 d-flex gap-2">
                <button
                  type="submit"
                  className="btn btn-primary btn-sm align-self-end"
                  disabled={loading}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm align-self-end"
                  onClick={handleClearFilters}
                  disabled={loading}
                >
                  Clear
                </button>
              </div>
            </form>
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

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Total Logs: {pagination.totalRecords}</span>
            <span className="om-summary-chip">Limit: {limit}</span>
          </div>
        </div>

        <div className="card om-card">
          <div className="card-body p-0">
            {loading && emailLogs.length === 0 ? (
              <div className="text-center py-6">
                <div className="spinner-border" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
              </div>
            ) : emailLogs.length === 0 ? (
              <div className="text-center py-4 text-secondary">
                No email logs found.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm table-striped align-middle mb-0">
                  <thead>
                    <tr>
                      <th>
                        <SortHeaderButton
                          label="Creation Date"
                          isActive={sortBy === "creationDate"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("creationDate", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="PO Number"
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
                          label="Log Matter"
                          isActive={sortBy === "logMatter"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("logMatter", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Created By"
                          isActive={sortBy === "createdBy"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("createdBy", "asc")}
                        />
                      </th>
                      {canManageEmailLogs && <th>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEmailLogs.map((log) => (
                      <tr key={log._id}>
                        <td>{formatDateDDMMYYYY(log.creation_date) || "-"}</td>
                        <td>{log.order_id?.order_id || "-"}</td>
                        <td>{log.brand?.name || "-"}</td>
                        <td>{log.vendor?.name || "-"}</td>
                        <td>
                          <div className="text-truncate" title={log.log}>
                            {log.log || "-"}
                          </div>
                        </td>
                        <td>{log.created_by?.name || "-"}</td>
                        {canManageEmailLogs && (
                          <td>
                            <div className="d-flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="btn btn-outline-primary btn-sm"
                                onClick={() => handleOpenUpdateModal(log)}
                                disabled={loading || deletingLogId === String(log._id)}
                              >
                                Update
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline-danger btn-sm"
                                onClick={() => handleDeleteLog(log._id)}
                                disabled={loading || deletingLogId === String(log._id)}
                              >
                                {deletingLogId === String(log._id) ? "Deleting..." : "Delete"}
                              </button>
                            </div>
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
            disabled={page <= 1 || loading}
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
            disabled={page >= pagination.totalPages || loading}
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
              disabled={loading}
            >
              <option value={7}>7</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
              <option value={90}>90</option>
            </select>
          </div>
        </div>
      </div>

      {showModal && canManageEmailLogs && (
        <EmailLogsModal
          onClose={handleCloseModal}
          onSuccess={handleModalSuccess}
          mode={editingLog ? "update" : "create"}
          record={editingLog}
        />
      )}
    </>
  );
};

export default EmailLogs;
