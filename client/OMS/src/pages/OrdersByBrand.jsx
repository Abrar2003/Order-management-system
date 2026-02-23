import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import { formatDateDDMMYYYY } from "../utils/date";
import "../App.css";

const OrdersByBrand = () => {
  const { brand, vendor, status } = useParams();

  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortBy, setSortBy] = useState("order_date");
  const [sortOrder, setSortOrder] = useState("desc");

  const handleSortColumn = (column, defaultDirection = "asc") => {
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
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("order_id", "asc")}
                        >
                          Order ID{sortIndicator("order_id")}
                        </button>
                      </th>
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
                        <td colSpan="4" className="text-center py-4">
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
      </div>
    </>
  );
};

export default OrdersByBrand;
