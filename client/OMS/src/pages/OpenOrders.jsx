import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import OrderExportModal from "../components/OrderExportModal";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const defaultFilters = {
  vendor: "all",
  brand: "all",
  status: "all",
  order: "",
  item_code: "",
};

const STATUS_SEQUENCE = [
  "Pending",
  "Under Inspection",
  "Inspection Done",
  "Partial Shipped",
  "Shipped",
];

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];
const DEFAULT_SORT_BY = "order_date";

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const normalizeFilterParam = (value, fallback = "all") => {
  const cleaned = String(value || "").trim();
  if (!cleaned) return fallback;
  return cleaned;
};

const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};

const parseSortBy = (value) => {
  const normalized = String(value || "").trim();
  const lowered = normalized.toLowerCase();
  if (lowered === "order_id") return "order_id";
  if (lowered === "order_date") return "order_date";
  if (lowered === "etd") return "ETD";
  return DEFAULT_SORT_BY;
};

const parseSortOrder = (value, sortBy) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "asc" || normalized === "desc") return normalized;
  return sortBy === "order_id" ? "asc" : "desc";
};

const normalizeStatus = (value) => {
  if (!value) return null;
  const cleaned = String(value).trim().toLowerCase();
  if (!cleaned) return null;

  if (cleaned === "finalized") return "Inspection Done";

  return (
    STATUS_SEQUENCE.find((status) => status.toLowerCase() === cleaned) || null
  );
};

const getStatus = (order) => {
  const incomingStatuses = Array.isArray(order?.statuses) && order.statuses.length > 0
    ? order.statuses
    : [order?.status];

  const normalizedUniqueStatuses = [
    ...new Set(incomingStatuses.map(normalizeStatus).filter(Boolean)),
  ];

  if (normalizedUniqueStatuses.length === 0) return "Pending";
  if (normalizedUniqueStatuses.length === 1) return normalizedUniqueStatuses[0];

  const indexes = normalizedUniqueStatuses.map((status) =>
    STATUS_SEQUENCE.indexOf(status),
  );
  const validIndexes = indexes.filter((index) => index >= 0);

  if (validIndexes.length === 0) return "Pending";

  const earliestStageIndex = Math.min(...validIndexes);
  return STATUS_SEQUENCE[earliestStageIndex];
};

