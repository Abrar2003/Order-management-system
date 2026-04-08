import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import OrderEtdWithHistory from "../components/OrderEtdWithHistory";
import SortHeaderButton from "../components/SortHeaderButton";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_SORT_BY = "order_date";

const parseSortBy = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "order_id") return "order_id";
  if (normalized === "order_date") return "order_date";
  if (normalized === "etd") return "ETD";
  return DEFAULT_SORT_BY;
};

const parseSortOrder = (value, sortBy = DEFAULT_SORT_BY) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "asc" || normalized === "desc") return normalized;
  return sortBy === "order_id" ? "asc" : "desc";
};

const OrdersByBrand = () => {
  const { brand, vendor, status } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "orders-by-brand");
  const initialSortBy = parseSortBy(searchParams.get("sort_by"));
  const initialSortOrder = parseSortOrder(
    searchParams.get("sort_order"),
    initialSortBy,
  );

  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState(initialSortBy);
  const [sortOrder, setSortOrder] = useState(initialSortOrder);
  const [syncedQuery, setSyncedQuery] = useState(null);

  const handleSortColumn = (column, defaultDirection = "asc") => {
    if (sortBy === column) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortOrder(defaultDirection);
  };

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        setLoading(true);
        setError("");

        const token = localStorage.getItem("token");
        const effectiveStatus = status ?? "all";

        const res = await axios.get(
          `/orders/brand/${brand}/vendor/${vendor}/status/${effectiveStatus}`,
          {
            params: {
              isDelayed: effectiveStatus === "delayed" ? "true" : "false",
              sort_by: sortBy,
              sort_order: sortOrder,
            },
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );
        setOrders(res.data.data);
      } catch (err) {
        console.error(err);
        setError("Failed to fetch orders");
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, [brand, vendor, status, sortBy, sortOrder]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextSortBy = parseSortBy(searchParams.get("sort_by"));
    const nextSortOrder = parseSortOrder(
      searchParams.get("sort_order"),
      nextSortBy,
    );

    setSortBy((prev) => (prev === nextSortBy ? prev : nextSortBy));
    setSortOrder((prev) => (prev === nextSortOrder ? prev : nextSortOrder));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (sortBy !== DEFAULT_SORT_BY) next.set("sort_by", sortBy);
    if (sortOrder !== parseSortOrder("", sortBy)) {
      next.set("sort_order", sortOrder);
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, sortBy, sortOrder, syncedQuery]);

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(`/?brand=${encodeURIComponent(brand)}`)}
          >
            Back
          </button>
          <h2 className="h4 mb-0">Orders by Brand</h2>
          <span className="d-none d-md-inline" />
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Brand: {brand}</span>
            <span className="om-summary-chip">Vendor: {vendor}</span>
            <span className="om-summary-chip">Status: {status ?? "all"}</span>
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
                        <SortHeaderButton
                          label="Order ID"
                          isActive={sortBy === "order_id"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("order_id", "asc")}
                        />
                      </th>
                      <th>Items</th>
                      <th>Status</th>
                      <th>
                        <SortHeaderButton
                          label="Order Date"
                          isActive={sortBy === "order_date"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("order_date", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="ETD"
                          isActive={sortBy === "ETD"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("ETD", "desc")}
                        />
                      </th>
                      <th>Revised ETD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.length === 0 && (
                      <tr>
                        <td colSpan="6" className="text-center py-4">
                          No orders found
                        </td>
                      </tr>
                    )}

                    {orders.map((order) => (
                      <tr
                        key={order._id || order.order_id}
                        className="table-clickable"
                        onClick={() => navigate(`/orders?order_id=${order.order_id}`)}
                      >
                        <td>{order.order_id}</td>
                        <td>{order.items}</td>
                        <td>{order?.totalStatus || "N/A"}</td>
                        <td>{formatDateDDMMYYYY(order.order_date)}</td>
                        <td>{formatDateDDMMYYYY(order?.ETD)}</td>
                        <td>
                          <OrderEtdWithHistory
                            orderId={order?.order_id}
                            etd={order?.ETD}
                            revisedEtd={order?.effective_ETD || order?.revised_ETD}
                            fallback="-"
                            showOriginalWhenNoRevision={false}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default OrdersByBrand;
