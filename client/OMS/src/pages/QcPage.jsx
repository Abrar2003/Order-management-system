import { useCallback, useEffect, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import SortHeaderButton from "../components/SortHeaderButton";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import TransferQcRequestModal from "../components/TransferQcRequestModal";
import AlignQCModal from "../components/AlignQcModal";
import { getUserFromToken } from "../auth/auth.utils";
import { isViewOnlyUser } from "../auth/permissions";
import { usePermissions } from "../auth/PermissionContext";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import {
  formatDateDDMMYYYY,
  toDDMMYYYYInputValue,
  toISODateString,
} from "../utils/date";
import { formatPositiveCbm } from "../utils/cbm";
import { canTransferLatestRequestToday } from "../utils/qcRequests";
import "../App.css";

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const normalizeInspectionStatus = (value) =>
  String(value || "").trim().toLowerCase();

const isGoodsNotReady = (inspection = {}) => {
  const explicitStatus = normalizeInspectionStatus(inspection?.status);
  if (explicitStatus === "goods not ready") return true;

  const goodsNotReady = inspection?.goods_not_ready;
  if (typeof goodsNotReady === "boolean") return goodsNotReady;

  if (typeof goodsNotReady === "string") {
    return ["true", "1", "yes", "y"].includes(
      String(goodsNotReady).trim().toLowerCase(),
    );
  }

  if (!goodsNotReady || typeof goodsNotReady !== "object") {
    return false;
  }

  if (goodsNotReady.ready !== undefined) {
    return ["true", "1", "yes", "y"].includes(
      String(goodsNotReady.ready).trim().toLowerCase(),
    );
  }

  return Boolean(String(goodsNotReady.reason || "").trim());
};

const getQcInspectionStatus = (qc = {}) => {
  const derivedStatus = normalizeInspectionStatus(qc?.inspection_status);
  if (derivedStatus === "rejected") return "Rejected";
  if (derivedStatus === "transfered" || derivedStatus === "transferred") {
    return "Transferred";
  }
  if (derivedStatus === "goods not ready") return "Goods Not Ready";
  if (derivedStatus === "inspection done") return "Inspection Done";
  if (derivedStatus === "pending") return "Pending";

  const lastInspection = qc?.last_inspection || {};
  const explicitStatus = normalizeInspectionStatus(lastInspection?.status);

  if (explicitStatus === "rejected") {
    return "Rejected";
  }

  if (explicitStatus === "transfered" || explicitStatus === "transferred") {
    return "Transferred";
  }

  if (isGoodsNotReady(lastInspection)) {
    return "Goods Not Ready";
  }

  if (
    toSafeNumber(lastInspection?.checked) > 0 ||
    explicitStatus === "inspection done"
  ) {
    return "Inspection Done";
  }

  return "Pending";
};

const INSPECTION_STATUS_OPTIONS = [
  "Pending",
  "Inspection Done",
  "Goods Not Ready",
  "Rejected",
  "Transferred",
];

const renderInspectionStatus = (qc = {}) => {
  const inspectionStatus = getQcInspectionStatus(qc);

  if (inspectionStatus === "Rejected") {
    return <span className="text-danger fw-semibold">Rejected</span>;
  }

  if (inspectionStatus === "Transferred") {
    return <span className="text-warning fw-semibold">Transferred</span>;
  }

  if (inspectionStatus === "Goods Not Ready") {
    return <span className="text-danger fw-semibold">Goods Not Ready</span>;
  }

  if (inspectionStatus === "Inspection Done") {
    return <span className="text-success fw-semibold">Inspection Done</span>;
  }

  return <span className="text-danger fw-semibold">Pending</span>;
};

const getPendingAlignmentInfo = (qc = {}) => {
  const pendingQty = Math.max(
    0,
    toSafeNumber(
      qc?.quantities?.pending ??
        (toSafeNumber(qc?.quantities?.client_demand)
          - toSafeNumber(qc?.quantities?.qc_passed)),
    ),
  );
  const requestedQty = Math.max(0, toSafeNumber(qc?.quantities?.quantity_requested));
  const hasRequestHistory =
    Array.isArray(qc?.request_history) && qc.request_history.length > 0;
  const hasRequest = hasRequestHistory || requestedQty > 0;
  const isAligned = hasRequest && (pendingQty <= 0 || requestedQty >= pendingQty);

  if (!hasRequest) {
    return {
      pendingQty,
      requestedQty,
      isAligned: false,
      tooltip: "QC request is not aligned yet.",
    };
  }

  if (pendingQty <= 0) {
    return {
      pendingQty,
      requestedQty,
      isAligned: true,
      tooltip: "No pending quantity.",
    };
  }

  if (isAligned) {
    return {
      pendingQty,
      requestedQty,
      isAligned: true,
      tooltip: `QC aligned for pending quantity (requested ${requestedQty}, pending ${pendingQty}).`,
    };
  }

  return {
    pendingQty,
    requestedQty,
    isAligned: false,
    tooltip: `QC request is partial (requested ${requestedQty}, pending ${pendingQty}). Update is allowed; realign if needed.`,
  };
};

const DEFAULT_SORT_BY = "request_date";
const DEFAULT_PAGE = 1;
const TABLE_COLUMN_COUNT = 12;

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const normalizeQueryText = (value) => String(value || "").trim();

const parseSortBy = (value) => {
  const normalized = normalizeQueryText(value).toLowerCase();
  if (normalized === "order_id") return "order_id";
  if (normalized === "request_date") return "request_date";
  if (normalized === "createdat" || normalized === "created_at") return "createdAt";
  return DEFAULT_SORT_BY;
};

const parseSortOrder = (value, sortBy = DEFAULT_SORT_BY) => {
  const normalized = normalizeQueryText(value).toLowerCase();
  if (normalized === "asc" || normalized === "desc") return normalized;
  return sortBy === "order_id" ? "asc" : "desc";
};

const buildQcFilterStateFromSearchParams = (
  searchParams,
  canUseInspectorFilter,
  requestedItemCode = "",
) => {
  const nextSearch =
    normalizeQueryText(searchParams.get("search")) || requestedItemCode;
  const nextFromRaw = normalizeQueryText(searchParams.get("from"));
  const nextToRaw = normalizeQueryText(searchParams.get("to"));

  return {
    search: nextSearch,
    inspector: canUseInspectorFilter
      ? normalizeQueryText(searchParams.get("inspector"))
      : "",
    vendor: normalizeQueryText(searchParams.get("vendor")),
    from: toDDMMYYYYInputValue(nextFromRaw, nextFromRaw),
    to: toDDMMYYYYInputValue(nextToRaw, nextToRaw),
    order: normalizeQueryText(searchParams.get("order")),
    inspectionStatus: normalizeQueryText(searchParams.get("inspection_status")),
  };
};

const areQcFilterStatesEqual = (left = {}, right = {}) =>
  normalizeQueryText(left.search) === normalizeQueryText(right.search)
  && normalizeQueryText(left.inspector) === normalizeQueryText(right.inspector)
  && normalizeQueryText(left.vendor) === normalizeQueryText(right.vendor)
  && normalizeQueryText(left.from) === normalizeQueryText(right.from)
  && normalizeQueryText(left.to) === normalizeQueryText(right.to)
  && normalizeQueryText(left.order) === normalizeQueryText(right.order)
  && normalizeQueryText(left.inspectionStatus) === normalizeQueryText(right.inspectionStatus);

const QCPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "qc-list");
  const requestedItemCode = normalizeQueryText(searchParams.get("item_code"));
  const initialSortBy = parseSortBy(
    searchParams.get("sort_by") ?? searchParams.get("sort"),
  );
  const initialSortOrder = parseSortOrder(
    searchParams.get("sort_order"),
    initialSortBy,
  );
  const token = localStorage.getItem("token");
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = getUserFromToken();
  const { hasPermission } = usePermissions();
  const isViewOnly = isViewOnlyUser(currentUser);
  const normalizedRole = String(currentUser?.role || "").trim().toLowerCase();
  const isQcUser = normalizedRole === "qc";
  const canAlignQc = hasPermission("qc", "assign");
  const canTransferRequest = hasPermission("qc", "assign");
  const showActionColumn = !isViewOnly;
  const tableColumnCount = showActionColumn ? TABLE_COLUMN_COUNT : TABLE_COLUMN_COUNT - 1;
  const canUseInspectorFilter = !isQcUser;
  const canExportQcList = hasPermission("qc", "export");
  const initialFilters = buildQcFilterStateFromSearchParams(
    searchParams,
    canUseInspectorFilter,
    requestedItemCode,
  );
  const [qcList, setQcList] = useState([]);
  const [inspectors, setInspectors] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [orders, setOrders] = useState([]);
  const [itemCodes, setItemCodes] = useState([]);

  // draft filters shown in inputs
  const [search, setSearch] = useState(initialFilters.search);
  const [inspector, setInspector] = useState(initialFilters.inspector);
  const [vendor, setVendor] = useState(initialFilters.vendor);
  const [from, setFrom] = useState(initialFilters.from);
  const [to, setTo] = useState(initialFilters.to);
  const [order, setOrder] = useState(initialFilters.order);
  const [inspectionStatus, setInspectionStatus] = useState(
    initialFilters.inspectionStatus,
  );

  // applied filters used for API + URL sync
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [sortBy, setSortBy] = useState(initialSortBy);
  const [sortOrder, setSortOrder] = useState(initialSortOrder);

  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), DEFAULT_PAGE),
  );
  const [totalPages, setTotalPages] = useState(1);
  const [alignContext, setAlignContext] = useState(null);
  const [transferRequestQc, setTransferRequestQc] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncedQuery, setSyncedQuery] = useState(null);

  const fetchQC = useCallback(async () => {
    const fromIso = toISODateString(appliedFilters.from);
    const toIso = toISODateString(appliedFilters.to);

    setLoading(true);

    try {
      const res = await axios.get("/qc/list", {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          order: appliedFilters.order,
          page,
          limit: 20,
          search: appliedFilters.search,
          inspector: canUseInspectorFilter ? appliedFilters.inspector : "",
          vendor: appliedFilters.vendor,
          inspection_status: appliedFilters.inspectionStatus,
          from: fromIso || "",
          to: toIso || "",
          sort_by: sortBy,
          sort_order: sortOrder,
        },
      });

      setQcList(res.data?.data || []);
      setTotalPages(res.data?.pagination?.totalPages || 1);

      const backendFilters = res.data?.filters || {};
      setVendors(Array.isArray(backendFilters.vendors) ? backendFilters.vendors : []);
      setOrders(Array.isArray(backendFilters.orders) ? backendFilters.orders : []);
      setItemCodes(Array.isArray(backendFilters.item_codes) ? backendFilters.item_codes : []);
    } catch (err) {
      console.error(err);
      setQcList([]);
      setTotalPages(1);
      setVendors([]);
      setOrders([]);
      setItemCodes([]);
    } finally {
      setLoading(false);
    }
  }, [
    appliedFilters,
    canUseInspectorFilter,
    token,
    page,
    sortBy,
    sortOrder,
  ]);

  const fetchInspectors = useCallback(async () => {
    if (!canUseInspectorFilter) {
      setInspectors([]);
      return;
    }
    try {
      const res = await axios.get("/auth/?role=QC", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setInspectors(Array.isArray(res?.data) ? res.data : []);
    } catch {
      setInspectors([]);
    }
  }, [canUseInspectorFilter, token]);

  useEffect(() => {
    fetchQC();
  }, [fetchQC]);

  useEffect(() => {
    fetchInspectors();
  }, [fetchInspectors]);

  useEffect(() => {
    const nextRequestedItemCode = normalizeQueryText(searchParams.get("item_code"));
    const nextFilters = buildQcFilterStateFromSearchParams(
      searchParams,
      canUseInspectorFilter,
      nextRequestedItemCode,
    );
    const nextSortBy = parseSortBy(
      searchParams.get("sort_by") ?? searchParams.get("sort"),
    );
    const nextSortOrder = parseSortOrder(
      searchParams.get("sort_order"),
      nextSortBy,
    );
    const nextOrder = normalizeQueryText(searchParams.get("order"));
    const nextPage = parsePositiveInt(searchParams.get("page"), DEFAULT_PAGE);
    const currentQuery = searchParams.toString();

    setSearch((prev) => (prev === nextFilters.search ? prev : nextFilters.search));
    setInspector((prev) => (prev === nextFilters.inspector ? prev : nextFilters.inspector));
    setVendor((prev) => (prev === nextFilters.vendor ? prev : nextFilters.vendor));
    setFrom((prev) => (prev === nextFilters.from ? prev : nextFilters.from));
    setTo((prev) => (prev === nextFilters.to ? prev : nextFilters.to));
    setOrder((prev) => (prev === nextFilters.order ? prev : nextFilters.order));
    setInspectionStatus((prev) => (
      prev === nextFilters.inspectionStatus ? prev : nextFilters.inspectionStatus
    ));
    setAppliedFilters((prev) => (
      areQcFilterStatesEqual(prev, nextFilters) ? prev : nextFilters
    ));
    setSortBy((prev) => (prev === nextSortBy ? prev : nextSortBy));
    setSortOrder((prev) => (prev === nextSortOrder ? prev : nextSortOrder));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [canUseInspectorFilter, searchParams]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (normalizeQueryText(appliedFilters.search)) {
      next.set("search", normalizeQueryText(appliedFilters.search));
    }
    if (normalizeQueryText(appliedFilters.order)) {
      next.set("order", normalizeQueryText(appliedFilters.order));
    }
    if (canUseInspectorFilter && normalizeQueryText(appliedFilters.inspector)) {
      next.set("inspector", normalizeQueryText(appliedFilters.inspector));
    }
    if (normalizeQueryText(appliedFilters.vendor)) {
      next.set("vendor", normalizeQueryText(appliedFilters.vendor));
    }
    if (normalizeQueryText(appliedFilters.inspectionStatus)) {
      next.set(
        "inspection_status",
        normalizeQueryText(appliedFilters.inspectionStatus),
      );
    }
    if (normalizeQueryText(appliedFilters.from)) {
      next.set("from", normalizeQueryText(appliedFilters.from));
    }
    if (normalizeQueryText(appliedFilters.to)) {
      next.set("to", normalizeQueryText(appliedFilters.to));
    }
    if (page > DEFAULT_PAGE) next.set("page", String(page));
    if (sortBy !== DEFAULT_SORT_BY) next.set("sort_by", sortBy);
    if (sortOrder !== parseSortOrder("", sortBy)) next.set("sort_order", sortOrder);

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    appliedFilters,
    page,
    sortBy,
    sortOrder,
    syncedQuery,
    searchParams,
    setSearchParams,
    canUseInspectorFilter,
  ]);

  const handleDetailsClick = (qc) => {
    const qcId = String(qc?._id || "").trim();
    if (!qcId) return;

    const fromQcList = `${location.pathname}${location.search || ""}`;
    navigate(`/qc/${encodeURIComponent(qcId)}`, {
      state: { fromQcList },
    });
  };

  const openAlignModal = useCallback((qc) => {
    const pendingQty = Math.max(0, toSafeNumber(qc?.quantities?.pending));
    if (pendingQty <= 0) return;

    const orderRecord = qc?.order || {};
    const orderItem = orderRecord?.item || qc?.item || {};
    const orderId = String(orderRecord?._id || "").trim();
    const itemCode = String(orderItem?.item_code || "").trim();
    if (!orderId || !itemCode) return;

    setAlignContext({
      order: {
        _id: orderId,
        item: orderItem,
        quantity: Math.max(
          0,
          toSafeNumber(qc?.quantities?.client_demand ?? orderRecord?.quantity),
        ),
      },
      initialInspector: String(qc?.inspector?._id || qc?.inspector || ""),
      initialQuantityRequested: pendingQty,
      initialRequestDate: "",
      initialRequestType: String(qc?.request_type || "FULL"),
      openQuantity: pendingQty,
    });
  }, []);

  // keep filter controls consistent: when filter changes, reset page 1
  const resetToFirstPage = useCallback(() => setPage(1), []);

  const draftFilters = {
    search: normalizeQueryText(search),
    inspector: canUseInspectorFilter ? normalizeQueryText(inspector) : "",
    vendor: normalizeQueryText(vendor),
    from: normalizeQueryText(from),
    to: normalizeQueryText(to),
    order: normalizeQueryText(order),
    inspectionStatus: normalizeQueryText(inspectionStatus),
  };
  const hasPendingFilterChanges = !areQcFilterStatesEqual(
    appliedFilters,
    draftFilters,
  );

  const handleApplyFilters = useCallback(() => {
    setAppliedFilters((prev) => (
      areQcFilterStatesEqual(prev, draftFilters) ? prev : draftFilters
    ));
    setPage(1);
  }, [draftFilters]);

  const handleClearFilters = useCallback(() => {
    const emptyFilters = {
      search: "",
      inspector: "",
      vendor: "",
      from: "",
      to: "",
      order: "",
      inspectionStatus: "",
    };

    setSearch("");
    setInspector("");
    setVendor("");
    setFrom("");
    setTo("");
    setOrder("");
    setInspectionStatus("");
    setAppliedFilters(emptyFilters);
    setPage(1);
  }, []);

  const handleSortColumn = (column, defaultDirection = "asc") => {
    resetToFirstPage();
    if (sortBy === column) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortOrder(defaultDirection);
  };

  const handleExport = useCallback(async (format = "xlsx") => {
    try {
      setExporting(true);
      const fromIso = toISODateString(appliedFilters.from);
      const toIso = toISODateString(appliedFilters.to);
      const response = await axios.get("/qc/export", {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "blob",
        params: {
          order: appliedFilters.order,
          search: appliedFilters.search,
          inspector: canUseInspectorFilter ? appliedFilters.inspector : "",
          vendor: appliedFilters.vendor,
          inspection_status: appliedFilters.inspectionStatus,
          from: fromIso || "",
          to: toIso || "",
          sort_by: sortBy,
          sort_order: sortOrder,
          format,
        },
      });

      const disposition = String(response?.headers?.["content-disposition"] || "");
      const match = disposition.match(/filename\*?=(?:UTF-8''|\"?)([^\";]+)/i);
      const fallbackName = `qc-records-${new Date().toISOString().slice(0, 10)}.${format === "csv" ? "csv" : "xlsx"}`;
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
      alert(`Failed to export QC records as ${String(format).toUpperCase()}.`);
    } finally {
      setExporting(false);
    }
  }, [
    appliedFilters,
    canUseInspectorFilter,
    sortBy,
    sortOrder,
    token,
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
          <h2 className="h4 mb-0">QC Records</h2>
          {canExportQcList ? (
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
            </div>
          ) : (
            <span className="d-none d-md-inline" />
          )}
        </div>

        {/* Removed the separate filter card UI? You asked filters in table head.
            If you want to keep the card too, we can keep it.
            For now: ONLY table head filters. */}

        <div className="card om-card">
          <div className="card-body p-0">
            <div className="d-flex justify-content-end gap-2 p-3 border-bottom bg-body-tertiary">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleApplyFilters}
                disabled={loading || !hasPendingFilterChanges}
              >
                Apply Filters
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={handleClearFilters}
                disabled={loading && !hasPendingFilterChanges}
              >
                Clear Filters
              </button>
            </div>
            <div className="table-responsive">
              <table className="table table-striped table-hover align-middle om-table mb-0">
                <thead className="table-primary">
                  {/* Column titles */}
                  <tr>
                    <th>
                      <SortHeaderButton
                        label="PO"
                        isActive={sortBy === "order_id"}
                        direction={sortOrder}
                        onClick={() => handleSortColumn("order_id", "asc")}
                      />
                    </th>
                    <th>Vendor</th>
                    <th>Item</th>
                    <th>
                      <SortHeaderButton
                        label="Request Date"
                        isActive={sortBy === "request_date"}
                        direction={sortOrder}
                        onClick={() => handleSortColumn("request_date", "desc")}
                      />
                    </th>
                    <th>Last Inspected Date</th>
                    <th>Order Quantity</th>
                    {/* <th>Requested</th>
                    <th>Offered</th> */}
                    {/* <th>Last Inspection (O/C/P)</th> */}
                    <th>Inspection Status</th>
                    <th>QC Passed</th>
                    <th>Pending</th>
                    <th>CBM</th>
                    <th>Inspector</th>
                    {showActionColumn && <th>Actions</th>}
                  </tr>

                  {/* Excel-like filters row (same table classes) */}
                  <tr>
                    {/* PO search (item-like input + suggestions) */}
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="PO"
                        list="qc-po-options"
                        value={order}
                        onChange={(e) => setOrder(e.target.value)}
                      />
                      <datalist id="qc-po-options">
                        {orders.map((o) => (
                          <option key={o} value={o} />
                        ))}
                      </datalist>
                    </th>

                    {/* Vendor filter */}
                    <th>
                      <select
                        className="form-select form-select-sm"
                        value={vendor}
                        onChange={(e) => setVendor(e.target.value)}
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
                        list="qc-item-code-options"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <datalist id="qc-item-code-options">
                        {itemCodes.map((itemCode) => (
                          <option key={itemCode} value={itemCode} />
                        ))}
                      </datalist>
                    </th>

                    {/* Request date range */}
                    <th>
                      <div className="d-flex flex-column gap-1 justify-right" style={{width: "60%"}} >
                        <div className="d-flex gap-1">
                          <label>From</label>
                          <input
                            type="date"
                            lang="en-GB"
                            className="form-control form-control-sm"
                            value={toISODateString(from)}
                            onChange={(e) => {
                              setFrom(toDDMMYYYYInputValue(e.target.value, ""));
                            }}
                          />
                        </div>
                        <div className="d-flex gap-1">
                          <label>To</label>
                          <input
                            type="date"
                            lang="en-GB"
                            className="form-control form-control-sm"
                            value={toISODateString(to)}
                            onChange={(e) => {
                              setTo(toDDMMYYYYInputValue(e.target.value, ""));
                            }}
                          />
                        </div>
                      </div>
                    </th>

                    {/* Non-filtered columns */}
                    {/* <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="-"
                        disabled
                      />
                    </th> */}
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="-"
                        disabled
                      />
                    </th>
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="-"
                        disabled
                      />
                    </th>
                    <th>
                      <select
                        className="form-select form-select-sm"
                        value={inspectionStatus}
                        onChange={(e) => setInspectionStatus(e.target.value)}
                      >
                        <option value="">All</option>
                        {INSPECTION_STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </th>
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="-"
                        disabled
                      />
                    </th>
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="-"
                        disabled
                      />
                    </th>
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="-"
                        disabled
                      />
                    </th>

                    {/* Inspector filter */}
                    <th>
                      {canUseInspectorFilter ? (
                        <select
                          className="form-select form-select-sm"
                          value={inspector}
                          onChange={(e) => setInspector(e.target.value)}
                        >
                          <option value="">All</option>
                          {inspectors.map((qc) => (
                            <option key={qc._id} value={qc._id}>
                              {qc.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value="Self"
                          disabled
                          readOnly
                        />
                      )}
                    </th>

                    {/* Clear filters button area */}
                    {showActionColumn && (
                      <th />
                    )}
                  </tr>
                </thead>

                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={tableColumnCount} className="text-center py-4">
                        Loading...
                      </td>
                    </tr>
                  ) : (
                    qcList.map((qc) => {
                      const pendingAlignmentInfo = getPendingAlignmentInfo(qc);
                      const hasAlignTarget =
                        Boolean(String(qc?.order?._id || "").trim()) &&
                        Boolean(
                          String(
                            qc?.order?.item?.item_code ||
                              qc?.item?.item_code ||
                              "",
                          ).trim(),
                        );
                      const canRaiseNewRequest =
                        canAlignQc &&
                        hasAlignTarget &&
                        pendingAlignmentInfo.pendingQty > 0;
                      const canShowTransferRequest =
                        canTransferRequest && canTransferLatestRequestToday(qc);

                      return (
                        <tr key={qc._id}>
                          {/* Prefer order.order_id if you populate order.
                              Vendor should come from order_meta now */}
                          <td
                            className={qc?._id ? "table-clickable" : undefined}
                            onClick={() => handleDetailsClick(qc)}
                            title={qc?._id ? "Open QC details" : undefined}
                          >
                            {qc?.order_meta?.order_id ||
                              qc?.order?.order_id ||
                              "N/A"}
                          </td>
                          <td>
                            {qc?.order_meta?.vendor || qc?.order?.vendor || "N/A"}
                          </td>
                          <td>{qc?.item?.item_code || "N/A"}</td>
                          <td>{formatDateDDMMYYYY(qc?.request_date)}</td>
                          <td>{formatDateDDMMYYYY(qc?.last_inspected_date)}</td>
                          <td>{qc?.quantities?.client_demand ?? 0}</td>
                          {/* <td>{qc?.quantities?.quantity_requested ?? 0}</td>
                          <td>{toSafeNumber(qc?.last_inspection?.vendor_offered) ?? 0}</td> */}
                          {/* <td>
                            {qc?.last_inspection
                              ? `${toSafeNumber(qc.last_inspection.vendor_offered)} / ${toSafeNumber(qc.last_inspection.checked)} / ${toSafeNumber(qc.last_inspection.passed)}`
                              : "N/A"}
                          </td> */}
                          <td>
                            {renderInspectionStatus(qc)}
                          </td>
                          <td>{toSafeNumber(qc?.last_inspection?.passed) ?? 0}</td>
                          <td>
                            <span
                              className={[
                                "om-table-tooltip-trigger",
                                pendingAlignmentInfo.isAligned
                                  ? ""
                                  : "text-danger fw-semibold",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              data-tooltip={pendingAlignmentInfo.tooltip}
                              tabIndex={0}
                            >
                              {pendingAlignmentInfo.pendingQty}
                            </span>
                          </td>
                          <td>{formatPositiveCbm(qc?.cbm?.total, "NA")}</td>
                          <td>{qc?.inspector?.name || "N/A"}</td>
                          {showActionColumn && (
                            <td>
                              <div className="d-flex flex-column gap-2">
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
                                {canRaiseNewRequest && (
                                  <button
                                    type="button"
                                    className="btn btn-outline-primary btn-sm"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      openAlignModal(qc);
                                    }}
                                  >
                                    Raise New Request
                                  </button>
                                )}
                                {canShowTransferRequest && (
                                  <button
                                    type="button"
                                    className="btn btn-outline-warning btn-sm"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setTransferRequestQc(qc);
                                    }}
                                  >
                                    Transfer Request
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}

                  {!loading && qcList.length === 0 && (
                    <tr>
                      <td colSpan={tableColumnCount} className="text-center py-4">
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
            disabled={page === 1 || loading}
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
            disabled={page === totalPages || loading}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>

        {transferRequestQc && (
          <TransferQcRequestModal
            qc={transferRequestQc}
            onClose={() => setTransferRequestQc(null)}
            onTransferred={() => {
              setTransferRequestQc(null);
              return fetchQC();
            }}
          />
        )}

        {alignContext?.order && (
          <AlignQCModal
            order={alignContext.order}
            initialInspector={alignContext.initialInspector}
            initialQuantityRequested={alignContext.initialQuantityRequested}
            initialRequestDate={alignContext.initialRequestDate}
            initialRequestType={alignContext.initialRequestType}
            openQuantity={alignContext.openQuantity}
            onClose={() => setAlignContext(null)}
            onSuccess={() => {
              setAlignContext(null);
              return fetchQC();
            }}
          />
        )}
      </div>
    </>
  );
};

export default QCPage;
