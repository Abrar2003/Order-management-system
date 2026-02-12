import { useCallback, useEffect, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import { useNavigate } from "react-router-dom";
import "../App.css";

const defaultFilters = {
  vendor: "all",
  brand: "all",
  status: "all",
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

  // Mixed statuses: show the earliest stage reached by all items.
  const earliestStageIndex = Math.min(...validIndexes);
  return STATUS_SEQUENCE[earliestStageIndex];
};

const OpenOrders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [totalVendors, setTotalVendors] = useState([]);
  const [totalBrands, setTotalBrands] = useState([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [filters, setFilters] = useState(defaultFilters);

  const navigate = useNavigate();
  const token = localStorage.getItem("token");

  const getOrdersByFilters = useCallback(async () => {
    setLoading(true);

    try {
      const res = await axios.get("/orders/filters", {
        params: {
          vendor: filters.vendor,
          brand: filters.brand,
          status: filters.status,
          page,
          limit,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const incomingOrders = res?.data?.data ?? [];

      if (res?.data?.pagination) {
        setOrders(incomingOrders);
        setTotalPages(res.data.pagination.totalPages || 1);
      } else {
        const total = incomingOrders.length;
        const nextTotalPages = Math.max(1, Math.ceil(total / limit));
        const start = (page - 1) * limit;
        const end = start + limit;
        setOrders(incomingOrders.slice(start, end));
        setTotalPages(nextTotalPages);
      }
    } catch (err) {
      console.error(err);
      setOrders([]);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [filters.brand, filters.status, filters.vendor, limit, page, token]);

  const getSearchedOrder = useCallback(async (id) => {
    if (!id) return;

    setLoading(true);

    try {
      const res = await axios.get(`/orders/order-by-id/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      setOrders(res.data || []);
      setTotalPages(1);
      setPage(1);
    } catch (error) {
      console.error(error);
      alert("Error searching the order");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const getOrderSummary = useCallback(async () => {
    try {
      const data = await axios.get("/orders/brands-and-vendors", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      setTotalBrands(data.data.brands || []);
      setTotalVendors(data.data.vendors || []);
    } catch (error) {
      console.error(error.message);
      alert("Error fetching order summary");
    }
  }, [token]);

  useEffect(() => {
    getOrderSummary();
  }, [getOrderSummary]);

  useEffect(() => {
    getOrdersByFilters();
  }, [getOrdersByFilters]);

  const updatePage = (nextPage) => {
    if (nextPage < 1 || nextPage > totalPages) return;
    setPage(nextPage);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const searchValue = formData.get("search");
    getSearchedOrder(searchValue);
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
            <span className="om-summary-chip">Brand: {filters.brand}</span>
            <span className="om-summary-chip">Vendor: {filters.vendor}</span>
            <span className="om-summary-chip">Status: {filters.status}</span>
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
                    setFilters({ ...filters, vendor: e.target.value });
                  }}
                >
                  <option value="all">Select Vendor</option>
                  {totalVendors.map((vendor) => (
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
                    setFilters({ ...filters, brand: e.target.value });
                  }}
                >
                  <option value="all">Select Brand</option>
                  {totalBrands.map((brand) => (
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
                    setFilters({ ...filters, status: e.target.value });
                  }}
                >
                  <option value="all">Select Status</option>
                  <option value="Pending">Pending</option>
                  <option value="Under Inspection">Under Inspection</option>
                  <option value="Inspection Done">Inspection Done</option>
                  <option value="Partial Shipped">Partial Shipped</option>
                  <option value="Shipped">Shipped</option>
                </select>
              </div>

              <div className="col-md-4">
                <form onSubmit={handleSearch} className="row g-2">
                  <div className="col-8">
                    <label className="form-label">Search by Order ID</label>
                    <input type="text" name="search" className="form-control" placeholder="Order ID" />
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
