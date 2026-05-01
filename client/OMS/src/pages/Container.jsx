import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import SampleModal from "../components/SampleModal";
import SortHeaderButton from "../components/SortHeaderButton";
import { getUserFromToken } from "../auth/auth.utils";
import { isViewOnlyUser } from "../auth/permissions";
import { usePermissions } from "../auth/PermissionContext";
import {
  getTodayDDMMYYYY,
  isValidDDMMYYYY,
  toDDMMYYYYInputValue,
  toISODateString,
} from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { useShippingInspectors } from "../hooks/useShippingInspectors";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

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

const normalizeSearchParam = (value) => String(value || "").trim();

const normalizeFilterParam = (value, fallback = "all") => {
  const cleaned = String(value || "").trim();
  if (!cleaned) return fallback;
  return cleaned;
};

const Container = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "bulk-shipping");
  const user = getUserFromToken();
  const { hasPermission } = usePermissions();
  const isViewOnly = isViewOnlyUser(user);
  const canFinalizeShipping = hasPermission("shipments", "edit");

  const [containerNumber, setContainerNumber] = useState(() =>
    normalizeSearchParam(searchParams.get("container_number")),
  );
  const [invoiceNumber, setInvoiceNumber] = useState(() =>
    normalizeSearchParam(searchParams.get("invoice_number")),
  );
  const [shippingDate, setShippingDate] = useState(() =>
    toDDMMYYYYInputValue(searchParams.get("shipping_date"), getTodayDDMMYYYY()),
  );
  const [vendor, setVendor] = useState(() =>
    normalizeSearchParam(searchParams.get("vendor")),
  );
  const [stuffedById, setStuffedById] = useState("");
  const [vendors, setVendors] = useState([]);
  const [rows, setRows] = useState([]);
  const [sampleRows, setSampleRows] = useState([]);
  const [showSampleModal, setShowSampleModal] = useState(false);
  const [orderIdFilter, setOrderIdFilter] = useState(() =>
    normalizeSearchParam(searchParams.get("order_id")),
  );
  const [draftOrderIdFilter, setDraftOrderIdFilter] = useState(() =>
    normalizeSearchParam(searchParams.get("order_id")),
  );
  const [statusFilter, setStatusFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("status"), "all"),
  );
  const [draftStatusFilter, setDraftStatusFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("status"), "all"),
  );
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [sortBy, setSortBy] = useState("orderId");
  const [sortOrder, setSortOrder] = useState("asc");
  const {
    inspectors,
    inspectorById,
    loadingInspectors,
    inspectorError,
  } = useShippingInspectors();

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
          itemDescription:
            qc?.item?.description || order?.item?.description || "N/A",
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

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextContainerNumber = normalizeSearchParam(
      searchParams.get("container_number"),
    );
    const nextInvoiceNumber = normalizeSearchParam(
      searchParams.get("invoice_number"),
    );
    const nextShippingDate = toDDMMYYYYInputValue(
      searchParams.get("shipping_date"),
      getTodayDDMMYYYY(),
    );
    const nextVendor = normalizeSearchParam(searchParams.get("vendor"));
    const nextOrderIdFilter = normalizeSearchParam(searchParams.get("order_id"));
    const nextStatusFilter = normalizeFilterParam(searchParams.get("status"), "all");

    setContainerNumber((prev) => (prev === nextContainerNumber ? prev : nextContainerNumber));
    setInvoiceNumber((prev) => (prev === nextInvoiceNumber ? prev : nextInvoiceNumber));
    setShippingDate((prev) => (prev === nextShippingDate ? prev : nextShippingDate));
    setVendor((prev) => (prev === nextVendor ? prev : nextVendor));
    setOrderIdFilter((prev) => (prev === nextOrderIdFilter ? prev : nextOrderIdFilter));
    setDraftOrderIdFilter((prev) => (prev === nextOrderIdFilter ? prev : nextOrderIdFilter));
    setStatusFilter((prev) => (prev === nextStatusFilter ? prev : nextStatusFilter));
    setDraftStatusFilter((prev) => (prev === nextStatusFilter ? prev : nextStatusFilter));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    const containerValue = normalizeSearchParam(containerNumber);
    const invoiceValue = normalizeSearchParam(invoiceNumber);
    const vendorValue = normalizeSearchParam(vendor);
    const orderIdValue = normalizeSearchParam(orderIdFilter);
    const shippingDateIso = toISODateString(shippingDate);

    if (containerValue) next.set("container_number", containerValue);
    if (invoiceValue) next.set("invoice_number", invoiceValue);
    if (shippingDateIso) next.set("shipping_date", shippingDateIso);
    if (vendorValue) next.set("vendor", vendorValue);
    if (orderIdValue) next.set("order_id", orderIdValue);
    if (statusFilter && statusFilter !== "all") next.set("status", statusFilter);

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    containerNumber,
    invoiceNumber,
    orderIdFilter,
    searchParams,
    setSearchParams,
    shippingDate,
    statusFilter,
    syncedQuery,
    vendor,
  ]);

  const orderIdOptions = useMemo(
    () =>
      [...new Set(
        [...rows, ...sampleRows]
          .map((row) => String(row.orderId || "").trim())
          .filter(Boolean),
      )]
        .sort((a, b) => a.localeCompare(b)),
    [rows, sampleRows],
  );

  const statusOptions = useMemo(
    () =>
      [...new Set(
        [...rows, ...sampleRows]
          .map((row) => String(row.status || "").trim())
          .filter(Boolean),
      )]
        .sort((a, b) => a.localeCompare(b)),
    [rows, sampleRows],
  );

  const combinedRows = useMemo(() => [...rows, ...sampleRows], [rows, sampleRows]);

  const filteredRows = useMemo(() => {
    const normalizedOrderId = String(orderIdFilter || "").trim().toLowerCase();
    const normalizedStatus = String(statusFilter || "all").trim();

    return combinedRows.filter((row) => {
      const matchesOrderId = normalizedOrderId
        ? String(row.orderId || "").toLowerCase().includes(normalizedOrderId)
        : true;
      const matchesStatus =
        normalizedStatus === "all"
          ? true
          : String(row.status || "").trim() === normalizedStatus;

      return matchesOrderId && matchesStatus;
    });
  }, [combinedRows, orderIdFilter, statusFilter]);

  const handleSortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      const nextSortState = getNextClientSortState(
        sortBy,
        sortOrder,
        column,
        defaultDirection,
      );
      setSortBy(nextSortState.sortBy);
      setSortOrder(nextSortState.sortOrder);
    },
    [sortBy, sortOrder],
  );

  const handleApplyFilters = useCallback((event) => {
    event?.preventDefault();
    setOrderIdFilter(normalizeSearchParam(draftOrderIdFilter));
    setStatusFilter(normalizeFilterParam(draftStatusFilter, "all"));
  }, [draftOrderIdFilter, draftStatusFilter]);

  const handleClearFilters = useCallback(() => {
    setDraftOrderIdFilter("");
    setDraftStatusFilter("all");
    setOrderIdFilter("");
    setStatusFilter("all");
  }, []);

  const sortedRows = useMemo(
    () =>
      sortClientRows(filteredRows, {
        sortBy,
        sortOrder,
        getSortValue: (row, column) => {
          if (column === "orderId") return row?.orderId;
          if (column === "itemCode") return row?.itemCode;
          if (column === "itemDescription") return row?.itemDescription;
          if (column === "orderQuantity") return Number(row?.orderQuantity || 0);
          if (column === "passed") return Number(row?.passed || 0);
          if (column === "pending") return Number(row?.pending || 0);
          if (column === "status") return row?.status;
          return "";
        },
      }),
    [filteredRows, sortBy, sortOrder],
  );

  const handleUsePassedToggle = (rowId, checked) => {
    const updateRows = (prevRows) =>
      prevRows.map((row) => {
        if (row.id !== rowId) return row;
        if (row.lineType === "sample") {
          return row;
        }

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
      });

    setRows(updateRows);
    setSampleRows(updateRows);
  };

  const handleQuantityChange = (rowId, rawValue) => {
    const updateRows = (prevRows) =>
      prevRows.map((row) => {
        if (row.id !== rowId || row.usePassed) return row;

        if (rawValue === "") {
          return { ...row, quantityInput: "" };
        }

        const parsed = Number.parseInt(rawValue, 10);
        if (!Number.isFinite(parsed)) return row;

        const clamped = Math.max(0, Math.min(row.maxQuantity, parsed));
        return { ...row, quantityInput: String(clamped) };
      });

    setRows(updateRows);
    setSampleRows(updateRows);
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

    const invoiceNumberValue = String(invoiceNumber || "").trim();
    const stuffedBy = inspectorById.get(String(stuffedById || "").trim());

    if (!shippingDate) {
      setError("Shipping date is required.");
      return;
    }
    const shippingDateIso = toISODateString(shippingDate);
    if (!shippingDateIso || !isValidDDMMYYYY(shippingDate)) {
      setError("Shipping date must be in DD/MM/YYYY format.");
      return;
    }

    if (!vendor) {
      setError("Please select a vendor.");
      return;
    }
    if (!stuffedBy) {
      setError("Please select the inspector who was present during stuffing.");
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
          row.lineType === "sample"
            ? api.patch(`/samples/${row.orderDocumentId}/finalize-shipment`, {
                stuffing_date: shippingDateIso,
                container,
                invoice_number: invoiceNumberValue,
                stuffed_by: stuffedBy,
                quantity: row.quantity,
                remarks: row.itemDescription || "Bulk container shipment",
              })
            : api.patch(`/orders/finalize-order/${row.orderDocumentId}`, {
                stuffing_date: shippingDateIso,
                container,
                invoice_number: invoiceNumberValue,
                stuffed_by: stuffedBy,
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

      setSampleRows([]);
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
          <h2 className="h4 mb-0">Bulk Shipping</h2>
          <div className="d-flex gap-2">
            {canFinalizeShipping && !isViewOnly && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setShowSampleModal(true)}
              >
                Add Sample
              </button>
            )}
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => fetchVendorRows(vendor)}
              disabled={!vendor || loadingRows}
            >
              {loadingRows ? "Loading..." : "Refresh"}
            </button>
          </div>
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
              {!isViewOnly && (
                <div className="col-md-3">
                  <label className="form-label">Container Number</label>
                  <input
                    type="text"
                    className="form-control"
                    value={containerNumber}
                    onChange={(e) => setContainerNumber(e.target.value)}
                    placeholder="Enter container number"
                  />
                </div>
              )}

              {!isViewOnly && (
                <div className="col-md-3">
                  <label className="form-label">Invoice Number (Optional)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="Enter invoice number"
                  />
                </div>
              )}

              {!isViewOnly && (
                <div className="col-md-2">
                  <label className="form-label">Stuffed By</label>
                  <select
                    className="form-select"
                    value={stuffedById}
                    onChange={(e) => setStuffedById(e.target.value)}
                    disabled={loadingInspectors}
                  >
                    <option value="">
                      {loadingInspectors ? "Loading inspectors..." : "Select inspector"}
                    </option>
                    {inspectors.map((inspector) => (
                      <option key={inspector.id} value={inspector.id}>
                        {inspector.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {!isViewOnly && (
                <div className="col-md-2">
                  <label className="form-label">Shipping Date</label>
                  <input
                    type="date"
                    lang="en-GB"
                    className="form-control"
                    value={toISODateString(shippingDate)}
                    onChange={(e) =>
                      setShippingDate(toDDMMYYYYInputValue(e.target.value, ""))
                    }
                  />
                </div>
              )}

              <div className={isViewOnly ? "col-md-4" : "col-md-2"}>
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

              {!isViewOnly && (
                <div className="col-md-2 d-grid">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleBulkFinalize}
                    disabled={
                      saving
                      || loadingRows
                      || loadingInspectors
                      || selectedRows.length === 0
                      || !canFinalizeShipping
                    }
                  >
                    {saving ? "Saving..." : "Finalize Bulk"}
                  </button>
                </div>
              )}
            </div>
            {inspectorError && !isViewOnly && (
              <div className="alert alert-warning mt-3 mb-0">{inspectorError}</div>
            )}
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <div className="d-flex flex-wrap gap-2 mb-2">
              <span className="om-summary-chip">Vendor: {vendor || "N/A"}</span>
              <span className="om-summary-chip">Total Rows: {combinedRows.length}</span>
              <span className="om-summary-chip">
                Filtered Rows: {filteredRows.length}
              </span>
              {!isViewOnly && (
                <span className="om-summary-chip">
                  Selected: {selectedRows.length}
                </span>
              )}
            </div>

            <form className="row g-2 align-items-end" onSubmit={handleApplyFilters}>
              <div className="col-md-4">
                <label className="form-label">Filter by Order ID</label>
                <input
                  type="text"
                  className="form-control"
                  value={draftOrderIdFilter}
                  list="bulk-container-order-id-options"
                  onChange={(e) => setDraftOrderIdFilter(e.target.value)}
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
                  value={draftStatusFilter}
                  onChange={(e) => setDraftStatusFilter(e.target.value)}
                >
                  <option value="all">All Status</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-2 d-grid gap-2">
                <button type="submit" className="btn btn-primary">
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={handleClearFilters}
                >
                  Clear Filters
                </button>
              </div>
            </form>
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
                      <th>
                        <SortHeaderButton
                          label="Order ID"
                          isActive={sortBy === "orderId"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("orderId", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Item Code"
                          isActive={sortBy === "itemCode"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("itemCode", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Item Description"
                          isActive={sortBy === "itemDescription"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("itemDescription", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Order Quantity"
                          isActive={sortBy === "orderQuantity"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("orderQuantity", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Passed"
                          isActive={sortBy === "passed"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("passed", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Pending"
                          isActive={sortBy === "pending"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("pending", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Status"
                          isActive={sortBy === "status"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("status", "asc")}
                        />
                      </th>
                      {!isViewOnly && <th>Check</th>}
                      {!isViewOnly && <th>Quantity</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.length === 0 && (
                      <tr>
                        <td colSpan={isViewOnly ? "7" : "9"} className="text-center py-4">
                          No rows match the current filters.
                        </td>
                      </tr>
                    )}

                    {sortedRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.orderId}</td>
                        <td>{row.itemCode}</td>
                        <td>{row.itemDescription}</td>
                        <td>{row.orderQuantity}</td>
                        <td>{row.passed}</td>
                        <td>{row.pending}</td>
                        <td>{row.status}</td>
                        {!isViewOnly && (
                          <td>
                            <input
                              type="checkbox"
                              checked={row.usePassed}
                              onChange={(e) =>
                                handleUsePassedToggle(row.id, e.target.checked)
                              }
                              disabled={row.maxQuantity <= 0 || row.lineType === "sample"}
                            />
                          </td>
                        )}
                        {!isViewOnly && (
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
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
      {showSampleModal && (
        <SampleModal
          mode="ship"
          vendorOptions={vendors}
          shippingContext={{
            stuffing_date: toISODateString(shippingDate),
            container: String(containerNumber || "").trim(),
            invoice_number: String(invoiceNumber || "").trim(),
            stuffed_by: inspectorById.get(String(stuffedById || "").trim()) || null,
          }}
          onClose={() => setShowSampleModal(false)}
          onShipped={async (sample) => {
            setShowSampleModal(false);
            setSuccess(
              `Sample ${String(sample?.code || "").trim() || ""} added to container ${String(containerNumber || "").trim() || "N/A"}.`,
            );
            await fetchVendorRows(vendor);
          }}
        />
      )}
    </>
  );
};

export default Container;
