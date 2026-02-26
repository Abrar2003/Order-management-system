import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import "../App.css";
import ShippingModal from "../components/ShippingModal";
import EditOrderModal from "../components/EditOrderModal";
import { getUserFromToken } from "../auth/auth.utils";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";

const useDebouncedValue = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
};

const EMPTY_SUMMARY = {
  total: 0,
  inspectionDone: 0,
  partialShipped: 0,
  shipped: 0,
};

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];
const DEFAULT_SORT_BY = "stuffing_date";

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};

const normalizeFilterParam = (value, fallback = "all") => {
  const cleaned = String(value || "").trim();
  if (!cleaned) return fallback;
  return cleaned;
};

const normalizeSearchParam = (value) => String(value || "").trim();

const parseSortBy = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  const allowed = new Set([
    "order_id",
    "item_code",
    "vendor",
    "order_quantity",
    "stuffing_date",
    "container",
    "quantity",
    "pending",
  ]);
  return allowed.has(normalized) ? normalized : DEFAULT_SORT_BY;
};

const parseSortOrder = (value, sortBy = DEFAULT_SORT_BY) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "asc" || normalized === "desc") return normalized;
  return sortBy === DEFAULT_SORT_BY ? "desc" : "asc";
};

const isShipmentEditableStatus = (statusValue) => {
  const normalized = String(statusValue || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "partial shipped"
    || normalized === "partially shipped"
    || normalized === "shipped"
  );
};

