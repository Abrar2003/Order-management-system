import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import SortHeaderButton from "../components/SortHeaderButton";
import "../App.css";
import ShippingModal from "../components/ShippingModal";
import EditOrderModal from "../components/EditOrderModal";
import EditSampleModal from "../components/EditSampleModal";
import SampleModal from "../components/SampleModal";
import { getUserFromToken } from "../auth/auth.service";
import { hasShipmentPrivilegeRole } from "../auth/permissions";
import { usePermissions } from "../auth/PermissionContext";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import { hasShipmentRecords } from "../utils/orderStatus";
import { formatCbm } from "../utils/cbm";
import {
  getShipmentItemDisplay,
  getShipmentPoDisplay,
  getShipmentPrimaryQuantityDisplay,
  isSampleShipmentRow,
} from "../utils/shipmentRows";

const EMPTY_SUMMARY = {
  total: 0,
  pending: 0,
  underInspection: 0,
  inspectionDone: 0,
  partialShipped: 0,
  shipped: 0,
  totalStuffedCbm: 0,
  filteredStuffedCbm: 0,
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

const getShipmentSelectionKey = (row = {}) =>
  `${String(row?._id || "").trim()}:${String(row?.shipment_id || "").trim()}`;

const canSelectShipmentRow = (row = {}) =>
  Boolean(row?.shipment_id) &&
  !row?.shipment_checked &&
  Boolean(String(row?.container || "").trim());

const parseSortBy = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  const allowed = new Set([
    "order_id",
    "item_code",
    "vendor",
    "status",
    "order_quantity",
    "stuffing_date",
    "container",
    "invoice_number",
    "shipment_cbm",
    "quantity",
    "pending",
  ]);
  return allowed.has(normalized) ? normalized : DEFAULT_SORT_BY;
};

