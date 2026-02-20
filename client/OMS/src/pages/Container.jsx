import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.utils";
import "../App.css";

const getTodayDateInput = () => {
  const today = new Date();
  const offsetMs = today.getTimezoneOffset() * 60000;
  return new Date(today.getTime() - offsetMs).toISOString().slice(0, 10);
};

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getShippedQuantity = (shipmentEntries) =>
  (Array.isArray(shipmentEntries) ? shipmentEntries : []).reduce(
    (sum, entry) => sum + toSafeNumber(entry?.quantity),
    0,
  );

const toErrorMessage = (err, fallback) =>
  err?.response?.data?.message || err?.message || fallback;

const Container = () => {
  const navigate = useNavigate();
  const user = getUserFromToken();
  const canFinalizeShipping = ["admin", "manager", "dev", "Dev"].includes(
    user?.role,
  );

  const [containerNumber, setContainerNumber] = useState("");
  const [shippingDate, setShippingDate] = useState(getTodayDateInput());
  const [vendor, setVendor] = useState("");
  const [vendors, setVendors] = useState([]);
  const [rows, setRows] = useState([]);
  const [orderIdFilter, setOrderIdFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchVendors = useCallback(async () => {
    try {
      setLoadingVendors(true);
      const res = await api.get("/orders/brands-and-vendors");
      setVendors(Array.isArray(res?.data?.vendors) ? res.data.vendors : []);
    } catch (err) {
      setVendors([]);
      setError(toErrorMessage(err, "Failed to load vendors."));
    } finally {
      setLoadingVendors(false);
    }
  }, []);

  const fetchVendorRows = useCallback(async (selectedVendor) => {
    if (!selectedVendor) {
      setRows([]);
      return;
    }

    try {
      setLoadingRows(true);
      setError("");

      const qcRows = [];
      let page = 1;
      let totalPages = 1;

      do {
        const res = await api.get("/qc/list", {
          params: {
            vendor: selectedVendor,
            page,
            limit: 100,
            sort: "-request_date",
          },
        });

        const currentRows = Array.isArray(res?.data?.data) ? res.data.data : [];
        qcRows.push(...currentRows);
        totalPages = Math.max(1, Number(res?.data?.pagination?.totalPages || 1));
        page += 1;
      } while (page <= totalPages);

      const seen = new Set();
      const nextRows = [];

      qcRows.forEach((qc, index) => {
        const order = qc?.order && typeof qc.order === "object" ? qc.order : null;
        const orderDocumentId = String(order?._id || qc?.order || "").trim();
        if (!orderDocumentId) return;

        const status = String(order?.status || "").trim();

        const orderQuantity = toSafeNumber(
          qc?.quantities?.client_demand ?? order?.quantity,
        );
        const passed = toSafeNumber(qc?.quantities?.qc_passed);
        const pending = toSafeNumber(
          qc?.quantities?.pending ?? Math.max(0, orderQuantity - passed),
        );
        const shippedAlready = getShippedQuantity(order?.shipment);
        const remainingOrderQuantity = Math.max(0, orderQuantity - shippedAlready);
        const maxQuantity = Math.max(
          0,
          Math.min(remainingOrderQuantity, passed - shippedAlready),
        );

        if (maxQuantity <= 0) return;

        const key = `${orderDocumentId}__${qc?.item?.item_code || index}`;
        if (seen.has(key)) return;
        seen.add(key);

        nextRows.push({
          id: key,
          orderDocumentId,
          orderId: qc?.order_meta?.order_id || order?.order_id || "N/A",
          itemCode: qc?.item?.item_code || order?.item?.item_code || "N/A",
          orderQuantity,
          passed,
          pending,
          status,
          maxQuantity,
          usePassed: false,
          quantityInput: "",
        });
      });

      nextRows.sort((a, b) => {
        const orderCmp = String(a.orderId).localeCompare(String(b.orderId));
        if (orderCmp !== 0) return orderCmp;
        return String(a.itemCode).localeCompare(String(b.itemCode));
      });

      setRows(nextRows);
    } catch (err) {
      setRows([]);
      setError(toErrorMessage(err, "Failed to load open orders for vendor."));
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    fetchVendors();
  }, [fetchVendors]);

  useEffect(() => {
    fetchVendorRows(vendor);
  }, [vendor, fetchVendorRows]);

  const orderIdOptions = useMemo(
    () =>
      [...new Set(rows.map((row) => String(row.orderId || "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const statusOptions = useMemo(
    () =>
      [...new Set(rows.map((row) => String(row.status || "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const normalizedOrderId = String(orderIdFilter || "").trim().toLowerCase();
    const normalizedStatus = String(statusFilter || "all").trim();

    return rows.filter((row) => {
      const matchesOrderId = normalizedOrderId
        ? String(row.orderId || "").toLowerCase().includes(normalizedOrderId)
        : true;
      const matchesStatus =
        normalizedStatus === "all"
          ? true
          : String(row.status || "").trim() === normalizedStatus;

      return matchesOrderId && matchesStatus;
    });
  }, [orderIdFilter, rows, statusFilter]);

  const handleUsePassedToggle = (rowId, checked) => {
    setRows((prevRows) =>
      prevRows.map((row) => {
        if (row.id !== rowId) return row;

        if (checked) {
          return {
            ...row,
            usePassed: true,
            quantityInput: String(row.maxQuantity),
          };
        }

        return {
          ...row,
          usePassed: false,
          quantityInput: "",
        };
      }),
    );
  };

  const handleQuantityChange = (rowId, rawValue) => {
    setRows((prevRows) =>
      prevRows.map((row) => {
        if (row.id !== rowId || row.usePassed) return row;

        if (rawValue === "") {
          return { ...row, quantityInput: "" };
        }

        const parsed = Number.parseInt(rawValue, 10);
        if (!Number.isFinite(parsed)) return row;

        const clamped = Math.max(0, Math.min(row.maxQuantity, parsed));
        return { ...row, quantityInput: String(clamped) };
      }),
    );
  };

  const selectedRows = useMemo(
    () =>
      filteredRows
        .map((row) => ({
          ...row,
          quantity: Number(row.quantityInput),
        }))
        .filter((row) => Number.isFinite(row.quantity) && row.quantity > 0),
    [filteredRows],
  );

  const handleBulkFinalize = async () => {
    setError("");
    setSuccess("");

    if (!canFinalizeShipping) {
      setError("You are not allowed to finalize shipments.");
      return;
    }

    const container = String(containerNumber || "").trim();
    if (!container) {
      setError("Container number is required.");
      return;
    }

    if (!shippingDate) {
      setError("Shipping date is required.");
      return;
    }

    if (!vendor) {
      setError("Please select a vendor.");
      return;
    }

    if (selectedRows.length === 0) {
      setError("Select at least one row by checking it or entering quantity.");
      return;
    }

    const invalidRow = selectedRows.find(
      (row) => row.quantity <= 0 || row.quantity > row.maxQuantity,
    );
    if (invalidRow) {
      setError(
        `Invalid quantity for ${invalidRow.orderId} / ${invalidRow.itemCode}.`,
      );
      return;
    }

    try {
      setSaving(true);

      const results = await Promise.allSettled(
        selectedRows.map((row) =>
          api.patch(`/orders/finalize-order/${row.orderDocumentId}`, {
            stuffing_date: shippingDate,
            container,
            quantity: row.quantity,
            remarks: "Bulk container shipment",
          }),
        ),
      );

      const failed = results.filter((entry) => entry.status === "rejected");
      const succeededCount = results.length - failed.length;

      if (succeededCount > 0) {
        setSuccess(
          `${succeededCount} shipment${succeededCount > 1 ? "s" : ""} added to container ${container}.`,
        );
      }

      if (failed.length > 0) {
        const failMessage = failed
          .slice(0, 3)
          .map((entry) =>
            toErrorMessage(
              entry.reason,
              "One shipment failed during bulk finalize.",
            ),
          )
          .join(" | ");
        setError(
          `${failed.length} shipment${failed.length > 1 ? "s" : ""} failed. ${failMessage}`,
        );
      }

      await fetchVendorRows(vendor);
    } finally {
      setSaving(false);
    }
  };

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
          <h2 className="h4 mb-0">Container</h2>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => fetchVendorRows(vendor)}
            disabled={!vendor || loadingRows}
          >
            {loadingRows ? "Loading..." : "Refresh"}
          </button>
        </div>

        {!canFinalizeShipping && (
          <div className="alert alert-warning mb-3">
            You can view this page, but only admin/manager/dev can finalize
            shipments.
          </div>
        )}

        <div className="card om-card mb-3">
          <div className="card-body">
            <div className="row g-2 justify-content-center align-items-end">
              <div className="col-md-4">
                <label className="form-label">Container Number</label>
                <input
                  type="text"
                  className="form-control"
                  value={containerNumber}
                  onChange={(e) => setContainerNumber(e.target.value)}
                  placeholder="Enter container number"
                />
              </div>

              <div className="col-md-3">
                <label className="form-label">Shipping Date</label>
                <input
                  type="date"
                  className="form-control"
                  value={shippingDate}
                  onChange={(e) => setShippingDate(e.target.value)}
                />
              </div>

              <div className="col-md-3">
                <label className="form-label">Vendor</label>
                <select
                  className="form-select"
                  value={vendor}
                  onChange={(e) => {
                    setVendor(e.target.value);
                    setOrderIdFilter("");
                    setStatusFilter("all");
                    setError("");
                    setSuccess("");
                  }}
                  disabled={loadingVendors}
                >
                  <option value="">Select Vendor</option>
                  {vendors.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-md-2 d-grid">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleBulkFinalize}
                  disabled={
                    saving
                    || loadingRows
                    || selectedRows.length === 0
                    || !canFinalizeShipping
                  }
                >
                  {saving ? "Saving..." : "Finalize Bulk"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <div className="d-flex flex-wrap gap-2 mb-2">
              <span className="om-summary-chip">Vendor: {vendor || "N/A"}</span>
              <span className="om-summary-chip">Total Rows: {rows.length}</span>
              <span className="om-summary-chip">
                Filtered Rows: {filteredRows.length}
              </span>
              <span className="om-summary-chip">
                Selected: {selectedRows.length}
              </span>
            </div>

            <div className="row g-2 align-items-end">
              <div className="col-md-4">
                <label className="form-label">Filter by Order ID</label>
                <input
                  type="text"
                  className="form-control"
                  value={orderIdFilter}
                  list="bulk-container-order-id-options"
                  onChange={(e) => setOrderIdFilter(e.target.value)}
                  placeholder="Type order ID"
                />
                <datalist id="bulk-container-order-id-options">
                  {orderIdOptions.map((orderId) => (
                    <option key={orderId} value={orderId} />
                  ))}
                </datalist>
              </div>
              <div className="col-md-3">
                <label className="form-label">Filter by Status</label>
                <select
                  className="form-select"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All Status</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-2 d-grid">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    setOrderIdFilter("");
                    setStatusFilter("all");
                  }}
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </div>
        </div>

        {error && <div className="alert alert-danger mb-3">{error}</div>}
        {success && <div className="alert alert-success mb-3">{success}</div>}

        <div className="card om-card">
          <div className="card-body p-0">
            {!vendor ? (
              <div className="text-center py-4">Select a vendor to load orders.</div>
            ) : loadingRows ? (
              <div className="text-center py-4">Loading...</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle om-table mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>Order ID</th>
                      <th>Item Code</th>
                      <th>Order Quantity</th>
                      <th>Passed</th>
                      <th>Pending</th>
                      <th>Status</th>
                      <th>Check</th>
                      <th>Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan="8" className="text-center py-4">
                          No rows match the current filters.
                        </td>
                      </tr>
                    )}

                    {filteredRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.orderId}</td>
                        <td>{row.itemCode}</td>
                        <td>{row.orderQuantity}</td>
                        <td>{row.passed}</td>
                        <td>{row.pending}</td>
                        <td>{row.status}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={row.usePassed}
                            onChange={(e) =>
                              handleUsePassedToggle(row.id, e.target.checked)
                            }
                            disabled={row.maxQuantity <= 0}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="form-control form-control-sm"
                            value={row.quantityInput}
                            onChange={(e) =>
                              handleQuantityChange(row.id, e.target.value)
                            }
                            min="0"
                            max={row.maxQuantity}
                            disabled={row.usePassed || row.maxQuantity <= 0}
                            placeholder="0"
                          />
                          <div className="small text-secondary mt-1">
                            Max: {row.maxQuantity}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default Container;
