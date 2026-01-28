import { useEffect, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.utils";
import UploadOrdersModal from "../components/UploadOrdersModal";
import "../App.css";


const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showUploadModal, setShowUploadModal] = useState(false);


    const user = getUserFromToken();
  const role = user?.role;

  const canManageOrders = ["admin", "manager", "Dev"].includes(role);

  useEffect(() => {
  const token = localStorage.getItem("token");

  axios
    .get(`/orders?page=${page}&limit=20`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    .then((res) => {
      setOrders(res.data.data);
      setTotalPages(res.data.pagination.totalPages);
    })
    .catch((err) => {
      console.error(err);
    });
}, [page]);


  return (
    <>
    <Navbar />
   {canManageOrders && (
  <div style={{ margin: "10px 0", textAlign: "right" }}>
    <button
      onClick={() => setShowUploadModal(true)}
      style={{
        padding: "8px 16px",
        backgroundColor: "#2563eb",
        color: "#fff",
        border: "none",
        borderRadius: "4px",
      }}
    >
      Upload Orders
    </button>
  </div>
)}
      <div className="orderTableContainer">
        <table className="orderTable">
          <thead className="tableHead">
            <tr>
              <th>PO</th> <th>Vendor</th> <th>Item</th> <th>Description</th>
              <th>Order Date</th> <th>ETD</th> <th>Quantity</th> <th>Status</th>
               {canManageOrders && <th>Action</th>}
            </tr>
          </thead>
          <tbody className="tableBody">
            {orders.map((order) => (
              <tr key={order._id}>
                <td>{order.order_id}</td> <td>{order.vendor}</td>
                <td>{order.item?.item_code}</td>
                <td>{order.item?.description}</td>
                <td>{new Date(order.order_date).toLocaleDateString()}</td>
                <td>
                  {order.ETD
                    ? new Date(order.ETD).toLocaleDateString()
                    : "N/A"}
                </td>
                <td>{order.quantity}</td> <td>{order.status}</td>
                {canManageOrders && (
                  <td>
                    <button>Align Inspector</button>
                  </td>
                )}
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan="8">No orders found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: "20px", textAlign: "center" }}>
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
      </div>
      {showUploadModal && (
  <UploadOrdersModal
    onClose={() => setShowUploadModal(false)}
    onSuccess={() => {
      // reload first page after upload
      setPage(1);
    }}
  />
)}

      {/* your table JSX stays same */}
    </>
  );
};

export default Orders;
