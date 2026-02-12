import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import { useNavigate } from "react-router-dom";
import "../App.css";

// small helper: debounce without extra libs
const useDebouncedValue = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
};

const QCPage = () => {
  const [qcList, setQcList] = useState([]);
  const [inspectors, setInspectors] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [orders, setOrders] = useState([]);

  // header filters (excel-like)
  const [search, setSearch] = useState(""); // item_code search
  const [inspector, setInspector] = useState("");
  const [vendor, setVendor] = useState("");
  const [from, setFrom] = useState(""); // YYYY-MM-DD
  const [to, setTo] = useState(""); // YYYY-MM-DD
  const [sort, setSort] = useState("-request_date"); // default
  const [order, setOrder] = useState("");

  const debouncedSearch = useDebouncedValue(search, 300);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const token = localStorage.getItem("token");
  const navigate = useNavigate();

  const fetchQC = useCallback(async () => {
    const res = await axios.get("/qc/list", {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        order,
        page,
        limit: 20,
        search: debouncedSearch, // item_code
        inspector,
        vendor,
        from,
        to,
        sort,
      },
    });

    setQcList(res.data.data);
    setTotalPages(res.data.pagination.totalPages);

    // vendors dropdown: best if backend returns available vendors separately,
    // but for now (no extra endpoint), take from received data safely:
    const uniqueVendors = [
      ...new Set(
        res.data.data.map((qc) => qc?.order_meta?.vendor).filter(Boolean),
      ),
    ];
    const uniqueOrders = [
      ...new Set(
        res.data.data.map((qc) => qc?.order_meta?.order_id).filter(Boolean),
      ),
    ];
    setVendors(uniqueVendors);
    setOrders(uniqueOrders);
  }, [token, page, debouncedSearch, inspector, vendor, from, to, sort, order]);

  const fetchInspectors = useCallback(async () => {
    const res = await axios.get("/auth/?role=QC", {
      headers: { Authorization: `Bearer ${token}` },
    });
    setInspectors(res.data);
  }, [token]);

  useEffect(() => {
    fetchQC();
  }, [fetchQC]);

  useEffect(() => {
    fetchInspectors();
  }, [fetchInspectors]);

  const handleDetailsClick = (qc) => {
    navigate(`/qc/${qc._id}`);
  };

  // keep filter controls consistent: when filter changes → reset page 1
  const resetToFirstPage = useCallback(() => setPage(1), []);

  // optional: click-to-sort for Request Date column (no styling changes)
  const toggleRequestDateSort = () => {
    resetToFirstPage();
    setSort((prev) =>
      prev === "-request_date" ? "request_date" : "-request_date",
    );
  };

  // helpers for rendering date (your qc.request_date is string; keep display unchanged)
  const requestDateLabel = useMemo(() => {
    return sort === "-request_date" ? "Request Date ↓" : "Request Date ↑";
  }, [sort]);

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(-1)}
          >
            Back
          </button>
          <h2 className="h4 mb-0">QC Records</h2>
          <span className="d-none d-md-inline" />
        </div>

        {/* Removed the separate filter card UI? You asked filters in table head.
            If you want to keep the card too, we can keep it.
            For now: ONLY table head filters. */}

        <div className="card om-card">
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-striped table-hover align-middle om-table mb-0">
                <thead className="table-primary">
                  {/* Column titles */}
                  <tr>
                    <th>PO</th>
                    <th>Vendor</th>
                    <th>Item</th>
                    <th
                      style={{ cursor: "pointer" }}
                      onClick={toggleRequestDateSort}
                      title="Click to sort"
                    >
                      {requestDateLabel}
                    </th>
                    <th>Last Inspected Date</th>
                    <th>Requested</th>
                    <th>Offered</th>
                    <th>QC Passed</th>
                    <th>Pending</th>
                    <th>CBM</th>
                    <th>Inspector</th>
                    <th>Check Details</th>
                  </tr>

                  {/* Excel-like filters row (same table classes) */}
                  <tr>
                    {/* PO filter (optional) — keep empty to avoid extra backend work */}
                    <th>
                      <select
                        className="form-select form-select-sm"
                        value={order}
                        onChange={(e) => {
                          resetToFirstPage();
                          setOrder(e.target.value);
                        }}
                      >
                        <option value="">All</option>
                        {orders.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </th>

                    {/* Vendor filter */}
                    <th>
                      <select
                        className="form-select form-select-sm"
                        value={vendor}
                        onChange={(e) => {
                          resetToFirstPage();
                          setVendor(e.target.value);
                        }}
                      >
                        <option value="">All</option>
                        {vendors.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </th>

                    {/* Item code search */}
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="Item code"
                        value={search}
                        onChange={(e) => {
                          resetToFirstPage();
                          setSearch(e.target.value);
                        }}
                      />
                    </th>

                    {/* Request date range */}
                    <th>
                      <div className="d-flex flex-column gap-1">
                        <div className="d-flex gap-1">
                          <label>From</label>
                          <input
                            type="date"
                            className="form-control form-control-sm"
                            value={from}
                            onChange={(e) => {
                              resetToFirstPage();
                              setFrom(e.target.value);
                            }}
                          />
                        </div>
                        <div className="d-flex gap-1">
                          <label>To</label>
                          <input
                            type="date"
                            className="form-control form-control-sm"
                            value={to}
                            onChange={(e) => {
                              resetToFirstPage();
                              setTo(e.target.value);
                            }}
                          />
                        </div>
                      </div>
                    </th>

                    {/* Numeric columns: keep blank (optional) */}
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="—"
                        disabled
                      />
                    </th>
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="—"
                        disabled
                      />
                    </th>
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="—"
                        disabled
                      />
                    </th>
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="—"
                        disabled
                      />
                    </th>
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="—"
                        disabled
                      />
                    </th>

                    {/* CBM filter: keep blank */}
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="—"
                        disabled
                      />
                    </th>

                    {/* Inspector filter */}
                    <th>
                      <select
                        className="form-select form-select-sm"
                        value={inspector}
                        onChange={(e) => {
                          resetToFirstPage();
                          setInspector(e.target.value);
                        }}
                      >
                        <option value="">All</option>
                        {inspectors.map((qc) => (
                          <option key={qc._id} value={qc._id}>
                            {qc.name}
                          </option>
                        ))}
                      </select>
                    </th>

                    {/* Clear filters button area */}
                    <th>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm w-100"
                        onClick={() => {
                          setSearch("");
                          setInspector("");
                          setVendor("");
                          setOrder("");
                          setFrom("");
                          setTo("");
                          setSort("-request_date");
                          setPage(1);
                        }}
                      >
                        Clear
                      </button>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {qcList.map((qc) => (
                    <tr key={qc._id}>
                      {/* Prefer order.order_id if you populate order.
                          Vendor should come from order_meta now */}
                      <td>
                        {qc?.order_meta?.order_id ||
                          qc?.order?.order_id ||
                          "N/A"}
                      </td>
                      <td>
                        {qc?.order_meta?.vendor || qc?.order?.vendor || "N/A"}
                      </td>
                      <td>{qc?.item?.item_code || "N/A"}</td>
                      <td>{qc?.request_date || "N/A"}</td>
                      <td>{qc?.last_inspected_date || "N/A"}</td>
                      <td>{qc?.quantities?.quantity_requested ?? 0}</td>
                      <td>{qc?.quantities?.vendor_provision ?? 0}</td>
                      <td>{qc?.quantities?.qc_passed ?? 0}</td>
                      <td>{qc?.quantities?.pending ?? 0}</td>
                      <td>{qc?.cbm?.total || "NA"}</td>
                      <td>{qc?.inspector?.name || "N/A"}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={(e) => {
                            e.preventDefault();
                            handleDetailsClick(qc);
                          }}
                        >
                          See Details
                        </button>
                      </td>
                    </tr>
                  ))}

                  {qcList.length === 0 && (
                    <tr>
                      <td colSpan="12" className="text-center py-4">
                        No QC records found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="d-flex justify-content-center align-items-center gap-3 mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
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
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
};

export default QCPage;
