import { useEffect, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.utils";
import AlignQCModal from "../components/AlignQcModal";
import { useNavigate } from "react-router-dom";
import "../App.css";

const defaultFilters = {
  vendor: "all",
  brand: "all",
  status: "all",
};

const OpenOrders = () => {
  const [orders, setOrders] = useState([]);
  const [showAlignModal, setShowAlignModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [totalVendors, setTotalVedors] = useState([]);
  const [totalBrands, setTotalBrands] = useState([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [filters, setFilters] = useState(defaultFilters);

  const navigate = useNavigate();

  const user = getUserFromToken();
  const token = localStorage.getItem("token");

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    const formData = new FormData(e.target);
    getSearchedOrder(formData.get("search"));
  };

  const getOrdersByFilters = async () => {
    
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

      setOrders(res?.data?.data ?? []);
      setTotalPages(res?.data?.pagination?.totalPages ?? 1);
    } catch (err) {
      console.error(err);
      setOrders([]);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  };

  const getSearchedOrder = async (id) => {
    
    setLoading(true);

    try {
        const res = await axios.get(`/orders/order-by-id/${id}`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        })
        setOrders(res.data)
    } catch (error) {
        console.log(error);
        alert("error searching the order");
    } finally {
        setLoading(false);
    }
  };

  const getOrderSummary = async () => {

    setLoading(true);

    try {
      const data = await axios.get("/orders/brands-and-vendors", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      setTotalBrands(data.data.brands);
      setTotalVedors(data.data.vendors);
    } catch (error) {
      console.log(error.message);
      alert("error fetching orders summary");
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getOrderSummary();
  }, []);

  useEffect(() => {
    getOrdersByFilters();
  }, [filters, page, limit]);

  const updatePage = (nextPage) => {
    if (nextPage < 1 || nextPage > totalPages) return;
  };

  return (
    <>
      <Navbar />
      <div className="qc-details-header">
        <button onClick={() => navigate(-1)} className="backButton">
          {"<- Back"}
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
              <span>Brand: {filters.brand}</span>
              <span>Vendor: {filters.vendor}</span>
              <span>Status: {filters.status}</span>
            </div>

            <div className="filters">
              <div>
                <select
                  name="vendors"
                  id="vendor-select"
                  value={filters.vendor}
                  onChange={(e) => {
                    setPage(1);
                    setFilters({ ...filters, vendor: e.target.value });
                  }}
                  defaultValue={"all"}
                >
                  <option value="all">Select Vendor</option>
                  {totalVendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
                <select
                  name="brands"
                  id="brand-select"
                  defaultValue={"all"}
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
                <select
                  name="status"
                  id="status-select"
                  defaultValue={"all"}
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
                  <option value="Shipped">Shipped</option>
                </select>
              </div>

              <div>
                <form
                  onSubmit={(e) => handleSearch(e)}
                >
                  <input type="text" name="search" placeholder="Search by Order ID"/>
                  <button type="submit" className="secondayButton">Search 🔍</button>
                </form>
              </div>
              
            </div>
            <table className="orderTable">
              <thead className="tableHead">
                <tr>
                  <th>Order ID</th>
                  <th>Brand</th>
                  <th>Vendor</th>
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
                    <td>{order.brand}</td>
                    <td>{order.vendor}</td>
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
      <div style={{ marginTop: "20px", textAlign: "center" }}>
        <button disabled={page === 1} onClick={() => updatePage(page - 1)}>
          Prev
        </button>
        <span style={{ margin: "0 15px" }}>
          Page {page} of {totalPages}
        </span>
        <button
          disabled={page >= totalPages}
          onClick={() => updatePage(page + 1)}
        >
          Next
        </button>
      </div>

      {showAlignModal && selectedOrder && (
        <AlignQCModal
          order={selectedOrder}
          onClose={() => setShowAlignModal(false)}
          onSuccess={() => {
            setShowAlignModal(false);
            getOrdersByFilters();
          }}
        />
      )}
    </>
  );
};

export default OpenOrders;
