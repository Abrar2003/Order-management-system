import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "../api/axios";
import Navbar from "../components/Navbar";

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

  if (loading) return <p>Loading...</p>;
  if (error) return <p>{error}</p>;

  return (
    <>
      <Navbar />
      <div className="qc-details-header">
        <button onClick={() => navigate(-1)} className="backButton">
          ← Back
        </button>
        <h2 className="qc-details-title">Orders by Brand</h2>
      </div>
      <div
        className="orderTableContainer"
        style={{
          width: "90%",
          borderRadius: "8px",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          margin: "auto",
        }}
      >
        {loading ? (
          <div style={{ textAlign: "center", padding: "20px" }}>Loading...</div>
        ) : (
          <>
            <div
             className="orderDetailsDiv"
              style={{
                // backgroundColor: "#f3f4f6",
                padding: "0.5rem 1rem",
                borderBottom: "1px solid #e5e7eb",
                margin: "20px auto",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap",
                boxShadow: "rgba(0, 0, 0, 0.24) 0px 3px 8px",
              }}
            >
              <span>Brand: {brand}</span>
              <span>Vendor: {vendor}</span>
              <span>Status: {status ?? "all"}</span>
            </div>

            <table className="orderTable">
              <thead className="tableHead">
                <tr>
                  <th>Order ID</th>
                  {/* <th>Brand</th>
            <th>Vendor</th> */}
                  <th>Items</th>
                  <th>Order Date</th>
                  <th>ETD</th>
                </tr>
              </thead>
              <div style={{ height: "20px" }}></div>
              <tbody className="tableBody">
                {orders.length === 0 && (
                  <tr>
                    <td colSpan="9">No orders found</td>
                  </tr>
                )}

                {orders.map((order) => (
                  <tr
                    key={order._id}
                    style={{ cursor: "pointer" }}
                    onClick={() =>
                      navigate(`/orders?order_id=${order.order_id}`)
                    }
                  >
                    <td>{order.order_id}</td>
                    {/* <td>{order.brand}</td>
              <td>{order.vendor}</td> */}
                    <td>{order.items}</td>
                    <td>
                      {order.order_date
                        ? new Date(order.order_date).toLocaleDateString()
                        : "N/A"}
                    </td>
                    <td>
                      {order.ETD
                        ? new Date(order.ETD).toLocaleDateString()
                        : "N/A"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
};

export default OrdersByBrand;
