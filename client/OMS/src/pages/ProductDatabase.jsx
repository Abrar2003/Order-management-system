import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/axios";
import { getUserFromToken } from "../auth/auth.service";
import Navbar from "../components/Navbar";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import {
  BOX_ENTRY_TYPES,
  BOX_PACKAGING_MODES,
  BOX_SIZE_REMARK_OPTIONS,
  ITEM_SIZE_REMARK_OPTIONS,
} from "../utils/measuredSizeForm";
import "../App.css";

const DEFAULT_FILTER = "all";
const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [20, 50, 100];
const STATUS_OPTIONS = Object.freeze([
  { value: DEFAULT_FILTER, label: "All Statuses" },
  { value: "not_set", label: "Not Set" },
  { value: "created", label: "Created" },
  { value: "checked", label: "Checked" },
  { value: "approved", label: "Approved" },
]);

const emptyItemEntry = () => ({
  remark: "",
  L: "",
  B: "",
  H: "",
  net_weight: "",
  gross_weight: "",
});

const emptyBoxEntry = (boxType = BOX_ENTRY_TYPES.INDIVIDUAL) => ({
  remark: boxType === BOX_ENTRY_TYPES.INDIVIDUAL ? "" : boxType,
  box_type: boxType,
  L: "",
  B: "",
  H: "",
  net_weight: "",
  gross_weight: "",
  item_count_in_inner: boxType === BOX_ENTRY_TYPES.INNER ? "" : "0",
  box_count_in_master: boxType === BOX_ENTRY_TYPES.MASTER ? "" : "0",
});

const normalizeTextValue = (value) => String(value || "").trim();

const normalizeFilterValue = (value, fallback = DEFAULT_FILTER) => {
  const normalized = normalizeTextValue(value);
  if (!normalized) return fallback;
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return fallback;
  }
  return normalized;
};

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};

const normalizeStatus = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (["created", "checked", "approved", "not_set"].includes(normalized)) {
    return normalized;
  }
  return "not_set";
};

const getStatusLabel = (value) => {
  const status = normalizeStatus(value);
  if (status === "created") return "Created";
  if (status === "checked") return "Checked";
  if (status === "approved") return "Approved";
  return "Not Set";
};

const getStatusBadgeClass = (value) => {
  const status = normalizeStatus(value);
  if (status === "approved") return "text-bg-success";
  if (status === "checked") return "text-bg-info";
  if (status === "created") return "text-bg-warning";
  return "text-bg-secondary";
};

const formatNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "Not Set";
  return parsed.toFixed(3).replace(/\.?0+$/, "");
};

const formatRemark = (value) => normalizeTextValue(value) || "Single";

const formatBoxMode = (value) => {
  const mode = normalizeTextValue(value).toLowerCase();
  if (mode === BOX_PACKAGING_MODES.CARTON) return "Carton";
  return "Individual";
};

const formatActor = (actor = null, dateKey = "") => {
  if (!actor?.name && !actor?.[dateKey]) return "N/A";
  const name = actor?.name || "Unknown";
  const date = actor?.[dateKey] ? formatDateDDMMYYYY(actor[dateKey]) : "";
  return date ? `${name} (${date})` : name;
};

const hasMeaningfulEntry = (entry = {}) =>
  ["L", "B", "H", "net_weight", "gross_weight", "item_count_in_inner", "box_count_in_master"]
    .some((field) => normalizeTextValue(entry?.[field]) !== "" && Number(entry?.[field] || 0) > 0) ||
  Boolean(normalizeTextValue(entry?.remark));

const toFormItemEntries = (entries = []) => {
  const rows = (Array.isArray(entries) ? entries : []).map((entry) => ({
    ...emptyItemEntry(),
    remark: normalizeTextValue(entry?.remark),
    L: formatNumber(entry?.L) === "Not Set" ? "" : formatNumber(entry?.L),
    B: formatNumber(entry?.B) === "Not Set" ? "" : formatNumber(entry?.B),
    H: formatNumber(entry?.H) === "Not Set" ? "" : formatNumber(entry?.H),
    net_weight: formatNumber(entry?.net_weight) === "Not Set" ? "" : formatNumber(entry?.net_weight),
    gross_weight:
      formatNumber(entry?.gross_weight) === "Not Set" ? "" : formatNumber(entry?.gross_weight),
  }));
  return rows.length > 0 ? rows : [emptyItemEntry()];
};