const OpenOrders = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "open-orders");
  const initialSortBy = parseSortBy(searchParams.get("sort_by"));
  const initialSortOrder = parseSortOrder(
    searchParams.get("sort_order"),
    initialSortBy,
  );
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [sortBy, setSortBy] = useState(initialSortBy);
  const [sortOrder, setSortOrder] = useState(initialSortOrder);
  const [filters, setFilters] = useState(() => ({
    vendor: normalizeFilterParam(searchParams.get("vendor"), "all"),
    brand: normalizeFilterParam(searchParams.get("brand"), "all"),
    status: normalizeFilterParam(searchParams.get("status"), "all"),
    order: String(searchParams.get("order") || "").trim(),
    item_code: String(searchParams.get("item_code") || "").trim(),
  }));
  const [orderSearchInput, setOrderSearchInput] = useState(() =>
    String(searchParams.get("order") || "").trim(),
  );
  const [itemCodeSearchInput, setItemCodeSearchInput] = useState(() =>
    String(searchParams.get("item_code") || "").trim(),
  );
  const [filterOptions, setFilterOptions] = useState({
    vendors: [],
    brands: [],
    statuses: [],
    order_ids: [],
    item_codes: [],
  });
  const [showExportModal, setShowExportModal] = useState(false);
  const [syncedQuery, setSyncedQuery] = useState(null);

  const navigate = useNavigate();
  const token = localStorage.getItem("token");

  const statusOptions = useMemo(
    () =>
      Array.isArray(filterOptions.statuses) && filterOptions.statuses.length > 0
        ? filterOptions.statuses
        : STATUS_SEQUENCE,
    [filterOptions.statuses],
  );

  const getOrdersByFilters = useCallback(async () => {
    setLoading(true);

    try {
      const res = await axios.get("/orders/filters", {
        params: {
          vendor: filters.vendor,
          brand: filters.brand,
          status: filters.status,
          order: filters.order,
          item_code: filters.item_code,
          page,
          limit,
          sort_by: sortBy,
          sort_order: sortOrder,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      setOrders(res?.data?.data || []);
      setTotalPages(res?.data?.pagination?.totalPages || 1);
      setFilterOptions({
        vendors: Array.isArray(res?.data?.filters?.vendors)
          ? res.data.filters.vendors
          : [],
        brands: Array.isArray(res?.data?.filters?.brands)
          ? res.data.filters.brands
          : [],
        statuses: Array.isArray(res?.data?.filters?.statuses)
          ? res.data.filters.statuses
          : [],
        order_ids: Array.isArray(res?.data?.filters?.order_ids)
          ? res.data.filters.order_ids
          : [],
        item_codes: Array.isArray(res?.data?.filters?.item_codes)
          ? res.data.filters.item_codes
          : [],
      });
    } catch (err) {
      console.error(err);
      setOrders([]);
      setTotalPages(1);
      setFilterOptions({
        vendors: [],
        brands: [],
        statuses: [],
        order_ids: [],
        item_codes: [],
      });
    } finally {
      setLoading(false);
    }
  }, [
    filters.brand,
    filters.order,
    filters.item_code,
    filters.status,
    filters.vendor,
    limit,
    page,
    sortBy,
    sortOrder,
    token,
  ]);

  useEffect(() => {
    getOrdersByFilters();
  }, [getOrdersByFilters]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    const nextFilters = {
      vendor: normalizeFilterParam(searchParams.get("vendor"), "all"),
      brand: normalizeFilterParam(searchParams.get("brand"), "all"),
      status: normalizeFilterParam(searchParams.get("status"), "all"),
      order: String(searchParams.get("order") || "").trim(),
      item_code: String(searchParams.get("item_code") || "").trim(),
    };
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));
    const nextSortBy = parseSortBy(searchParams.get("sort_by"));
    const nextSortOrder = parseSortOrder(
      searchParams.get("sort_order"),
      nextSortBy,
    );

    setFilters((prev) =>
      prev.vendor === nextFilters.vendor
      && prev.brand === nextFilters.brand
      && prev.status === nextFilters.status
      && prev.order === nextFilters.order
      && prev.item_code === nextFilters.item_code
        ? prev
        : nextFilters,
    );
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
    setSortBy((prev) => (prev === nextSortBy ? prev : nextSortBy));
    setSortOrder((prev) => (prev === nextSortOrder ? prev : nextSortOrder));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (filters.vendor && filters.vendor !== "all") next.set("vendor", filters.vendor);
    if (filters.brand && filters.brand !== "all") next.set("brand", filters.brand);
    if (filters.status && filters.status !== "all") next.set("status", filters.status);
    if (filters.order) next.set("order", filters.order);
    if (filters.item_code) next.set("item_code", filters.item_code);
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));
    if (sortBy !== DEFAULT_SORT_BY) next.set("sort_by", sortBy);
    if (sortOrder !== parseSortOrder("", sortBy)) {
      next.set("sort_order", sortOrder);
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    filters.brand,
    filters.order,
    filters.item_code,
    filters.status,
    filters.vendor,
    limit,
    page,
    sortBy,
    sortOrder,
    searchParams,
    setSearchParams,
    syncedQuery,
  ]);

  useEffect(() => {
    setOrderSearchInput(filters.order || "");
    setItemCodeSearchInput(filters.item_code || "");
  }, [filters.item_code, filters.order]);

  const updatePage = (nextPage) => {
    if (nextPage < 1 || nextPage > totalPages) return;
    setPage(nextPage);
  };

  const handleSortColumn = (column, defaultDirection = "asc") => {
    setPage(1);
    if (sortBy === column) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortOrder(defaultDirection);
  };

  const sortIndicator = (column) => {
    if (sortBy !== column) return "";
    return sortOrder === "asc" ? " (asc)" : " (desc)";
  };

  const clearFilter = (e) => {
    e.preventDefault();
    setPage(1);
    setSortBy(DEFAULT_SORT_BY);
    setSortOrder("desc");
    setOrderSearchInput("");
    setItemCodeSearchInput("");
    setFilters(defaultFilters);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setFilters((prev) => ({
      ...prev,
      order: String(orderSearchInput || "").trim(),
      item_code: String(itemCodeSearchInput || "").trim(),
    }));
  };

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigate(-1)}>
            Back
          </button>
          <h2 className="h4 mb-0">Open Orders</h2>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={() => setShowExportModal(true)}
          >
            Export Orders
          </button>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Brand: {filters.brand || "all"}</span>
            <span className="om-summary-chip">Vendor: {filters.vendor || "all"}</span>
            <span className="om-summary-chip">Status: {filters.status || "all"}</span>
            <span className="om-summary-chip">Order: {filters.order || "all"}</span>
            <span className="om-summary-chip">Item: {filters.item_code || "all"}</span>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <form onSubmit={handleSearch} className="row g-2 align-items-end open-orders-filter-row">
              <div className="col-xl-2 col-lg-2 col-md-4">
                <label className="form-label">Vendor</label>
                <select
                  className="form-select"
                  value={filters.vendor}
                  onChange={(e) => {
                    setPage(1);
                    setFilters((prev) => ({ ...prev, vendor: e.target.value }));
                  }}
                >
                  <option value="all">Select Vendor</option>
                  {filterOptions.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-xl-2 col-lg-2 col-md-4">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={filters.brand}
                  onChange={(e) => {
                    setPage(1);
                    setFilters((prev) => ({ ...prev, brand: e.target.value }));
                  }}
                >
                  <option value="all">Select Brand</option>
                  {filterOptions.brands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-xl-2 col-lg-2 col-md-4">
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  value={filters.status}
                  onChange={(e) => {
                    setPage(1);
                    setFilters((prev) => ({ ...prev, status: e.target.value }));
                  }}
                >
                  <option value="all">Select Status</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-xl-2 col-lg-2 col-md-6">
                <label className="form-label">Order ID</label>
                <input
                  type="text"
                  name="search"
                  className="form-control"
                  placeholder="Order ID"
                  list="open-order-id-options"
                  value={orderSearchInput}
                  onChange={(e) => setOrderSearchInput(e.target.value)}
                />
                <datalist id="open-order-id-options">
                  {filterOptions.order_ids.map((orderId) => (
                    <option key={orderId} value={orderId} />
                  ))}
                </datalist>
              </div>

              <div className="col-xl-2 col-lg-2 col-md-6">
                <label className="form-label">Item Code</label>
                <input
                  type="text"
                  name="item_code"
                  className="form-control"
                  placeholder="Item Code"
                  list="open-item-code-options"
                  value={itemCodeSearchInput}
                  onChange={(e) => setItemCodeSearchInput(e.target.value)}
                />
                <datalist id="open-item-code-options">
                  {filterOptions.item_codes.map((itemCode) => (
                    <option key={itemCode} value={itemCode} />
                  ))}
                </datalist>
              </div>

              <div className="col-xl-2 col-lg-2 col-md-12">
                <div className="open-orders-filter-actions">
                  <button type="submit" className="btn btn-primary">
                    Search
                  </button>
                  <button
                    type="button"
                    onClick={clearFilter}
                    className="btn btn-outline-secondary"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>

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
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("order_id", "asc")}
                        >
                          Order ID{sortIndicator("order_id")}
                        </button>
                      </th>
                      <th>Brand</th>
                      <th>Vendor</th>
                      <th>Status</th>
                      <th>Items</th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("order_date", "desc")}
                        >
                          Order Date{sortIndicator("order_date")}
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("ETD", "desc")}
                        >
                          ETD{sortIndicator("ETD")}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.length === 0 && (
                      <tr>
                        <td colSpan="7" className="text-center py-4">
                          No orders found
                        </td>
                      </tr>
                    )}

                    {orders.map((order) => (
                      <tr
                        key={`${order._id || order.order_id}-${order.order_date || ""}`}
                        className="table-clickable"
                        onClick={() => navigate(`/orders?order_id=${order.order_id}`)}
                      >
                        <td>{order.order_id}</td>
                        <td>{order.brand}</td>
                        <td>{order.vendor}</td>
                        <td>{getStatus(order)}</td>
                        <td>{order.items}</td>
                        <td>{formatDateDDMMYYYY(order.order_date)}</td>
                        <td>{formatDateDDMMYYYY(order.ETD)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="d-flex justify-content-center align-items-center gap-3 mt-3">
          <button type="button" className="btn btn-outline-secondary btn-sm" disabled={page === 1} onClick={() => updatePage(page - 1)}>
            Prev
          </button>
          <span className="small fw-semibold">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page >= totalPages}
            onClick={() => updatePage(page + 1)}
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

      {showExportModal && (
        <OrderExportModal
          onClose={() => setShowExportModal(false)}
          filterOptions={filterOptions}
          statusOptions={statusOptions}
          defaultFilters={filters}
        />
      )}
    </>
  );
};

export default OpenOrders;