const Shipments = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "shipments");
  const initialSortBy = parseSortBy(searchParams.get("sort_by"));
  const initialSortOrder = parseSortOrder(
    searchParams.get("sort_order"),
    initialSortBy,
  );
  const user = getUserFromToken();
  const normalizedRole = String(user?.role || "").trim().toLowerCase();
  const isAdmin = normalizedRole === "admin";
  const canFinalizeShipping = ["admin", "manager", "dev"].includes(
    normalizedRole,
  );

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [orderIdSearch, setOrderIdSearch] = useState(() =>
    normalizeSearchParam(searchParams.get("order_id")),
  );
  const [itemCodeSearch, setItemCodeSearch] = useState(() =>
    normalizeSearchParam(searchParams.get("item_code")),
  );
  const [containerSearch, setContainerSearch] = useState(() =>
    normalizeSearchParam(searchParams.get("container")),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [statusFilter, setStatusFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("status"), "all"),
  );
  const [sortBy, setSortBy] = useState(initialSortBy);
  const [sortOrder, setSortOrder] = useState(initialSortOrder);
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [exporting, setExporting] = useState(false);
  const [filterOptions, setFilterOptions] = useState({
    vendors: [],
    order_ids: [],
    containers: [],
    item_codes: [],
  });

  const debouncedOrderSearch = useDebouncedValue(orderIdSearch, 300);
  const debouncedItemCodeSearch = useDebouncedValue(itemCodeSearch, 300);
  const debouncedContainerSearch = useDebouncedValue(containerSearch, 300);

  const fetchShipments = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await api.get("/orders/shipments", {
        params: {
          order_id: debouncedOrderSearch,
          item_code: debouncedItemCodeSearch,
          container: debouncedContainerSearch,
          vendor: vendorFilter,
          status: statusFilter,
          page,
          limit,
          sort_by: sortBy,
          sort_order: sortOrder,
        },
      });

      setRows(Array.isArray(res?.data?.data) ? res.data.data : []);
      setSummary(res?.data?.summary || EMPTY_SUMMARY);
      setPage(Math.max(1, Number(res?.data?.pagination?.page || 1)));
      setTotalPages(Math.max(1, Number(res?.data?.pagination?.totalPages || 1)));
      setTotalRecords(Number(res?.data?.pagination?.totalRecords || 0));
      setFilterOptions({
        vendors: Array.isArray(res?.data?.filters?.vendors)
          ? res.data.filters.vendors
          : [],
        order_ids: Array.isArray(res?.data?.filters?.order_ids)
          ? res.data.filters.order_ids
          : [],
        containers: Array.isArray(res?.data?.filters?.containers)
          ? res.data.filters.containers
          : [],
        item_codes: Array.isArray(res?.data?.filters?.item_codes)
          ? res.data.filters.item_codes
          : [],
      });
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load shipments.");
      setRows([]);
      setSummary(EMPTY_SUMMARY);
      setTotalPages(1);
      setTotalRecords(0);
      setFilterOptions({
        vendors: [],
        order_ids: [],
        containers: [],
        item_codes: [],
      });
    } finally {
      setLoading(false);
    }
  }, [
    debouncedContainerSearch,
    debouncedItemCodeSearch,
    debouncedOrderSearch,
    limit,
    page,
    sortBy,
    sortOrder,
    statusFilter,
    vendorFilter,
  ]);

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  useEffect(() => {
    const nextOrderIdSearch = normalizeSearchParam(searchParams.get("order_id"));
    const nextItemCodeSearch = normalizeSearchParam(searchParams.get("item_code"));
    const nextContainerSearch = normalizeSearchParam(searchParams.get("container"));
    const nextVendorFilter = normalizeFilterParam(searchParams.get("vendor"), "all");
    const nextStatusFilter = normalizeFilterParam(searchParams.get("status"), "all");
    const nextSortBy = parseSortBy(searchParams.get("sort_by"));
    const nextSortOrder = parseSortOrder(
      searchParams.get("sort_order"),
      nextSortBy,
    );
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setOrderIdSearch((prev) => (prev === nextOrderIdSearch ? prev : nextOrderIdSearch));
    setItemCodeSearch((prev) => (prev === nextItemCodeSearch ? prev : nextItemCodeSearch));
    setContainerSearch((prev) => (prev === nextContainerSearch ? prev : nextContainerSearch));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setStatusFilter((prev) => (prev === nextStatusFilter ? prev : nextStatusFilter));
    setSortBy((prev) => (prev === nextSortBy ? prev : nextSortBy));
    setSortOrder((prev) => (prev === nextSortOrder ? prev : nextSortOrder));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams();
    const orderIdValue = normalizeSearchParam(orderIdSearch);
    const itemCodeValue = normalizeSearchParam(itemCodeSearch);
    const containerValue = normalizeSearchParam(containerSearch);

    if (orderIdValue) next.set("order_id", orderIdValue);
    if (itemCodeValue) next.set("item_code", itemCodeValue);
    if (containerValue) next.set("container", containerValue);
    if (vendorFilter && vendorFilter !== "all") next.set("vendor", vendorFilter);
    if (statusFilter && statusFilter !== "all") next.set("status", statusFilter);
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));
    if (sortBy !== DEFAULT_SORT_BY) next.set("sort_by", sortBy);
    if (sortOrder !== parseSortOrder("", sortBy)) {
      next.set("sort_order", sortOrder);
    }

    const nextQuery = next.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery !== currentQuery) {
      setSearchParams(next, { replace: true });
    }
  }, [
    containerSearch,
    itemCodeSearch,
    limit,
    orderIdSearch,
    page,
    searchParams,
    setSearchParams,
    sortBy,
    sortOrder,
    statusFilter,
    vendorFilter,
  ]);

  const handleSortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      setPage(1);
      if (sortBy === column) {
        setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
        return;
      }
      setSortBy(column);
      setSortOrder(defaultDirection);
    },
    [sortBy],
  );

  const sortIndicator = useCallback(
    (column) => {
      if (sortBy !== column) return "";
      return sortOrder === "asc" ? " (asc)" : " (desc)";
    },
    [sortBy, sortOrder],
  );

  const canShowFinalizeAction = useCallback(
    (row) =>
      canFinalizeShipping &&
      ["Inspection Done", "Partial Shipped"].includes(row?.status),
    [canFinalizeShipping],
  );

  const canShowEditAction = useCallback(
    (row) =>
      isAdmin &&
      isShipmentEditableStatus(row?.status),
    [isAdmin],
  );

  const handleOpenShippingModal = useCallback((row) => {
    const normalizedOrder = {
      _id: row?._id,
      order_id: row?.order_id || "",
      item: {
        item_code: row?.item?.item_code || row?.item_code || "",
        description: row?.item?.description || row?.description || "",
      },
      quantity: Number(row?.order_quantity || 0),
      shipment: Array.isArray(row?.shipment) ? row.shipment : [],
      status: row?.status || "",
    };

    setSelectedOrder(normalizedOrder);
  }, []);

  const handleOpenEditModal = useCallback((row) => {
    const normalizedOrder = {
      _id: row?._id,
      order_id: row?.order_id || "",
      brand: row?.brand || "",
      vendor: row?.vendor || "",
      item: {
        item_code: row?.item?.item_code || row?.item_code || "",
        description: row?.item?.description || row?.description || "",
      },
      quantity: Number(row?.order_quantity || 0),
      shipment: Array.isArray(row?.shipment) ? row.shipment : [],
      status: row?.status || "",
    };

    setEditingOrder(normalizedOrder);
  }, []);

  const handleExport = useCallback(async (format = "xlsx") => {
    try {
      setExporting(true);
      const response = await api.get("/orders/shipments/export", {
        responseType: "blob",
        params: {
          order_id: debouncedOrderSearch,
          item_code: debouncedItemCodeSearch,
          container: debouncedContainerSearch,
          vendor: vendorFilter,
          status: statusFilter,
          sort_by: sortBy,
          sort_order: sortOrder,
          format,
        },
      });

      const disposition = String(response?.headers?.["content-disposition"] || "");
      const match = disposition.match(/filename\*?=(?:UTF-8''|\"?)([^\";]+)/i);
      const fallbackName = `shipments-${new Date().toISOString().slice(0, 10)}.${format === "csv" ? "csv" : "xlsx"}`;
      const fileName = match?.[1]
        ? decodeURIComponent(match[1].trim())
        : fallbackName;

      const blob = new Blob(
        [response.data],
        {
          type:
            response?.headers?.["content-type"]
            || (format === "csv"
              ? "text/csv; charset=utf-8"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        },
      );
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert(`Failed to export shipment records as ${String(format).toUpperCase()}.`);
    } finally {
      setExporting(false);
    }
  }, [
    debouncedContainerSearch,
    debouncedItemCodeSearch,
    debouncedOrderSearch,
    sortBy,
    sortOrder,
    statusFilter,
    vendorFilter,
  ]);

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
          <h2 className="h4 mb-0">Shipments</h2>
          <div className="d-flex gap-2">
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={() => handleExport("xlsx")}
              disabled={exporting}
            >
              {exporting ? "Exporting..." : "Export XLSX"}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => handleExport("csv")}
              disabled={exporting}
            >
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={fetchShipments}
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <div className="row g-2 align-items-end">
              <div className="col-md-3">
                <label className="form-label">Search by Order ID</label>
                <input
                  type="text"
                  className="form-control"
                  value={orderIdSearch}
                  list="shipment-order-options"
                  onChange={(e) => {
                    setOrderIdSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Enter order ID"
                />
                <datalist id="shipment-order-options">
                  {filterOptions.order_ids.map((orderId) => (
                    <option key={orderId} value={orderId} />
                  ))}
                </datalist>
              </div>
              <div className="col-md-3">
                <label className="form-label">Search by Item Code</label>
                <input
                  type="text"
                  className="form-control"
                  value={itemCodeSearch}
                  list="shipment-item-code-options"
                  onChange={(e) => {
                    setItemCodeSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Enter item code"
                />
                <datalist id="shipment-item-code-options">
                  {filterOptions.item_codes.map((itemCode) => (
                    <option key={itemCode} value={itemCode} />
                  ))}
                </datalist>
              </div>
              <div className="col-md-3">
                <label className="form-label">Search by Container Number</label>
                <input
                  type="text"
                  className="form-control"
                  value={containerSearch}
                  list="shipment-container-options"
                  onChange={(e) => {
                    setContainerSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Enter container number"
                />
                <datalist id="shipment-container-options">
                  {filterOptions.containers.map((containerValue) => (
                    <option key={containerValue} value={containerValue} />
                  ))}
                </datalist>
              </div>
              <div className="col-md-2">
                <label className="form-label">Filter by Vendor</label>
                <select
                  className="form-select"
                  value={vendorFilter}
                  onChange={(e) => {
                    setVendorFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All Vendors</option>
                  {filterOptions.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-1 d-grid">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    setOrderIdSearch("");
                    setItemCodeSearch("");
                    setContainerSearch("");
                    setVendorFilter("all");
                    setStatusFilter("all");
                    setSortBy(DEFAULT_SORT_BY);
                    setSortOrder(parseSortOrder("", DEFAULT_SORT_BY));
                    setPage(1);
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === "all" ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => {
                setStatusFilter("all");
                setPage(1);
              }}
            >
              Total Items: {summary.total}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === "Inspection Done" ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => {
                setStatusFilter("Inspection Done");
                setPage(1);
              }}
            >
              Inspection Done: {summary.inspectionDone}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === "Partial Shipped" ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => {
                setStatusFilter("Partial Shipped");
                setPage(1);
              }}
            >
              Partial Shipped: {summary.partialShipped}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === "Shipped" ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => {
                setStatusFilter("Shipped");
                setPage(1);
              }}
            >
              Shipped: {summary.shipped}
            </button>
            <span className="om-summary-chip">
              Showing: {statusFilter === "all" ? "All" : statusFilter}
            </span>
            <span className="om-summary-chip">Total Records: {totalRecords}</span>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            {error}
          </div>
        )}

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-4">Loading...</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle om-table mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("order_id", "asc")}
                        >
                          PO{sortIndicator("order_id")}
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("item_code", "asc")}
                        >
                          Item Code{sortIndicator("item_code")}
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("vendor", "asc")}
                        >
                          Vendor{sortIndicator("vendor")}
                        </button>
                      </th>
                      <th>Description</th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("order_quantity", "desc")}
                        >
                          Order Quantity{sortIndicator("order_quantity")}
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("stuffing_date", "desc")}
                        >
                          Stuffing Date{sortIndicator("stuffing_date")}
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("container", "asc")}
                        >
                          Container Number{sortIndicator("container")}
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("quantity", "desc")}
                        >
                          Quantity{sortIndicator("quantity")}
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("pending", "desc")}
                        >
                          Pending{sortIndicator("pending")}
                        </button>
                      </th>
                      <th>Remarks</th>
                      {canFinalizeShipping && <th>Finalize</th>}
                      {isAdmin && <th>Edit</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={
                            (canFinalizeShipping ? 11 : 10) + (isAdmin ? 1 : 0)
                          }
                          className="text-center py-4"
                        >
                          No records found
                        </td>
                      </tr>
                    )}

                    {rows.map((row, index) => (
                      <tr key={row?.shipment_id || `${row.order_id}-${row.item_code}-${index}`}>
                        <td>{row?.order_id || "N/A"}</td>
                        <td>{row?.item_code || "N/A"}</td>
                        <td>{row?.vendor || "N/A"}</td>
                        <td>{row?.description || "N/A"}</td>
                        <td>{row?.order_quantity || "N/A"}</td>
                        <td>{formatDateDDMMYYYY(row?.stuffing_date)}</td>
                        <td>{row?.container || "N/A"}</td>
                        <td>{row?.quantity ?? "N/A"}</td>
                        <td>{row?.pending ?? "N/A"}</td>
                        <td>{row?.remaining_remarks || "N/A"}</td>
                        {canFinalizeShipping && (
                          <td>
                            {canShowFinalizeAction(row) ? (
                              <button
                                type="button"
                                className="btn btn-outline-secondary"
                                onClick={() => handleOpenShippingModal(row)}
                              >
                                Finalize Shipping
                              </button>
                            ) : (
                              <span className="text-secondary small">N/A</span>
                            )}
                          </td>
                        )}
                        {isAdmin && (
                          <td>
                            {canShowEditAction(row) ? (
                              <button
                                type="button"
                                className="btn btn-outline-primary btn-sm"
                                onClick={() => handleOpenEditModal(row)}
                              >
                                Edit Shipping
                              </button>
                            ) : (
                              <span className="text-secondary small">N/A</span>
                            )}
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

        <div className="d-flex justify-content-center align-items-center gap-3 mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Prev
          </button>
          <span className="small fw-semibold">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          >
            Next
          </button>
        </div>

        <div className="d-flex justify-content-end mt-3">
          <div className="input-group om-limit-control">
            <span className="input-group-text">Limit</span>
            <select
              className="form-select"
              value={limit}
              onChange={(e) => {
                setPage(1);
                setLimit(Number(e.target.value));
              }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      </div>
      {selectedOrder && (
        <ShippingModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onSuccess={() => {
            setSelectedOrder(null);
            fetchShipments();
          }}
        />
      )}
      {editingOrder && (
        <EditOrderModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSuccess={() => {
            setEditingOrder(null);
            fetchShipments();
          }}
        />
      )}
    </>
  );
};

export default Shipments;