const toFormBoxEntries = (entries = [], mode = BOX_PACKAGING_MODES.INDIVIDUAL) => {
  const resolvedMode =
    mode === BOX_PACKAGING_MODES.CARTON
      ? BOX_PACKAGING_MODES.CARTON
      : BOX_PACKAGING_MODES.INDIVIDUAL;
  const sourceEntries = Array.isArray(entries) ? entries : [];

  if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
    const inner =
      sourceEntries.find((entry) => entry?.box_type === BOX_ENTRY_TYPES.INNER) ||
      sourceEntries[0] ||
      {};
    const master =
      sourceEntries.find((entry) => entry?.box_type === BOX_ENTRY_TYPES.MASTER) ||
      sourceEntries[1] ||
      {};

    return [inner, master].map((entry, index) => {
      const boxType = index === 0 ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER;
      return {
        ...emptyBoxEntry(boxType),
        remark: boxType,
        box_type: boxType,
        L: formatNumber(entry?.L) === "Not Set" ? "" : formatNumber(entry?.L),
        B: formatNumber(entry?.B) === "Not Set" ? "" : formatNumber(entry?.B),
        H: formatNumber(entry?.H) === "Not Set" ? "" : formatNumber(entry?.H),
        net_weight:
          formatNumber(entry?.net_weight) === "Not Set" ? "" : formatNumber(entry?.net_weight),
        gross_weight:
          formatNumber(entry?.gross_weight) === "Not Set" ? "" : formatNumber(entry?.gross_weight),
        item_count_in_inner:
          boxType === BOX_ENTRY_TYPES.INNER
            ? formatNumber(entry?.item_count_in_inner) === "Not Set"
              ? ""
              : formatNumber(entry?.item_count_in_inner)
            : "0",
        box_count_in_master:
          boxType === BOX_ENTRY_TYPES.MASTER
            ? formatNumber(entry?.box_count_in_master) === "Not Set"
              ? ""
              : formatNumber(entry?.box_count_in_master)
            : "0",
      };
    });
  }

  const rows = sourceEntries.map((entry) => ({
    ...emptyBoxEntry(),
    remark: normalizeTextValue(entry?.remark),
    box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
    L: formatNumber(entry?.L) === "Not Set" ? "" : formatNumber(entry?.L),
    B: formatNumber(entry?.B) === "Not Set" ? "" : formatNumber(entry?.B),
    H: formatNumber(entry?.H) === "Not Set" ? "" : formatNumber(entry?.H),
    net_weight: formatNumber(entry?.net_weight) === "Not Set" ? "" : formatNumber(entry?.net_weight),
    gross_weight:
      formatNumber(entry?.gross_weight) === "Not Set" ? "" : formatNumber(entry?.gross_weight),
    item_count_in_inner: "0",
    box_count_in_master: "0",
  }));
  return rows.length > 0 ? rows : [emptyBoxEntry()];
};

const stripEmptyEntries = (entries = []) =>
  (Array.isArray(entries) ? entries : []).filter((entry) => hasMeaningfulEntry(entry));

const buildPayloadFromForm = (form = {}) => ({
  pd_item_sizes: stripEmptyEntries(form.pd_item_sizes),
  pd_box_mode: form.pd_box_mode,
  pd_box_sizes: stripEmptyEntries(form.pd_box_sizes),
});

const normalizePayloadForCompare = (payload = {}) =>
  JSON.stringify({
    pd_item_sizes: payload.pd_item_sizes || [],
    pd_box_mode: payload.pd_box_mode || BOX_PACKAGING_MODES.INDIVIDUAL,
    pd_box_sizes: payload.pd_box_sizes || [],
  });

