import { useEffect, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.utils";
// import UploadOrdersModal from "../components/UploadOrdersModal";
import AlignQCModal from "../components/AlignQcModal";
import { useNavigate, useSearchParams } from "react-router-dom";
import "../App.css";

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [showAlignModal, setShowAlignModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ searchParams ] = useSearchParams();
  const navigate = useNavigate();

  const user = getUserFromToken();
  const role = user?.role;

  const canManageOrders = ["admin", "manager", "Dev"].includes(role);

  useEffect(() => {
    const token = localStorage.getItem("token");
    setLoading(true);

    axios
      .get(`/orders/${searchParams.get("order_id")}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      .then((res) => {
        setOrders(res.data);
        console.log("orders data", res.data)
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [searchParams]);

  return (
    <>
      <Navbar />
      <div className="qc-details-header">
        <button onClick={() => navigate(-1)} className="backButton">
          ← Back
        </button>
        <h2 className="qc-details-title">Orders</h2>
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
              <span>Brand: {orders[0].brand}</span>
              <span>Vendor: {orders[0].vendor}</span>
              <span>Status: {orders[0].status ?? "all"}</span>
              <span>
                Order Date: {new Date(orders[0].order_date).toLocaleDateString()}
              </span>
              <span>ETD: {new Date(orders[0].ETD).toLocaleDateString()}</span>
            </div>
          <table className="orderTable">
            <thead className="tableHead">
              <tr>
                <th>Item</th> <th>Description</th><th>Quantity</th> <th>Status</th>
                {canManageOrders && <th>Action</th>}
              </tr>
            </thead>
            <tbody className="tableBody">
              {orders?.map((order) => (
                <tr className="tableRow" style={{height: "40px"}} key={order._id}>
                  {/* <td>{order.order_id}</td>
                  <td>{order.brand}</td>
                  <td>{order.vendor}</td> */}
                  <td>{order.item?.item_code}</td>
                  <td>{order.item?.description}</td>
                  {/* <td>{new Date(order.order_date).toLocaleDateString()}</td>
                  <td>
                    {order.ETD
                      ? new Date(order.ETD).toLocaleDateString()
                      : "N/A"}
                  </td> */}
                  <td>{order.quantity}</td> <td>{order.status}</td>
                  {canManageOrders && (
                    <td>
                      {order.qc_record ? (
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: "bold",
                            color: "#16a34a",
                          }}
                        >
                          {order.qc_record.inspector.name} is aligned
                        </span>
                      ) : (
                        <button
                        className="secondayButton"
                        style={{
                          fontSize: "12px",
                          fontWeight: "bold",
                          width: "100%",
                        }}
                        onClick={() => {
                          setSelectedOrder(order);
                          setShowAlignModal(true);
                        }}
                        >
                          Align Inspector
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={canManageOrders ? 10 : 9}>No orders found</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
        )}
      </div>
      {/* <div style={{ marginTop: "20px", textAlign: "center" }}>
        <button
        disabled={page === 1}
          onClick={() => setPage((prev) => prev - 1)}
        >
          Prev
        </button>
        <span style={{ margin: "0 15px" }}>
          Page {page} of {totalPages}
        </span>
        <button
          disabled={page === totalPages}
          onClick={() => setPage((prev) => prev + 1)}
        >
          Next
        </button>
      </div> */}
      
      {showAlignModal && selectedOrder && (
        <AlignQCModal
          order={selectedOrder}
          onClose={() => setShowAlignModal(false)}
          onSuccess={() => {
            setShowAlignModal(false);
          }}
        />
      )}

      {/* your table JSX stays same */}
    </>
  );
};

export default Orders;
