import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import "../App.css";

const OrdersByBrand = () => {
  const { brand, vendor, status } = useParams();

  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        setLoading(true);
        setError("");

        const token = localStorage.getItem("token");
        const effectiveStatus = status ?? "all";

        const res = await axios.get(
          `/orders/brand/${brand}/vendor/${vendor}/status/${effectiveStatus}?isDelayed=${effectiveStatus === "delayed" ? "true" : "false"}`,
          {
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
  }, [brand, vendor, status]);

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
                      <th>Order ID</th>
                      <th>Items</th>
                      <th>Order Date</th>
                      <th>ETD</th>
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
      </div>
    </>
  );
};

export default OrdersByBrand;
