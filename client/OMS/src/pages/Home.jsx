import { useEffect, useMemo, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
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

  const brandLogos = useMemo(() => {
    const toDataUrl = (logoObj) => {
      const raw = logoObj?.data?.data || logoObj?.data;
      if (!raw || !Array.isArray(raw)) return null;

      let binary = "";
      raw.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      const base64 = window.btoa(binary);
      return `data:image/webp;base64,${base64}`;
    };

    const map = new Map();
    brands.forEach((brand) => {
      map.set(brand._id, toDataUrl(brand.logo));
    });
    return map;
  }, [brands]);

  useEffect(() => {
    const fetchBrands = async () => {
      try {
        const res = await axios.get("/brands/", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

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

  useEffect(() => {
    if (!selectedBrand) return;
    let isMounted = true;

    const fetchVendorSummary = async () => {
      try {
        setLoading(true);
        const res = await axios.get(`/orders/${selectedBrand}/vendor-summary`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!isMounted) return;
        setVendorSummary(res.data.data);
        setTotalPages(1);
      } catch (err) {
        if (!isMounted) return;
        console.error(err);
        setVendorSummary([]);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchVendorSummary();

    return () => {
      isMounted = false;
    };
  }, [selectedBrand, page, token]);

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2 align-items-center">
            <span className="fw-semibold me-1">Brands:</span>
            {brands.map((brand) => (
              <button
                key={brand._id}
                type="button"
                className={`btn brand-logo-btn ${selectedBrand === brand.name ? "btn-primary" : "btn-outline-secondary"}`}
                onClick={() => {
                  setSelectedBrand(brand.name);
                  setPage(1);
                }}
                title={brand.name}
              >
                {brandLogos.get(brand._id) ? (
                  <img src={brandLogos.get(brand._id)} alt={brand.name} className="brand-logo-img" />
                ) : (
                  <span className="small fw-semibold">{brand.name}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="card om-card">
          <div className="card-body">
            <h3 className="h5 mb-3">Orders for {selectedBrand}</h3>

            {loading ? (
              <div className="text-center py-4">Loading...</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle om-table mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>Vendor</th>
                      <th>Total Orders</th>
                      <th>Delayed</th>
                      <th>Pending</th>
                      <th>Shipped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorSummary.map((summary) => (
                      <tr key={summary.vendor}>
                        <td>{summary.vendor}</td>
                        <td
                          className="table-clickable"
                          onClick={() => navigate(`/orders/${selectedBrand}/${summary.vendor}/all`)}
                        >
                          {summary.totalOrders}
                        </td>
                        <td
                          className="table-clickable"
                          onClick={() => navigate(`/orders/${selectedBrand}/${summary.vendor}/delayed`)}
                        >
                          {summary.totalDelayedOrders}
                        </td>
                        <td
                          className="table-clickable"
                          onClick={() => navigate(`/orders/${selectedBrand}/${summary.vendor}/Pending`)}
                        >
                          {summary.totalPending}
                        </td>
                        <td
                          className="table-clickable"
                          onClick={() => navigate(`/orders/${selectedBrand}/${summary.vendor}/Shipped`)}
                        >
                          {summary.totalShipped}
                        </td>
                      </tr>
                    ))}

                    {vendorSummary.length === 0 && (
                      <tr>
                        <td colSpan="5" className="text-center py-4">
                          No orders found for {selectedBrand}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {vendorSummary.length > 0 && (
          <div className="d-flex justify-content-center align-items-center gap-3 mt-3">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={page === 1}
              onClick={() => setPage((prev) => prev - 1)}
            >
              Prev
            </button>
            <span className="small fw-semibold">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={page === totalPages}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </>
  );
};

export default Home;