const parseSortOrder = (value, sortBy = DEFAULT_SORT_BY) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "asc" || normalized === "desc") return normalized;
  return sortBy === DEFAULT_SORT_BY ? "desc" : "asc";
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
  const hasRoleShipmentAccess = hasShipmentPrivilegeRole(user?.role);
  const { hasPermission } = usePermissions();
  const canFinalizeShipping =
    hasPermission("shipments", "edit") || hasRoleShipmentAccess;
  const canCheckShipments =
    hasPermission("shipments", "edit") || hasRoleShipmentAccess;
  const canEditShipments =
    hasPermission("shipments", "edit") || hasRoleShipmentAccess;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [editingSample, setEditingSample] = useState(null);
  const [showSampleModal, setShowSampleModal] = useState(false);
  const [orderIdSearch, setOrderIdSearch] = useState(() =>
    normalizeSearchParam(searchParams.get("order_id")),
  );
  const [draftOrderIdSearch, setDraftOrderIdSearch] = useState(() =>
    normalizeSearchParam(searchParams.get("order_id")),
  );
  const [itemCodeSearch, setItemCodeSearch] = useState(() =>
    normalizeSearchParam(searchParams.get("item_code")),
  );
  const [draftItemCodeSearch, setDraftItemCodeSearch] = useState(() =>
    normalizeSearchParam(searchParams.get("item_code")),
  );
  const [containerSearch, setContainerSearch] = useState(() =>
    normalizeSearchParam(searchParams.get("container")),
  );
  const [draftContainerSearch, setDraftContainerSearch] = useState(() =>
    normalizeSearchParam(searchParams.get("container")),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [draftVendorFilter, setDraftVendorFilter] = useState(() =>
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
  const [limit, setLimit] = useState(() =>
    parseLimit(searchParams.get("limit")),
  );
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [exporting, setExporting] = useState(false);
  const [submittingChecked, setSubmittingChecked] = useState(false);
  const [selectedShipmentKeys, setSelectedShipmentKeys] = useState(new Set());
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [filterOptions, setFilterOptions] = useState({
    vendors: [],
    order_ids: [],
    containers: [],
    item_codes: [],
  });

  const fetchShipments = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await api.get("/orders/shipments", {
        params: {
          order_id: orderIdSearch,
          item_code: itemCodeSearch,
          container: containerSearch,
          vendor: vendorFilter,
          status: statusFilter,
          page,
          limit,
          sort_by: sortBy,
          sort_order: sortOrder,
        },
      });

      setRows(Array.isArray(res?.data?.data) ? res.data.data : []);
      setSelectedShipmentKeys(new Set());
      setSummary(res?.data?.summary || EMPTY_SUMMARY);
      setPage(Math.max(1, Number(res?.data?.pagination?.page || 1)));
      setTotalPages(
        Math.max(1, Number(res?.data?.pagination?.totalPages || 1)),
      );
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
    containerSearch,
    itemCodeSearch,
    limit,
    page,
    orderIdSearch,
    sortBy,
    sortOrder,
    statusFilter,
    vendorFilter,
  ]);

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    const nextOrderIdSearch = normalizeSearchParam(
      searchParams.get("order_id"),
    );
    const nextItemCodeSearch = normalizeSearchParam(
      searchParams.get("item_code"),
    );
    const nextContainerSearch = normalizeSearchParam(
      searchParams.get("container"),
    );
    const nextVendorFilter = normalizeFilterParam(
      searchParams.get("vendor"),
      "all",
    );
    const nextStatusFilter = normalizeFilterParam(
      searchParams.get("status"),
      "all",
    );
    const nextSortBy = parseSortBy(searchParams.get("sort_by"));
    const nextSortOrder = parseSortOrder(
      searchParams.get("sort_order"),
      nextSortBy,
    );
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setOrderIdSearch((prev) =>
      prev === nextOrderIdSearch ? prev : nextOrderIdSearch,
    );
    setDraftOrderIdSearch((prev) =>
      prev === nextOrderIdSearch ? prev : nextOrderIdSearch,
    );
    setItemCodeSearch((prev) =>
      prev === nextItemCodeSearch ? prev : nextItemCodeSearch,
    );
    setDraftItemCodeSearch((prev) =>
      prev === nextItemCodeSearch ? prev : nextItemCodeSearch,
    );
    setContainerSearch((prev) =>
      prev === nextContainerSearch ? prev : nextContainerSearch,
    );
    setDraftContainerSearch((prev) =>
      prev === nextContainerSearch ? prev : nextContainerSearch,
    );
    setVendorFilter((prev) =>
      prev === nextVendorFilter ? prev : nextVendorFilter,
    );
    setDraftVendorFilter((prev) =>
      prev === nextVendorFilter ? prev : nextVendorFilter,
    );
    setStatusFilter((prev) =>
      prev === nextStatusFilter ? prev : nextStatusFilter,
    );
    setSortBy((prev) => (prev === nextSortBy ? prev : nextSortBy));
    setSortOrder((prev) => (prev === nextSortOrder ? prev : nextSortOrder));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    const orderIdValue = normalizeSearchParam(orderIdSearch);
    const itemCodeValue = normalizeSearchParam(itemCodeSearch);
    const containerValue = normalizeSearchParam(containerSearch);

    if (orderIdValue) next.set("order_id", orderIdValue);
    if (itemCodeValue) next.set("item_code", itemCodeValue);
    if (containerValue) next.set("container", containerValue);
    if (vendorFilter && vendorFilter !== "all")
      next.set("vendor", vendorFilter);
    if (statusFilter && statusFilter !== "all")
      next.set("status", statusFilter);
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));
    if (sortBy !== DEFAULT_SORT_BY) next.set("sort_by", sortBy);
    if (sortOrder !== parseSortOrder("", sortBy)) {
      next.set("sort_order", sortOrder);
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
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
    syncedQuery,
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

  const handleApplyFilters = (event) => {
    event?.preventDefault();
    setPage(1);
    setOrderIdSearch(normalizeSearchParam(draftOrderIdSearch));
    setItemCodeSearch(normalizeSearchParam(draftItemCodeSearch));
    setContainerSearch(normalizeSearchParam(draftContainerSearch));
    setVendorFilter(normalizeFilterParam(draftVendorFilter, "all"));
  };

  const handleClearFilters = () => {
    setDraftOrderIdSearch("");
    setDraftItemCodeSearch("");
    setDraftContainerSearch("");
    setDraftVendorFilter("all");
    setOrderIdSearch("");
    setItemCodeSearch("");
    setContainerSearch("");
    setVendorFilter("all");
    setStatusFilter("all");
    setSortBy(DEFAULT_SORT_BY);
    setSortOrder(parseSortOrder("", DEFAULT_SORT_BY));
    setPage(1);
  };

  const canShowFinalizeAction = useCallback(
    (row) =>
      canFinalizeShipping &&
      Number(row?.shippable_quantity || 0) > 0,
    [canFinalizeShipping],
  );

  const canShowEditAction = useCallback(
    (row) =>
      canEditShipments &&
      hasShipmentRecords({ shipment: row?.shipment }),
    [canEditShipments],
  );

  const selectedShipmentRows = useMemo(
    () =>
      rows.filter((row) =>
        selectedShipmentKeys.has(getShipmentSelectionKey(row)),
      ),
    [rows, selectedShipmentKeys],
  );

  const selectedContainerValues = useMemo(
    () =>
      [
        ...new Set(
          selectedShipmentRows
            .map((row) => String(row?.container || "").trim())
            .filter(Boolean)
            .map((containerValue) => containerValue.toLowerCase()),
        ),
      ],
    [selectedShipmentRows],
  );

  const selectableShipmentRows = useMemo(
    () => rows.filter((row) => canSelectShipmentRow(row)),
    [rows],
  );

  const areAllVisibleShipmentsSelected =
    selectableShipmentRows.length > 0 &&
    selectableShipmentRows.every((row) =>
      selectedShipmentKeys.has(getShipmentSelectionKey(row)),
    );

  const isSomeVisibleShipmentSelected =
    selectableShipmentRows.some((row) =>
      selectedShipmentKeys.has(getShipmentSelectionKey(row)),
    );

  const checkSubmitDisabledReason = !canCheckShipments
    ? "Only admin, manager, or dev can submit shipment checks."
    : selectedShipmentRows.length === 0
      ? "Select at least one shipment row."
      : selectedContainerValues.length > 1
        ? "Select rows from only one container before submitting."
        : selectedContainerValues.length === 0
          ? "Selected shipment rows must have a container number."
          : "";

  const handleToggleShipmentSelection = useCallback((row) => {
    const rowKey = getShipmentSelectionKey(row);
    if (!rowKey || !canSelectShipmentRow(row)) return;

    setSelectedShipmentKeys((previous) => {
      const next = new Set(previous);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  }, []);

  const handleToggleAllVisibleShipments = useCallback(() => {
    if (selectableShipmentRows.length === 0) return;

    setSelectedShipmentKeys((previous) => {
      const next = new Set(previous);
      const shouldSelectAll = !selectableShipmentRows.every((row) =>
        next.has(getShipmentSelectionKey(row)),
      );

      selectableShipmentRows.forEach((row) => {
        const rowKey = getShipmentSelectionKey(row);
        if (shouldSelectAll) {
          next.add(rowKey);
        } else {
          next.delete(rowKey);
        }
      });

      return next;
    });
  }, [selectableShipmentRows]);

  const handleSubmitCheckedShipments = useCallback(async () => {
    if (checkSubmitDisabledReason || selectedShipmentRows.length === 0) return;

    try {
      setSubmittingChecked(true);
      const response = await api.patch("/orders/shipments/check", {
        shipments: selectedShipmentRows.map((row) => ({
          order_id: row?._id,
          shipment_id: row?.shipment_id,
          line_type: row?.line_type || "order",
        })),
      });

      alert(response?.data?.message || "Shipment rows checked successfully.");
      setSelectedShipmentKeys(new Set());
      await fetchShipments();
    } catch (err) {
      alert(
        err?.response?.data?.message || "Failed to submit checked shipment rows.",
      );
    } finally {
      setSubmittingChecked(false);
    }
  }, [checkSubmitDisabledReason, fetchShipments, selectedShipmentRows]);

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
    if (isSampleShipmentRow(row)) {
      setEditingSample({
        _id: row?._id,
        code: row?.item_code || "",
        name: row?.sample_name || "",
        description: row?.description || "",
        brand: row?.brand || "",
        vendor: row?.vendor ? String(row.vendor).split(",").map((entry) => entry.trim()).filter(Boolean) : [],
        shipment: Array.isArray(row?.shipment) ? row.shipment : [],
      });
      return;
    }

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

  const handleExport = useCallback(
    async (format = "xlsx") => {
      try {
        setExporting(true);
        const response = await api.get("/orders/shipments/export", {
          responseType: "blob",
          params: {
            order_id: orderIdSearch,
            item_code: itemCodeSearch,
            container: containerSearch,
            vendor: vendorFilter,
            status: statusFilter,
            sort_by: sortBy,
            sort_order: sortOrder,
            format,
          },
        });

        const disposition = String(
          response?.headers?.["content-disposition"] || "",
        );
        const match = disposition.match(
          /filename\*?=(?:UTF-8''|\"?)([^\";]+)/i,
        );
        const fallbackName = `shipments-${new Date().toISOString().slice(0, 10)}.${format === "csv" ? "csv" : "xlsx"}`;
        const fileName = match?.[1]
          ? decodeURIComponent(match[1].trim())
          : fallbackName;

        const blob = new Blob([response.data], {
          type:
            response?.headers?.["content-type"] ||
            (format === "csv"
              ? "text/csv; charset=utf-8"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        });
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
        alert(
          `Failed to export shipment records as ${String(format).toUpperCase()}.`,
        );
      } finally {
        setExporting(false);
      }
    },
    [
      containerSearch,
      itemCodeSearch,
      orderIdSearch,
      sortBy,
      sortOrder,
      statusFilter,
      vendorFilter,
    ],
  );

  return (
    <>
      <Navbar />

      <div className="page-shell py-3 shipments-page-shell">
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
            {canFinalizeShipping && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setShowSampleModal(true)}
              >
                Add Sample
              </button>
            )}
            {canCheckShipments && (
              <button
                type="button"
                className="btn btn-success btn-sm"
                onClick={handleSubmitCheckedShipments}
                disabled={
                  submittingChecked ||
                  loading ||
                  Boolean(checkSubmitDisabledReason)
                }
                title={checkSubmitDisabledReason}
              >
                {submittingChecked
                  ? "Submitting..."
                  : `Submit Checked${selectedShipmentRows.length ? ` (${selectedShipmentRows.length})` : ""}`}
              </button>
            )}
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
            <form className="row g-2 align-items-end shipments-filter-form" onSubmit={handleApplyFilters}>
              <div className="col-lg-3 col-md-6">
                <label className="form-label">Search by Order ID</label>
                <input
                  type="text"
                  className="form-control"
                  value={draftOrderIdSearch}
                  list="shipment-order-options"
                  onChange={(e) => setDraftOrderIdSearch(e.target.value)}
                  placeholder="Enter order ID"
                />
                <datalist id="shipment-order-options">
                  {filterOptions.order_ids.map((orderId) => (
                    <option key={orderId} value={orderId} />
                  ))}
                </datalist>
              </div>
              <div className="col-lg-3 col-md-6">
                <label className="form-label">Search by Item Code</label>
                <input
                  type="text"
                  className="form-control"
                  value={draftItemCodeSearch}
                  list="shipment-item-code-options"
                  onChange={(e) => setDraftItemCodeSearch(e.target.value)}
                  placeholder="Enter item code"
                />
                <datalist id="shipment-item-code-options">
                  {filterOptions.item_codes.map((itemCode) => (
                    <option key={itemCode} value={itemCode} />
                  ))}
                </datalist>
              </div>
              <div className="col-lg-2 col-md-6">
                <label className="form-label">Search by Container Number</label>
                <input
                  type="text"
                  className="form-control"
                  value={draftContainerSearch}
                  list="shipment-container-options"
                  onChange={(e) => setDraftContainerSearch(e.target.value)}
                  placeholder="Enter container number"
                />
                <datalist id="shipment-container-options">
                  {filterOptions.containers.map((containerValue) => (
                    <option key={containerValue} value={containerValue} />
                  ))}
                </datalist>
              </div>
              <div className="col-lg-2 col-md-6">
                <label className="form-label">Filter by Vendor</label>
                <select
                  className="form-select"
                  value={draftVendorFilter}
                  onChange={(e) => setDraftVendorFilter(e.target.value)}
                >
                  <option value="all">All Vendors</option>
                  {filterOptions.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-lg-2 col-md-12 shipments-filter-actions">
                <button type="submit" className="btn btn-primary flex-fill">
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary flex-fill"
                  onClick={handleClearFilters}
                >
                  Clear
                </button>
              </div>
            </form>
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
              className={`btn btn-sm ${statusFilter === "Pending" ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => {
                setStatusFilter("Pending");
                setPage(1);
              }}
            >
              Pending: {summary.pending ?? 0}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === "Under Inspection" ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => {
                setStatusFilter("Under Inspection");
                setPage(1);
              }}
            >
              Under Inspection: {summary.underInspection ?? 0}
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
            <span className="om-summary-chip">
              Total Records: {totalRecords}
            </span>
            <span className="om-summary-chip">
              Total Stuffed CBM: {formatCbm(
                summary.filteredStuffedCbm ?? summary.totalStuffedCbm,
              )}
            </span>
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
              <div className="table-responsive shipments-table-wrap">
                <table className="table table-striped table-hover align-middle om-table mb-0 shipments-table">
                  <thead className="table-primary">
                    <tr>
                      {canCheckShipments && (
                        <th className="shipments-col-check">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={areAllVisibleShipmentsSelected}
                            ref={(element) => {
                              if (element) {
                                element.indeterminate =
                                  !areAllVisibleShipmentsSelected &&
                                  isSomeVisibleShipmentSelected;
                              }
                            }}
                            onChange={handleToggleAllVisibleShipments}
                            disabled={
                              submittingChecked ||
                              selectableShipmentRows.length === 0
                            }
                            title="Select all eligible shipment rows on this page"
                          />
                        </th>
                      )}
                      <th className="shipments-col-po">
                        <SortHeaderButton
                          label="PO"
                          isActive={sortBy === "order_id"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("order_id", "asc")}
                        />
                      </th>
                      <th className="shipments-col-item">
                        <SortHeaderButton
                          label="Item Code"
                          isActive={sortBy === "item_code"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("item_code", "asc")}
                        />
                      </th>
                      <th className="shipments-col-vendor">
                        <SortHeaderButton
                          label="Vendor"
                          isActive={sortBy === "vendor"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("vendor", "asc")}
                        />
                      </th>
                      <th className="shipments-col-description">
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                        >
                          Description
                        </button>
                      </th>
                      <th className="shipments-col-order-qty">
                        <SortHeaderButton
                          label="Order Quantity"
                          isActive={sortBy === "order_quantity"}
                          direction={sortOrder}
                          onClick={() =>
                            handleSortColumn("order_quantity", "desc")
                          }
                        />
                      </th>
                      <th className="shipments-col-status">
                        <SortHeaderButton
                          label="Status"
                          isActive={sortBy === "status"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("status", "asc")}
                        />
                      </th>
                      <th className="shipments-col-date">
                        <SortHeaderButton
                          label="Stuffing Date"
                          isActive={sortBy === "stuffing_date"}
                          direction={sortOrder}
                          onClick={() =>
                            handleSortColumn("stuffing_date", "desc")
                          }
                        />
                      </th>
                      <th className="shipments-col-container">
                        <SortHeaderButton
                          label="Container Number"
                          isActive={sortBy === "container"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("container", "asc")}
                        />
                      </th>
                      <th className="shipments-col-invoice">
                        <SortHeaderButton
                          label="Invoice Number"
                          isActive={sortBy === "invoice_number"}
                          direction={sortOrder}
                          onClick={() =>
                            handleSortColumn("invoice_number", "asc")
                          }
                        />
                      </th>
                      <th className="shipments-col-qty">
                        <SortHeaderButton
                          label="Quantity"
                          isActive={sortBy === "quantity"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("quantity", "desc")}
                        />
                      </th>
                      <th className="shipments-col-qty">
                        <SortHeaderButton
                          label="Stuffed CBM"
                          isActive={sortBy === "shipment_cbm"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("shipment_cbm", "desc")}
                        />
                      </th>
                      <th className="shipments-col-pending">
                        <SortHeaderButton
                          label="Pending"
                          isActive={sortBy === "pending"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("pending", "desc")}
                        />
                      </th>
                      <th className="shipments-col-remarks">
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                        >
                          Remarks
                        </button>
                      </th>
                      {canFinalizeShipping && <th className="shipments-col-action">
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                        >
                          Finalize
                        </button>
                      </th>}
                      {canEditShipments && <th className="shipments-col-action">
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                        >
                          Edit
                        </button>
                      </th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={
                            (canCheckShipments ? 1 : 0) +
                            (canFinalizeShipping ? 14 : 13) +
                            (canEditShipments ? 1 : 0)
                          }
                          className="text-center py-4"
                        >
                          No records found
                        </td>
                      </tr>
                    )}

                    {rows.map((row, index) => (
                      <tr
                        key={
                          row?.shipment_id ||
                          `${row.order_id}-${row.item_code}-${index}`
                        }
                      >
                        {canCheckShipments && (
                          <td className="shipments-col-check">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={
                                Boolean(row?.shipment_checked) ||
                                selectedShipmentKeys.has(getShipmentSelectionKey(row))
                              }
                              onChange={() => handleToggleShipmentSelection(row)}
                              disabled={
                                submittingChecked ||
                                !canSelectShipmentRow(row)
                              }
                              title={
                                row?.shipment_checked
                                  ? "This shipment row is already checked."
                                  : !row?.shipment_id
                                    ? "No shipment row is available to check."
                                    : !String(row?.container || "").trim()
                                      ? "Container number is required before checking."
                                      : "Select this shipment row"
                              }
                            />
                          </td>
                        )}
                        <td className="shipments-col-po">{getShipmentPoDisplay(row)}</td>
                        <td className="shipments-col-item">{getShipmentItemDisplay(row)}</td>
                        <td className="shipments-col-vendor">{row?.vendor || "N/A"}</td>
                        <td className="shipments-col-description">{row?.description || "N/A"}</td>
                        <td className="shipments-col-order-qty">
                          {getShipmentPrimaryQuantityDisplay(row)}
                        </td>
                        <td className="shipments-col-status">{row?.status || "N/A"}</td>
                        <td className="shipments-col-date">{formatDateDDMMYYYY(row?.stuffing_date)}</td>
                        <td className="shipments-col-container">{row?.container || "N/A"}</td>
                        <td className="shipments-col-invoice">{row?.invoice_number || "N/A"}</td>
                        <td className="shipments-col-qty">{row?.quantity ?? "N/A"}</td>
                        <td className="shipments-col-qty">{formatCbm(row?.shipment_cbm)}</td>
                        <td className="shipments-col-pending">{row?.pending ?? "N/A"}</td>
                        <td className="shipments-col-remarks">{row?.remaining_remarks || "N/A"}</td>
                        {canFinalizeShipping && (
                          <td className="shipments-col-action">
                            {canShowFinalizeAction(row) ? (
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm shipments-action-btn"
                                onClick={() => handleOpenShippingModal(row)}
                              >
                                Finalize
                              </button>
                            ) : isSampleShipmentRow(row) ? (
                              <span className="text-secondary small">Added via sample</span>
                            ) : (
                              <span className="text-secondary small">N/A</span>
                            )}
                          </td>
                        )}
                        {canEditShipments && (
                          <td className="shipments-col-action">
                            {canShowEditAction(row) ? (
                              <button
                                type="button"
                                className="btn btn-outline-primary btn-sm shipments-action-btn"
                                onClick={() => handleOpenEditModal(row)}
                              >
                                Edit
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
      {editingSample && (
        <EditSampleModal
          sample={editingSample}
          onClose={() => setEditingSample(null)}
          onSuccess={() => {
            setEditingSample(null);
            fetchShipments();
          }}
        />
      )}
      {showSampleModal && (
        <SampleModal
          mode="ship"
          brandOptions={[]}
          vendorOptions={Array.isArray(filterOptions?.vendors) ? filterOptions.vendors : []}
          onClose={() => setShowSampleModal(false)}
          onShipped={() => {
            setShowSampleModal(false);
            fetchShipments();
          }}
        />
      )}
    </>
  );
};

export default Shipments;
