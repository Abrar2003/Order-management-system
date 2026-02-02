import { useEffect, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.utils";
import { useNavigate } from "react-router-dom";
import "../App.css";

const Home = () => {
  const token = localStorage.getItem("token");
  const [brands, setBrands] = useState([]);
  const [selectedBrand, setSelectedBrand] = useState(null);
  const [vendorSummary, setVendorSummary] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

const navigate = useNavigate();

  // Fetch brands on component mount
  useEffect(() => {
    const fetchBrands = async () => {
      try {
        const res = await axios.get("/brands/", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        console.log("Fetched brands:", res.data);
        if (res.data.data && res.data.data.length > 0) {
          setBrands(res.data.data);
          setSelectedBrand(res.data.data[0].brand);
        }
      } catch (err) { 
        console.error("Error fetching brands:", err);
      }
    };

    if (token) {
      fetchBrands();
    }
  }, [token]);

  // Fetch orders for selected brand
  useEffect(() => {
    if (!selectedBrand) return;

    setLoading(true);
    axios
      .get(`/orders/${selectedBrand}/vendor-summary`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      .then((res) => {
        setVendorSummary(res.data.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
        setVendorSummary([]);
      });
  }, [selectedBrand, page, token]);

  return (
    <>
      <Navbar />
    <div>

      <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "2rem" }}>
        {/* Brand Navigation Bar */}
        <div
          style={{
              // backgroundColor: "#f3f4f6",
              padding: "12px 16px",
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
          <span
            style={{
                fontWeight: "600",
                color: "#374151",
                fontSize: "14px",
            }}
            >
            Brands:
          </span>
          {brands.map((brand) => {
              const logoBlob = new Blob([new Uint8Array(brand.logo.data)], {
                  type: "image/webp",
                });

                const logoUrl = URL.createObjectURL(logoBlob);
                
                return (
                    <button
                    key={brand._id}
                    onClick={() => {
                  setSelectedBrand(brand.name);
                  setPage(1);
                }}
                style={{
                    width: "80px",
                    height: "40px",
                    display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "5px",
                  backgroundColor: "#ffffff",
                  color: selectedBrand === brand.name ? "#ffffff" : "#374151",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: selectedBrand === brand.name ? "600" : "500",
                  margin: "auto",
                }}
                >
                <img
                  src={logoUrl}
                  alt={brand.name}
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
              </button>
            );
        })}
        </div>

        {/* Orders Table */}
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
            <div style={{ textAlign: "center", padding: "20px" }}>
              Loading...
            </div>
          ) : (
              <div>
              <h3 style={{ marginTop: 0, marginBottom: "16px" }}>
                Orders for <br/> {selectedBrand}
              </h3>
              <table className="orderTable">
                <thead className="tableHead">
                  <tr>
                    <th>Vendor</th>
                    <th>Total Orders</th>
                    <th>Delayed</th>
                    <th>Peding</th>
                    <th>Shipped</th>
                  </tr>
                </thead>
                <div style={{ height: "20px" }}></div>
                <tbody className="tableBody">
                  {vendorSummary.map((summary) => (
                      <>
                      <tr className="tableRow">
                        <td>{summary.vendor}</td>
                        <td style={{ cursor: "pointer" }} onClick={() => {
                            navigate(`/orders/${selectedBrand}/${summary.vendor}/all`);
                        }}>{summary.totalOrders}</td>
                        <td style={{ cursor: "pointer" }} onClick={() => {
                            navigate(`/orders/${selectedBrand}/${summary.vendor}/delayed`);
                        }}>{summary.totalDelayedOrders}</td>
                        <td style={{ cursor: "pointer" }} onClick={() => {
                            navigate(`/orders/${selectedBrand}/${summary.vendor}/Pending`);
                        }}>{summary.totalPending}</td>
                        <td style={{ cursor: "pointer" }} onClick={() => {
                            navigate(`/orders/${selectedBrand}/${summary.vendor}/Shipped`);
                        }}>{summary.totalShipped}</td>
                      </tr>
                      <div style={{ height: "20px" }}></div>
                       
                                          </>

))}
                  {vendorSummary.length === 0 && (
                      <tr>
                      <td colSpan="8" style={{ textAlign: "center" }}>
                        No orders found for {selectedBrand}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {vendorSummary.length > 0 && (
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
        )}
      </div>
    </div>
        </>
  );
};

export default Home;
