import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import { useNavigate } from "react-router-dom";
import "../App.css";

const defaultFilters = {
  vendor: "all",
  brand: "all",
  status: "all",
  order: "",
};

const STATUS_SEQUENCE = [
  "Pending",
  "Under Inspection",
  "Inspection Done",
  "Partial Shipped",
  "Shipped",
];

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
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [filters, setFilters] = useState(defaultFilters);
  const [orderSearchInput, setOrderSearchInput] = useState("");
  const [filterOptions, setFilterOptions] = useState({
    vendors: [],
    brands: [],
    statuses: [],
    order_ids: [],
  });

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
          page,
          limit,
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
      });
    } finally {
      setLoading(false);
    }
  }, [
    filters.brand,
    filters.order,
    filters.status,
    filters.vendor,
    limit,
    page,
    token,
  ]);

  useEffect(() => {
    getOrdersByFilters();
  }, [getOrdersByFilters]);

  useEffect(() => {
    setOrderSearchInput(filters.order || "");
  }, [filters.order]);

  const updatePage = (nextPage) => {
    if (nextPage < 1 || nextPage > totalPages) return;
    setPage(nextPage);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setFilters((prev) => ({
      ...prev,
      order: String(orderSearchInput || "").trim(),
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
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Brand: {filters.brand || "all"}</span>
            <span className="om-summary-chip">Vendor: {filters.vendor || "all"}</span>
            <span className="om-summary-chip">Status: {filters.status || "all"}</span>
            <span className="om-summary-chip">Order: {filters.order || "all"}</span>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <div className="row g-2 align-items-end">
              <div className="col-md-3">
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

              <div className="col-md-3">
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

              <div className="col-md-2">
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

              <div className="col-md-4">
                <form onSubmit={handleSearch} className="row g-2">
                  <div className="col-8">
                    <label className="form-label">Search by Order ID</label>
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
                  <div className="col-4 d-flex align-items-end">
                    <button type="submit" className="btn btn-primary w-100">
                      Search
                    </button>
                  </div>
                </form>
              </div>
            </div>
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
                      <th>Order ID</th>
                      <th>Brand</th>
                      <th>Vendor</th>
                      <th>Status</th>
                      <th>Items</th>
                      <th>Order Date</th>
                      <th>ETD</th>
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
                        <td>{order.order_date ? new Date(order.order_date).toLocaleDateString() : "N/A"}</td>
                        <td>{order.ETD ? new Date(order.ETD).toLocaleDateString() : "N/A"}</td>
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
    </>
  );
};

export default OpenOrders;
