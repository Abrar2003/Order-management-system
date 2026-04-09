import { useEffect, useMemo, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import OrderEtdWithHistory from "../components/OrderEtdWithHistory";
import SortHeaderButton from "../components/SortHeaderButton";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_TODAY_ETD_SORT_BY = "ETD";

const parseTodayEtdSortBy = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "order_id") return "order_id";
  if (normalized === "etd") return "ETD";
  return DEFAULT_TODAY_ETD_SORT_BY;
};

const parseTodayEtdSortOrder = (value, sortBy = DEFAULT_TODAY_ETD_SORT_BY) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "asc" || normalized === "desc") return normalized;
  return sortBy === "order_id" ? "asc" : "desc";
};

const getBrandName = (brandObj) =>
  String(brandObj?.name || brandObj?.brand || "").trim();
const getBrandKey = (value) => String(value || "").trim().toLowerCase();
const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const Home = () => {
  const token = localStorage.getItem("token");
  const [brands, setBrands] = useState([]);
  const [vendorSummary, setVendorSummary] = useState([]);
  const [todayEtdOrders, setTodayEtdOrders] = useState([]);
  const [todayEtdLoading, setTodayEtdLoading] = useState(false);
  const [todayEtdError, setTodayEtdError] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "home");
  const initialTodayEtdSortBy = parseTodayEtdSortBy(
    searchParams.get("today_sort_by"),
  );
  const initialTodayEtdSortOrder = parseTodayEtdSortOrder(
    searchParams.get("today_sort_order"),
    initialTodayEtdSortBy,
  );
  const [todayEtdSortBy, setTodayEtdSortBy] = useState(initialTodayEtdSortBy);
  const [todayEtdSortOrder, setTodayEtdSortOrder] = useState(initialTodayEtdSortOrder);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarEmbedUrl, setCalendarEmbedUrl] = useState("");
  const [calendarError, setCalendarError] = useState("");
  const [syncedQuery, setSyncedQuery] = useState(null);

  const navigate = useNavigate();
  const selectedBrandParam = String(searchParams.get("brand") || "").trim();
  const selectedBrand = useMemo(() => {
    const availableBrandNames = brands
      .map((brand) => getBrandName(brand))
      .filter(Boolean);
    if (availableBrandNames.length === 0) return "";

    if (selectedBrandParam && availableBrandNames.includes(selectedBrandParam)) {
      return selectedBrandParam;
    }
    return availableBrandNames[0];
  }, [brands, selectedBrandParam]);

  const { brandLogosById, brandLogosByName } = useMemo(() => {
    const toDataUrl = (logoObj) => {
      if (typeof logoObj?.url === "string" && logoObj.url.trim()) {
        return logoObj.url.trim();
      }

      const raw = logoObj?.data?.data || logoObj?.data;
      if (!raw || !Array.isArray(raw)) return null;

      let binary = "";
      raw.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      const base64 = window.btoa(binary);
      return `data:${logoObj?.contentType || "image/webp"};base64,${base64}`;
    };

    const logoById = new Map();
    const logoByName = new Map();
    brands.forEach((brand) => {
      const logoUrl = toDataUrl(brand.logo);
      const brandName = getBrandName(brand);
      logoById.set(brand._id, logoUrl);
      if (brandName) {
        logoByName.set(getBrandKey(brandName), logoUrl);
      }
    });
    return {
      brandLogosById: logoById,
      brandLogosByName: logoByName,
    };
  }, [brands]);

  const vendorTotals = useMemo(
    () =>
      vendorSummary.reduce(
        (acc, summary) => {
          acc.totalOrders += toNumber(summary?.totalOrders);
          acc.totalPending += toNumber(summary?.totalPending) + toNumber(summary?.totalPartialShipped);
          acc.totalOnTime += toNumber(summary?.totalOnTime);
          acc.totalDelayedOrders += toNumber(summary?.totalDelayedOrders);
          acc.totalShipped += toNumber(summary?.totalShipped);
          acc.totalPartialShipped += toNumber(summary?.totalPartialShipped);
          return acc;
        },
        {
          totalOrders: 0,
          totalPending: 0,
          totalOnTime: 0,
          totalDelayedOrders: 0,
          totalPartialShipped: 0,
          totalShipped: 0,
        },
      ),
    [vendorSummary],
  );

  const sortedVendorSummary = useMemo(
    () =>
      [...vendorSummary].sort((a, b) =>
        String(a?.vendor || "").localeCompare(String(b?.vendor || ""), undefined, {
          sensitivity: "base",
          numeric: true,
        }),
      ),
    [vendorSummary],
  );

  const todayEtdTotals = useMemo(
    () =>
      todayEtdOrders.reduce(
        (acc, order) => {
          acc.itemCount += toNumber(order?.itemCount);
          acc.shippedCount += toNumber(order?.shippedCount);
          acc.inspectionDoneCount += toNumber(order?.inspectionDoneCount);
          acc.pendingCount += toNumber(order?.pendingCount);
          acc.underInspectionCount += toNumber(order?.underInspectionCount);
          return acc;
        },
        {
          itemCount: 0,
          shippedCount: 0,
          inspectionDoneCount: 0,
          pendingCount: 0,
          underInspectionCount: 0,
        },
      ),
    [todayEtdOrders],
  );

  const handleTodayEtdSort = (column, defaultDirection = "asc") => {
    if (todayEtdSortBy === column) {
      setTodayEtdSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setTodayEtdSortBy(column);
    setTodayEtdSortOrder(defaultDirection);
  };

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
    const nextTodayEtdSortBy = parseTodayEtdSortBy(searchParams.get("today_sort_by"));
    const nextTodayEtdSortOrder = parseTodayEtdSortOrder(
      searchParams.get("today_sort_order"),
      nextTodayEtdSortBy,
    );
    const currentQuery = searchParams.toString();

    setTodayEtdSortBy((prev) => (prev === nextTodayEtdSortBy ? prev : nextTodayEtdSortBy));
    setTodayEtdSortOrder((prev) => (
      prev === nextTodayEtdSortOrder ? prev : nextTodayEtdSortOrder
    ));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams]);

  useEffect(() => {
    if (!selectedBrand) return;
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (selectedBrand) next.set("brand", selectedBrand);
    if (todayEtdSortBy !== DEFAULT_TODAY_ETD_SORT_BY) {
      next.set("today_sort_by", todayEtdSortBy);
    }
    if (todayEtdSortOrder !== parseTodayEtdSortOrder("", todayEtdSortBy)) {
      next.set("today_sort_order", todayEtdSortOrder);
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    searchParams,
    selectedBrand,
    setSearchParams,
    todayEtdSortBy,
    todayEtdSortOrder,
    syncedQuery,
  ]);

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

  useEffect(() => {
    if (!token || !selectedBrand) {
      setCalendarEmbedUrl("");
      setCalendarError("");
      return;
    }

    let isMounted = true;

    const fetchBrandCalendar = async () => {
      try {
        setCalendarLoading(true);
        setCalendarEmbedUrl("");
        setCalendarError("");

        const response = await axios.get(
          `/brands/${encodeURIComponent(selectedBrand)}/calendar`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (!isMounted) return;
        setCalendarEmbedUrl(String(response?.data?.embedUrl || "").trim());
      } catch (err) {
        if (!isMounted) return;
        setCalendarEmbedUrl("");
        setCalendarError(
          err?.response?.status === 404
            ? "Calendar is not configured for this brand."
            : "Failed to load brand calendar.",
        );
      } finally {
        if (isMounted) {
          setCalendarLoading(false);
        }
      }
    };

    fetchBrandCalendar();

    return () => {
      isMounted = false;
    };
  }, [selectedBrand, token]);

  useEffect(() => {
    if (!token || !selectedBrand) {
      setTodayEtdOrders([]);
      setTodayEtdError("");
      return;
    }

    let isMounted = true;

    const fetchTodayEtdOrders = async () => {
      try {
        setTodayEtdLoading(true);
        setTodayEtdError("");
        const now = new Date();
        const offsetMs = now.getTimezoneOffset() * 60000;
        const todayLocalIso = new Date(now.getTime() - offsetMs)
          .toISOString()
          .slice(0, 10);

        const response = await axios.get(
          "/orders/today-etd-orders",
          {
            params: {
              brand: selectedBrand,
              sort_by: todayEtdSortBy,
              sort_order: todayEtdSortOrder,
              date: todayLocalIso,
              tz_offset_minutes: now.getTimezoneOffset(),
            },
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (!isMounted) return;
        setTodayEtdOrders(
          Array.isArray(response?.data?.data) ? response.data.data : [],
        );
      } catch (err) {
        if (!isMounted) return;
        console.error("Error fetching today's ETD orders:", err);
        setTodayEtdOrders([]);
        setTodayEtdError("Failed to load today's ETD orders.");
      } finally {
        if (isMounted) {
          setTodayEtdLoading(false);
        }
      }
    };

    fetchTodayEtdOrders();

    return () => {
      isMounted = false;
    };
  }, [selectedBrand, token, todayEtdSortBy, todayEtdSortOrder]);

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2 align-items-center">
            <span className="fw-semibold me-1">Brands:</span>
            {brands.map((brand) => {
              const brandName = getBrandName(brand);
              return (
              <button
                key={brand._id}
                type="button"
                className={`btn brand-logo-btn ${selectedBrand === brandName ? "btn-primary" : "btn-outline-secondary"}`}
                onClick={() => {
                  setPage(1);
                  const next = new URLSearchParams(searchParams);
                  next.set("brand", brandName);
                  if (!areSearchParamsEquivalent(next, searchParams)) {
                    setSearchParams(next, { replace: true });
                  }
                }}
                title={brandName}
              >
                {brandLogosById.get(brand._id) ? (
                  <img src={brandLogosById.get(brand._id)} alt={brandName} className="brand-logo-img" />
                ) : (
                  <span className="small fw-semibold">{brandName}</span>
                )}
              </button>
              );
            })}
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
                      <th>Pending</th>
                      <th>On Time</th>
                      <th>Delayed</th>
                      <th>Partial Shipped</th>
                      <th>Shipped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedVendorSummary.map((summary) => (
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
                          onClick={() => navigate(`/orders/${selectedBrand}/${summary.vendor}/Pending`)}
                        >
                          {toNumber(summary.totalPending) + toNumber(summary.totalPartialShipped)}
                        </td>
                        <td
                          className="table-clickable"
                          onClick={() => navigate(`/orders/${selectedBrand}/${summary.vendor}/on-time`)}
                        >
                          {summary.totalOnTime ?? 0}
                        </td>
                        <td
                          className="table-clickable"
                          onClick={() => navigate(`/orders/${selectedBrand}/${summary.vendor}/delayed`)}
                        >
                          {summary.totalDelayedOrders}
                        </td>
                        <td
                          className="table-clickable"
                          onClick={() => navigate(`/orders/${selectedBrand}/${summary.vendor}/Partial Shipped`)}
                        >
                          {summary.totalPartialShipped ?? 0}
                        </td>
                        <td
                          className="table-clickable"
                          onClick={() => navigate(`/orders/${selectedBrand}/${summary.vendor}/Shipped`)}
                        >
                          {summary.totalShipped ?? 0}
                        </td>
                      </tr>
                    ))}

                    {vendorSummary.length === 0 && (
                      <tr>
                        <td colSpan="7" className="text-center py-4">
                          No orders found for {selectedBrand}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {vendorSummary.length > 0 && (
                    <tfoot>
                      <tr className="table-light fw-semibold">
                        <td>Total</td>
                        <td>{vendorTotals.totalOrders}</td>
                        <td>{vendorTotals.totalPending}</td>
                        <td>{vendorTotals.totalOnTime}</td>
                        <td>{vendorTotals.totalDelayedOrders}</td>
                        <td>{vendorTotals.totalPartialShipped}</td>
                        <td>{vendorTotals.totalShipped}</td>
                      </tr>
                    </tfoot>
                  )}
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

        <div className="card om-card mt-3">
          <div className="card-body p-0">
            <h3 className="h5 m-3">
              Orders With Today&apos;s ETD
            </h3>

            {todayEtdLoading ? (
              <div className="text-center py-4">Loading...</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle om-table mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>Brand</th>
                      <th>Vendor</th>
                      <th>
                        <SortHeaderButton
                          label="Order Number"
                          isActive={todayEtdSortBy === "order_id"}
                          direction={todayEtdSortOrder}
                          onClick={() => handleTodayEtdSort("order_id", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="ETD"
                          isActive={todayEtdSortBy === "ETD"}
                          direction={todayEtdSortOrder}
                          onClick={() => handleTodayEtdSort("ETD", "desc")}
                        />
                      </th>
                      <th>Item Count</th>
                      <th>Status</th>
                      <th>Shipped</th>
                      <th>Inspection Done</th>
                      <th>Pending</th>
                      <th>Under Inspection</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todayEtdOrders.map((order) => {
                      const brandLogo = brandLogosByName.get(getBrandKey(order?.brand));
                      return (
                        <tr
                          key={`${order?.order_id || "order"}-${order?.ETD || ""}`}
                          className="table-clickable"
                          onClick={() =>
                            navigate(`/orders?order_id=${encodeURIComponent(order?.order_id || "")}`)
                          }
                        >
                          <td>
                            {brandLogo ? (
                              <img
                                src={brandLogo}
                                alt={order?.brand || selectedBrand || "brand"}
                                className="home-order-brand-logo"
                              />
                            ) : (
                              <span className="small fw-semibold">{order?.brand || "N/A"}</span>
                            )}
                          </td>
                          <td>{order?.vendor || "N/A"}</td>
                          <td>{order?.order_id || "N/A"}</td>
                          <td>
                            <OrderEtdWithHistory
                              orderId={order?.order_id}
                              etd={order?.ETD}
                              revisedEtd={order?.effective_ETD || order?.revised_ETD}
                            />
                          </td>
                          <td>{Number(order?.itemCount || 0)}</td>
                          <td>{order?.status || "N/A"}</td>
                          <td>{Number(order?.shippedCount || 0)}</td>
                          <td>{Number(order?.inspectionDoneCount || 0)}</td>
                          <td>{Number(order?.pendingCount || 0)}</td>
                          <td>{Number(order?.underInspectionCount || 0)}</td>
                        </tr>
                      );
                    })}

                    {todayEtdOrders.length === 0 && (
                      <tr>
                        <td colSpan="10" className="text-center py-4">
                          {todayEtdError || "No orders found with today's ETD."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {todayEtdOrders.length > 0 && (
                    <tfoot>
                      <tr className="table-light fw-semibold">
                        <td>Total</td>
                        <td>-</td>
                        <td>{todayEtdOrders.length} Orders</td>
                        <td>-</td>
                        <td>{todayEtdTotals.itemCount}</td>
                        <td>-</td>
                        <td>{todayEtdTotals.shippedCount}</td>
                        <td>{todayEtdTotals.inspectionDoneCount}</td>
                        <td>{todayEtdTotals.pendingCount}</td>
                        <td>{todayEtdTotals.underInspectionCount}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card om-card mt-3">
          <div className="card-body">
            <h3 className="h5 mb-3">Calendar for {selectedBrand || "Selected Brand"}</h3>
            {calendarLoading ? (
              <div className="text-center py-4">Loading calendar...</div>
            ) : calendarEmbedUrl ? (
              <div className="home-calendar-wrapper">
                <iframe
                  className="home-calendar-iframe"
                  title={`calendar-${selectedBrand || "brand"}`}
                  src={calendarEmbedUrl}
                  loading="lazy"
                />
              </div>
            ) : (
              <div className="text-muted small">
                {calendarError || "Calendar is not configured for this brand."}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default Home;
