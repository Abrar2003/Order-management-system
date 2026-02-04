import { useEffect, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.utils";
// import UploadOrdersModal from "../components/UploadOrdersModal";
import AlignQCModal from "../components/AlignQcModal";
import { useSearchParams } from "react-router-dom";
import "../App.css";

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [showAlignModal, setShowAlignModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [ searchParams ] = useSearchParams();

  const user = getUserFromToken();
  const role = user?.role;

  const canManageOrders = ["admin", "manager", "Dev"].includes(role);

  useEffect(() => {
    const token = localStorage.getItem("token");

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
      });
  }, [searchParams]);

  return (
    <>
      <Navbar />
      <div
        className="orderTableContainer"
        style={{
          border: "1px solid #111827",
          width: "100%",
          borderRadius: "8px",
          padding: "16px",
        }}
      >
        <table className="orderTable">
          <thead className="tableHead">
            <tr>
              <th>PO</th> <th>Brand</th> <th>Vendor</th> <th>Item</th> <th>Description</th>
              <th>Order Date</th> <th>ETD</th> <th>Quantity</th> <th>Status</th>
              {canManageOrders && <th>Action</th>}
            </tr>

            {/* <div style={{ height: "20px" }}></div> */}
          </thead>
          <div style={{ height: "20px" }}></div>
          <tbody className="tableBody">
            {orders?.map((order) => (
              <>
                <tr className="tableRow" key={order._id}>
                  <td>{order.order_id}</td>
                  <td>{order.brand}</td>
                  <td>{order.vendor}</td>
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
                <div style={{ height: "20px" }}></div>
              </>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan="8">No orders found</td>
              </tr>
            )}
          </tbody>
        </table>
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
