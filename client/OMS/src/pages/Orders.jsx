import { useEffect, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.utils";
import AlignQCModal from "../components/AlignQcModal";
import { useNavigate, useSearchParams } from "react-router-dom";
import "../App.css";

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [showAlignModal, setShowAlignModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const user = getUserFromToken();
  const role = user?.role;
  const canManageOrders = ["admin", "manager", "dev", "Dev"].includes(role);

  useEffect(() => {
    const token = localStorage.getItem("token");

    axios
      .get(`/orders/order-by-id/${searchParams.get("order_id")}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      .then((res) => {
        setOrders(res.data);
        console.log(res.data[0]);
      })
      .catch((err) => {
        console.error(err);
        setOrders([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [searchParams]);

  const primaryOrder = orders[0];

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigate(-1)}>
            Back
          </button>
          <h2 className="h4 mb-0">Orders</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Order: {primaryOrder?.order_id ?? "N/A"}</span>
            <span className="om-summary-chip">Brand: {primaryOrder?.brand ?? "N/A"}</span>
            <span className="om-summary-chip">Vendor: {primaryOrder?.vendor ?? "N/A"}</span>
            <span className="om-summary-chip">Status: {primaryOrder?.status ?? "N/A"}</span>
            <span className="om-summary-chip">
              Order Date: {primaryOrder?.order_date ? new Date(primaryOrder.order_date).toLocaleDateString() : "N/A"}
            </span>
            <span className="om-summary-chip">ETD: {primaryOrder?.ETD ? new Date(primaryOrder.ETD).toLocaleDateString() : "N/A"}</span>
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
                      <th>Item</th>
                      <th>Description</th>
                      <th>Quantity</th>
                      <th>Status</th>
                      {canManageOrders && <th>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order._id}>
                        <td>{order.item?.item_code}</td>
                        <td>{order.item?.description}</td>
                        <td>{order.quantity}</td>
                        <td>{order.status}</td>
                        {canManageOrders && (
                          <td>
                            {order.qc_record ? (
                              <button
                                type="button"
                                className="btn btn-link btn-sm p-0"
                                onClick={() => navigate("/qc")}
                              >
                               Inspection Requested / Check updates
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm"
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
                        <td colSpan={canManageOrders ? 5 : 4} className="text-center py-4">
                          No orders found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {showAlignModal && selectedOrder && (
        <AlignQCModal
          order={selectedOrder}
          onClose={() => setShowAlignModal(false)}
          onSuccess={() => {
            setShowAlignModal(false);
          }}
        />
      )}
    </>
  );
};

export default Orders;