const SizeSummary = ({ entries = [], type = "item" }) => {
  const rows = Array.isArray(entries) ? entries : [];
  if (rows.length === 0) {
    return <span className="text-secondary">Not Set</span>;
  }

  return (
    <div className="small d-flex flex-column gap-1">
      {rows.map((entry, index) => (
        <div key={`${type}-${index}-${entry?.remark || entry?.box_type || "single"}`}>
          <strong>{formatRemark(entry?.remark || entry?.box_type)}:</strong>{" "}
          {formatNumber(entry?.L)} x {formatNumber(entry?.B)} x {formatNumber(entry?.H)}
          {type === "item" ? (
            <span> | Net {formatNumber(entry?.net_weight)}</span>
          ) : (
            <span> | Gross {formatNumber(entry?.gross_weight)}</span>
          )}
        </div>
      ))}
    </div>
  );
};

const SummaryCard = ({ label, value }) => (
  <div className="col-md-6 col-xl-3">
    <div className="card om-card h-100">
      <div className="card-body">
        <div className="small text-secondary">{label}</div>
        <div className="h4 mb-0 mt-2">{value}</div>
      </div>
    </div>
  </div>
);

const ProductDatabaseModal = ({ item, onClose, onSaved }) => {
  const user = getUserFromToken();
  const normalizedRole = String(user?.role || "").trim().toLowerCase();
  const isManager = normalizedRole === "manager";
  const isAdmin = normalizedRole === "admin";
  const canEdit = Boolean(item?.permissions?.can_edit);
  const initialForm = useMemo(
    () => ({
      pd_item_sizes: toFormItemEntries(item?.pd_item_sizes),
      pd_box_mode:
        item?.pd_box_mode === BOX_PACKAGING_MODES.CARTON
          ? BOX_PACKAGING_MODES.CARTON
          : BOX_PACKAGING_MODES.INDIVIDUAL,
      pd_box_sizes: toFormBoxEntries(item?.pd_box_sizes, item?.pd_box_mode),
    }),
    [item],
  );
  const [form, setForm] = useState(initialForm);
  const [savingAction, setSavingAction] = useState("");
  const [error, setError] = useState("");

  const currentPayload = useMemo(() => buildPayloadFromForm(form), [form]);
  const initialPayload = useMemo(() => buildPayloadFromForm(initialForm), [initialForm]);
  const hasChanges =
    normalizePayloadForCompare(currentPayload) !== normalizePayloadForCompare(initialPayload);
  const canCheck = Boolean(item?.permissions?.can_check) && !hasChanges;
  const canApprove = isAdmin && (item?.pd_checked === "checked" || hasChanges);

  const updateItemEntry = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      pd_item_sizes: prev.pd_item_sizes.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    }));
  };

  const updateBoxEntry = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      pd_box_sizes: prev.pd_box_sizes.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    }));
  };

  const handleBoxModeChange = (nextMode) => {
    setForm((prev) => ({
      ...prev,
      pd_box_mode: nextMode,
      pd_box_sizes:
        nextMode === BOX_PACKAGING_MODES.CARTON
          ? toFormBoxEntries(prev.pd_box_sizes, BOX_PACKAGING_MODES.CARTON)
          : toFormBoxEntries(prev.pd_box_sizes, BOX_PACKAGING_MODES.INDIVIDUAL),
    }));
  };

  const runMutation = async (action) => {
    try {
      setSavingAction(action);
      setError("");

      let response;
      if (action === "check") {
        response = await api.post(`/items/${item.id}/product-database/check`, currentPayload);
      } else if (action === "approve") {
        const confirmed = window.confirm("Approve this Product Database record?");
        if (!confirmed) return;
        response = await api.post(`/items/${item.id}/product-database/approve`, currentPayload);
      } else {
        response = await api.patch(`/items/${item.id}/product-database`, currentPayload);
      }

      onSaved?.(response?.data?.message || "Product Database record updated.");
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to update Product Database record.");
    } finally {
      setSavingAction("");
    }
  };

  return (
    <div
      className="modal d-block om-modal-backdrop"
      tabIndex="-1"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
          <div
            className="modal-dialog modal-dialog-centered modal-xl product-database-modal-dialog"
            role="document"
            onClick={(event) => event.stopPropagation()}
          >
        <div className="modal-content">
          <div className="modal-header">
            <div>
              <h5 className="modal-title">Product Database</h5>
              <div className="small text-muted">
                {item?.code || "N/A"} | {item?.description || item?.name || "N/A"}
              </div>
            </div>
            <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
          </div>

          <div className="modal-body">
            {error && <div className="alert alert-danger mb-3">{error}</div>}

            <div className="d-flex flex-wrap gap-2 mb-3">
              <span className={`badge ${getStatusBadgeClass(item?.pd_checked)}`}>
                {getStatusLabel(item?.pd_checked)}
              </span>
              <span className="om-summary-chip">
                Created: {formatActor(item?.pd_created_by, "created_at")}
              </span>
              <span className="om-summary-chip">
                Checked: {formatActor(item?.pd_checked_by, "checked_at")}
              </span>
              <span className="om-summary-chip">
                Approved: {formatActor(item?.pd_approved_by, "approved_at")}
              </span>
              <span className="om-summary-chip">
                Last Changed: {formatActor(item?.pd_last_changed_by, "changed_at")}
              </span>
            </div>

            <section className="mb-4">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="mb-0">PD Item Sizes</h6>
                {canEdit && form.pd_item_sizes.length < 4 && (
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        pd_item_sizes: [...prev.pd_item_sizes, emptyItemEntry()],
                      }))
                    }
                  >
                    Add Item Size
                  </button>
                )}
              </div>

              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Remark</th>
                      <th>L</th>
                      <th>B</th>
                      <th>H</th>
                      <th>Net Weight</th>
                      <th>Gross Weight</th>
                      {canEdit && <th>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {form.pd_item_sizes.map((entry, index) => (
                      <tr key={`pd-item-${index}`}>
                        <td>
                          <select
                            className="form-select form-select-sm"
                            value={entry.remark}
                            disabled={!canEdit || form.pd_item_sizes.length === 1}
                            onChange={(event) => updateItemEntry(index, "remark", event.target.value)}
                          >
                            <option value="">Single</option>
                            {ITEM_SIZE_REMARK_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        {["L", "B", "H", "net_weight", "gross_weight"].map((field) => (
                          <td key={field}>
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              className="form-control form-control-sm"
                              value={entry[field]}
                              disabled={!canEdit}
                              onChange={(event) => updateItemEntry(index, field, event.target.value)}
                            />
                          </td>
                        ))}
                        {canEdit && (
                          <td>
                            <button
                              type="button"
                              className="btn btn-outline-danger btn-sm"
                              disabled={form.pd_item_sizes.length <= 1}
                              onClick={() =>
                                setForm((prev) => ({
                                  ...prev,
                                  pd_item_sizes: prev.pd_item_sizes.filter((_, rowIndex) => rowIndex !== index),
                                }))
                              }
                            >
                              Remove
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                <h6 className="mb-0">PD Box Sizes</h6>
                <div className="d-flex align-items-center gap-2 product-database-box-toolbar">
                  <select
                    className="form-select form-select-sm w-auto"
                    value={form.pd_box_mode}
                    disabled={!canEdit}
                    onChange={(event) => handleBoxModeChange(event.target.value)}
                  >
                    <option value={BOX_PACKAGING_MODES.INDIVIDUAL}>Individual</option>
                    <option value={BOX_PACKAGING_MODES.CARTON}>Carton</option>
                  </select>
                  {canEdit &&
                    form.pd_box_mode !== BOX_PACKAGING_MODES.CARTON &&
                    form.pd_box_sizes.length < 4 && (
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm text-nowrap"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            pd_box_sizes: [...prev.pd_box_sizes, emptyBoxEntry()],
                          }))
                        }
                      >
                        Add Box Size
                      </button>
                    )}
                </div>
              </div>

              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Type / Remark</th>
                      <th>L</th>
                      <th>B</th>
                      <th>H</th>
                      <th>Gross Weight</th>
                      <th>Net Weight</th>
                      <th>Item Count In Inner</th>
                      <th>Box Count In Master</th>
                      {canEdit && <th>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {form.pd_box_sizes.map((entry, index) => {
                      const isCarton = form.pd_box_mode === BOX_PACKAGING_MODES.CARTON;
                      const boxType = isCarton
                        ? index === 0
                          ? BOX_ENTRY_TYPES.INNER
                          : BOX_ENTRY_TYPES.MASTER
                        : BOX_ENTRY_TYPES.INDIVIDUAL;

                      return (
                        <tr key={`pd-box-${index}`}>
                          <td>
                            {isCarton ? (
                              <span className="badge text-bg-light border text-secondary">
                                {boxType === BOX_ENTRY_TYPES.INNER ? "Inner Carton" : "Master Carton"}
                              </span>
                            ) : (
                              <select
                                className="form-select form-select-sm"
                                value={entry.remark}
                                disabled={!canEdit || form.pd_box_sizes.length === 1}
                                onChange={(event) => updateBoxEntry(index, "remark", event.target.value)}
                              >
                                <option value="">Single</option>
                                {BOX_SIZE_REMARK_OPTIONS
                                  .filter((option) => !["inner", "master"].includes(option.value))
                                  .map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                              </select>
                            )}
                          </td>
                          {["L", "B", "H", "gross_weight", "net_weight"].map((field) => (
                            <td key={field}>
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                className="form-control form-control-sm"
                                value={entry[field]}
                                disabled={!canEdit}
                                onChange={(event) => updateBoxEntry(index, field, event.target.value)}
                              />
                            </td>
                          ))}
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              className="form-control form-control-sm"
                              value={entry.item_count_in_inner}
                              disabled={!canEdit || boxType !== BOX_ENTRY_TYPES.INNER}
                              onChange={(event) =>
                                updateBoxEntry(index, "item_count_in_inner", event.target.value)
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              className="form-control form-control-sm"
                              value={entry.box_count_in_master}
                              disabled={!canEdit || boxType !== BOX_ENTRY_TYPES.MASTER}
                              onChange={(event) =>
                                updateBoxEntry(index, "box_count_in_master", event.target.value)
                              }
                            />
                          </td>
                          {canEdit && (
                            <td>
                              <button
                                type="button"
                                className="btn btn-outline-danger btn-sm"
                                disabled={isCarton || form.pd_box_sizes.length <= 1}
                                onClick={() =>
                                  setForm((prev) => ({
                                    ...prev,
                                    pd_box_sizes: prev.pd_box_sizes.filter((_, rowIndex) => rowIndex !== index),
                                  }))
                                }
                              >
                                Remove
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {isManager && item?.permissions?.check_blocked_reason && !hasChanges && (
              <div className="alert alert-warning mt-3 mb-0">
                {item.permissions.check_blocked_reason}
              </div>
            )}
            {isManager && hasChanges && (
              <div className="alert alert-info mt-3 mb-0">
                Saving changes will keep this record in Created status. Another eligible manager must check it.
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
              Close
            </button>
            {canEdit && (
              <button
                type="button"
                className="btn btn-outline-primary"
                disabled={savingAction !== ""}
                onClick={() => runMutation("save")}
              >
                {savingAction === "save" ? "Saving..." : "Save Changes"}
              </button>
            )}
            {isManager && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canCheck || savingAction !== ""}
                onClick={() => runMutation("check")}
              >
                {savingAction === "check" ? "Checking..." : "Check"}
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                className="btn btn-success"
                disabled={!canApprove || savingAction !== ""}
                onClick={() => runMutation("approve")}
              >
                {savingAction === "approve" ? "Approving..." : "Approve"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ProductDatabase = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "product-database");
  const [search, setSearch] = useState(() => normalizeTextValue(searchParams.get("search")));
  const [draftSearch, setDraftSearch] = useState(() => normalizeTextValue(searchParams.get("search")));
  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("brand")),
  );
  const [draftBrandFilter, setDraftBrandFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("brand")),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("vendor")),
  );
  const [draftVendorFilter, setDraftVendorFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("vendor")),
  );
  const [statusFilter, setStatusFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("status")),
  );
  const [draftStatusFilter, setDraftStatusFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("status")),
  );
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1));
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({
    not_set: 0,
    created: 0,
    checked: 0,
    approved: 0,
  });
  const [filters, setFilters] = useState({
    brand_options: [],
    vendor_options: [],
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: DEFAULT_LIMIT,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [syncedQuery, setSyncedQuery] = useState(null);

  const fetchRows = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const params = { page, limit };
      if (search) params.search = search;
      if (brandFilter !== DEFAULT_FILTER) params.brand = brandFilter;
      if (vendorFilter !== DEFAULT_FILTER) params.vendor = vendorFilter;
      if (statusFilter !== DEFAULT_FILTER) params.status = statusFilter;

      const response = await api.get("/items/product-database", { params });
      const data = response?.data || {};
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setSummary(data?.summary || {});
      setFilters(data?.filters || {});
      setPagination(data?.pagination || {});
    } catch (err) {
      setRows([]);
      setError(err?.response?.data?.message || "Failed to load Product Database.");
    } finally {
      setLoading(false);
    }
  }, [brandFilter, limit, page, search, statusFilter, vendorFilter]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextSearch = normalizeTextValue(searchParams.get("search"));
    const nextBrand = normalizeFilterValue(searchParams.get("brand"));
    const nextVendor = normalizeFilterValue(searchParams.get("vendor"));
    const nextStatus = normalizeFilterValue(searchParams.get("status"));
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setSearch((prev) => (prev === nextSearch ? prev : nextSearch));
    setDraftSearch((prev) => (prev === nextSearch ? prev : nextSearch));
    setBrandFilter((prev) => (prev === nextBrand ? prev : nextBrand));
    setDraftBrandFilter((prev) => (prev === nextBrand ? prev : nextBrand));
    setVendorFilter((prev) => (prev === nextVendor ? prev : nextVendor));
    setDraftVendorFilter((prev) => (prev === nextVendor ? prev : nextVendor));
    setStatusFilter((prev) => (prev === nextStatus ? prev : nextStatus));
    setDraftStatusFilter((prev) => (prev === nextStatus ? prev : nextStatus));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (search) next.set("search", search);
    if (brandFilter !== DEFAULT_FILTER) next.set("brand", brandFilter);
    if (vendorFilter !== DEFAULT_FILTER) next.set("vendor", vendorFilter);
    if (statusFilter !== DEFAULT_FILTER) next.set("status", statusFilter);
    if (page !== 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    limit,
    page,
    search,
    searchParams,
    setSearchParams,
    statusFilter,
    syncedQuery,
    vendorFilter,
  ]);

  const applyFilters = (event) => {
    event?.preventDefault();
    setSearch(normalizeTextValue(draftSearch));
    setBrandFilter(normalizeFilterValue(draftBrandFilter));
    setVendorFilter(normalizeFilterValue(draftVendorFilter));
    setStatusFilter(normalizeFilterValue(draftStatusFilter));
    setPage(1);
  };

  const clearFilters = () => {
    setDraftSearch("");
    setDraftBrandFilter(DEFAULT_FILTER);
    setDraftVendorFilter(DEFAULT_FILTER);
    setDraftStatusFilter(DEFAULT_FILTER);
    setSearch("");
    setBrandFilter(DEFAULT_FILTER);
    setVendorFilter(DEFAULT_FILTER);
    setStatusFilter(DEFAULT_FILTER);
    setPage(1);
    setLimit(DEFAULT_LIMIT);
  };

  const handleSaved = (message) => {
    setSuccess(message);
    setSelectedItem(null);
    fetchRows();
    window.setTimeout(() => setSuccess(""), 4000);
  };

  return (
    <>
      <Navbar />

      <div className="page-shell om-report-page py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="h4 mb-0">Product Database</h2>
          <span className="small text-secondary">PD size data approval workflow</span>
        </div>

        <div className="card om-card mb-3">
          <form className="card-body row g-2 align-items-end" onSubmit={applyFilters}>
            <div className="col-lg-3 col-md-6">
              <label className="form-label mb-1">Search</label>
              <input
                type="text"
                className="form-control"
                value={draftSearch}
                placeholder="Code, name, description"
                onChange={(event) => setDraftSearch(event.target.value)}
              />
            </div>
            <div className="col-lg-2 col-md-6">
              <label className="form-label mb-1">Brand</label>
              <select
                className="form-select"
                value={draftBrandFilter}
                onChange={(event) => setDraftBrandFilter(event.target.value)}
              >
                <option value={DEFAULT_FILTER}>All Brands</option>
                {(Array.isArray(filters.brand_options) ? filters.brand_options : []).map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-lg-2 col-md-6">
              <label className="form-label mb-1">Vendor</label>
              <select
                className="form-select"
                value={draftVendorFilter}
                onChange={(event) => setDraftVendorFilter(event.target.value)}
              >
                <option value={DEFAULT_FILTER}>All Vendors</option>
                {(Array.isArray(filters.vendor_options) ? filters.vendor_options : []).map((vendor) => (
                  <option key={vendor} value={vendor}>
                    {vendor}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-lg-2 col-md-6">
              <label className="form-label mb-1">Approval Status</label>
              <select
                className="form-select"
                value={draftStatusFilter}
                onChange={(event) => setDraftStatusFilter(event.target.value)}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-lg-3 col-md-12 d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={clearFilters}
                disabled={loading}
              >
                Clear
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "Loading..." : "Apply"}
              </button>
            </div>
          </form>
        </div>

        <div className="row g-3 mb-3">
          <SummaryCard label="Not Set" value={summary.not_set ?? 0} />
          <SummaryCard label="Created" value={summary.created ?? 0} />
          <SummaryCard label="Checked" value={summary.checked ?? 0} />
          <SummaryCard label="Approved" value={summary.approved ?? 0} />
        </div>

        {error && <div className="alert alert-danger mb-3">{error}</div>}
        {success && <div className="alert alert-success mb-3">{success}</div>}

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-5">Loading Product Database...</div>
            ) : rows.length === 0 ? (
              <div className="text-center py-5 text-secondary">
                No Product Database records found.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>Item Code</th>
                      <th>Name / Description</th>
                      <th>Brand</th>
                      <th>Vendor</th>
                      <th>PD Item Sizes</th>
                      <th>PD Box Sizes</th>
                      <th>Status</th>
                      <th>Audit</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="fw-semibold">{row.code || "N/A"}</td>
                        <td>
                          <div>{row.name || "N/A"}</div>
                          <div className="small text-secondary">{row.description || "N/A"}</div>
                        </td>
                        <td>{row.brand_name || row.brand || row.brands?.join(", ") || "N/A"}</td>
                        <td>{Array.isArray(row.vendors) && row.vendors.length > 0 ? row.vendors.join(", ") : "N/A"}</td>
                        <td><SizeSummary entries={row.pd_item_sizes} type="item" /></td>
                        <td>
                          <div className="small text-secondary mb-1">
                            Mode: {formatBoxMode(row.pd_box_mode)}
                          </div>
                          <SizeSummary entries={row.pd_box_sizes} type="box" />
                        </td>
                        <td>
                          <span className={`badge ${getStatusBadgeClass(row.pd_checked)}`}>
                            {getStatusLabel(row.pd_checked)}
                          </span>
                        </td>
                        <td>
                          <div className="small">
                            <div>Created: {formatActor(row.pd_created_by, "created_at")}</div>
                            <div>Checked: {formatActor(row.pd_checked_by, "checked_at")}</div>
                            <div>Approved: {formatActor(row.pd_approved_by, "approved_at")}</div>
                            <div>Changed: {formatActor(row.pd_last_changed_by, "changed_at")}</div>
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-outline-primary btn-sm"
                            onClick={() => setSelectedItem(row)}
                          >
                            {row?.permissions?.can_edit ? "Edit / Review" : "View"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mt-3">
          <div className="input-group om-limit-control">
            <span className="input-group-text">Limit</span>
            <select
              className="form-select"
              value={limit}
              onChange={(event) => {
                setPage(1);
                setLimit(Number(event.target.value));
              }}
            >
              {LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="d-flex justify-content-center align-items-center gap-3">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={(pagination.page ?? 1) <= 1 || loading}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Prev
            </button>
            <span className="small fw-semibold">
              Page {pagination.page ?? 1} of {pagination.totalPages ?? 1}
            </span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={(pagination.page ?? 1) >= (pagination.totalPages ?? 1) || loading}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {selectedItem && (
        <ProductDatabaseModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
};

export default ProductDatabase;
