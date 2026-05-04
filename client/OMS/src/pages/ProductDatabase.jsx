import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/axios";
import { getUserFromToken } from "../auth/auth.service";
import { usePermissions } from "../auth/PermissionContext";
import Navbar from "../components/Navbar";
import ProductTypeDynamicForm from "../components/ProductTypeDynamicForm";
import {
  getProductTypeTemplateByKey,
  getProductTypeTemplates,
} from "../services/productTypeTemplates.service";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import {
  BOX_PACKAGING_MODES,
} from "../utils/measuredSizeForm";
import {
  buildProductTypePayload,
  createProductTypeFormState,
  hasProductTypeFormValues,
  normalizeTemplateKey,
  validateProductTypeFormState,
} from "../utils/productTypeTemplates";
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

const formatRemark = (value) => {
  const normalized = normalizeTextValue(value);
  if (!normalized) return "Single";
  return normalized
    .replace(/_/g, " ")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

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

const buildPayloadFromForm = () => ({});

const getDisplayItemSizes = (row = {}) => {
  const productItemSizes = Array.isArray(row?.product_specs?.item_sizes)
    ? row.product_specs.item_sizes
    : [];
  if (productItemSizes.length > 0) return productItemSizes;
  return Array.isArray(row?.pd_item_sizes) ? row.pd_item_sizes : [];
};

const getDisplayBoxSizes = (row = {}) => {
  const productBoxSizes = Array.isArray(row?.product_specs?.box_sizes)
    ? row.product_specs.box_sizes
    : [];
  if (productBoxSizes.length > 0) return productBoxSizes;
  return Array.isArray(row?.pd_box_sizes) ? row.pd_box_sizes : [];
};

const getDisplayBoxMode = (row = {}) =>
  Array.isArray(row?.product_specs?.box_sizes) && row.product_specs.box_sizes.length > 0
    ? row?.product_specs?.box_mode || BOX_PACKAGING_MODES.INDIVIDUAL
    : row?.pd_box_mode || BOX_PACKAGING_MODES.INDIVIDUAL;

const normalizeProductSpecsForCompare = (productSpecs = {}) => ({
  fields: (Array.isArray(productSpecs?.fields) ? productSpecs.fields : []).map((field) => ({
    field_id: field?.field_id || null,
    key: field?.key || "",
    label: field?.label || "",
    group_key: field?.group_key || "",
    group_label: field?.group_label || "",
    input_type: field?.input_type || "",
    value_type: field?.value_type || "",
    unit: field?.unit || "",
    value_text: field?.value_text || "",
    value_number: field?.value_number ?? null,
    value_boolean: field?.value_boolean ?? null,
    value_date: field?.value_date || null,
    value_array: Array.isArray(field?.value_array) ? field.value_array : [],
    raw_value:
      field?.value_type === "object" || field?.input_type === "file"
        ? field?.raw_value ?? null
        : null,
  })),
  item_sizes: Array.isArray(productSpecs?.item_sizes) ? productSpecs.item_sizes : [],
  box_sizes: Array.isArray(productSpecs?.box_sizes) ? productSpecs.box_sizes : [],
  box_mode: productSpecs?.box_mode || BOX_PACKAGING_MODES.INDIVIDUAL,
});

const normalizePayloadForCompare = (payload = {}) =>
  JSON.stringify({
    pd_box_mode: payload.pd_box_mode || BOX_PACKAGING_MODES.INDIVIDUAL,
    pd_box_sizes: payload.pd_box_sizes || [],
    product_type: payload.product_type || null,
    product_specs: normalizeProductSpecsForCompare(payload.product_specs),
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

const cloneProductTypeValidation = () => ({
  product_type: "",
  fields: {},
  item_sizes: {},
  box_sizes: {},
});

const buildExistingProductTypePayload = (item = {}) => ({
  product_type: item?.product_type || null,
  product_specs: item?.product_specs || {
    fields: [],
    item_sizes: [],
    box_sizes: [],
    box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
    raw_values: {},
  },
});

const buildTemplateOptionValue = (key = "", version = "") =>
  normalizeTemplateKey(key) && Number(version) > 0
    ? `${normalizeTemplateKey(key)}::${Number(version)}`
    : "";

const parseTemplateOptionValue = (value = "") => {
  const [keyPart = "", versionPart = ""] = String(value || "").split("::");
  const version = Number.parseInt(versionPart, 10);
  return {
    key: normalizeTemplateKey(keyPart),
    version: Number.isFinite(version) && version > 0 ? version : 0,
  };
};

const ProductDatabaseModal = ({ item, onClose, onSaved }) => {
  const { hasPermission } = usePermissions();
  const user = getUserFromToken();
  const normalizedRole = String(user?.role || "").trim().toLowerCase();
  const isManager = normalizedRole === "manager";
  const isAdmin = normalizedRole === "admin";
  const canViewProductTypeTemplates = hasPermission("product_type_templates", "view");
  const canEdit = Boolean(item?.permissions?.can_edit);
  const initialForm = useMemo(
    () => ({
      productTypeKey: normalizeTemplateKey(item?.product_type?.key),
      productTypeVersion: Number(item?.product_type?.version || 0),
    }),
    [item],
  );
  const [form, setForm] = useState(initialForm);
  const [templateOptions, setTemplateOptions] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [productTypeForm, setProductTypeForm] = useState(() =>
    createProductTypeFormState({ item, template: null }),
  );
  const [productTypeErrors, setProductTypeErrors] = useState(
    cloneProductTypeValidation(),
  );
  const [savingAction, setSavingAction] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(initialForm);
  }, [initialForm]);

  const loadTemplateOptions = useCallback(async () => {
    if (!canViewProductTypeTemplates) {
      setTemplateOptions([]);
      setTemplatesError("");
      setTemplatesLoading(false);
      return;
    }

    try {
      setTemplatesLoading(true);
      setTemplatesError("");
      const response = await getProductTypeTemplates();
      const currentSelectionRef = buildTemplateOptionValue(
        item?.product_type?.key,
        item?.product_type?.version,
      );
      const options = (Array.isArray(response?.data) ? response.data : []).filter(
        (templateOption) =>
          templateOption?.status === "active" ||
          buildTemplateOptionValue(
            templateOption?.key,
            templateOption?.version,
          ) === currentSelectionRef,
      );
      setTemplateOptions(options);
    } catch (loadError) {
      setTemplateOptions([]);
      setTemplatesError(
        loadError?.response?.data?.message ||
          loadError?.message ||
          "Failed to load product type templates.",
      );
    } finally {
      setTemplatesLoading(false);
    }
  }, [canViewProductTypeTemplates, item]);

  useEffect(() => {
    loadTemplateOptions();
  }, [loadTemplateOptions]);

  const loadSelectedTemplate = useCallback(
    async (templateKey, templateVersion = 0) => {
      const normalizedTemplateKey = normalizeTemplateKey(templateKey);
      if (!canViewProductTypeTemplates || !normalizedTemplateKey) {
        setSelectedTemplate(null);
        setTemplateError("");
        setTemplateLoading(false);
        return;
      }

      try {
        setTemplateLoading(true);
        setTemplateError("");
        const response = await getProductTypeTemplateByKey(normalizedTemplateKey, {
          ...(templateVersion > 0 ? { version: templateVersion } : {}),
        });
        setSelectedTemplate(response?.data || null);
      } catch (loadError) {
        setSelectedTemplate(null);
        setTemplateError(
          loadError?.response?.data?.message ||
            loadError?.message ||
            "Failed to load the selected product type template.",
        );
      } finally {
        setTemplateLoading(false);
      }
    },
    [canViewProductTypeTemplates],
  );

  useEffect(() => {
    const selectedKey = normalizeTemplateKey(form.productTypeKey);
    if (!selectedKey) {
      setSelectedTemplate(null);
      setTemplateError("");
      setProductTypeForm(createProductTypeFormState({ item, template: null }));
      setProductTypeErrors(cloneProductTypeValidation());
      return;
    }

    loadSelectedTemplate(selectedKey, Number(form.productTypeVersion || 0));
  }, [form.productTypeKey, form.productTypeVersion, item, loadSelectedTemplate]);

  useEffect(() => {
    if (!selectedTemplate) {
      return;
    }

    setProductTypeForm(createProductTypeFormState({ item, template: selectedTemplate }));
    setProductTypeErrors(cloneProductTypeValidation());
  }, [item, selectedTemplate]);

  const templateReady =
    !normalizeTemplateKey(form.productTypeKey) ||
    (!templateLoading && Boolean(selectedTemplate));

  const currentProductTypePayload = useMemo(() => {
    if (!normalizeTemplateKey(form.productTypeKey)) {
      return {
        product_type: null,
        product_specs: {
          fields: [],
          item_sizes: [],
          box_sizes: [],
          box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
          raw_values: {},
        },
      };
    }

    if (selectedTemplate) {
      return buildProductTypePayload({
        template: selectedTemplate,
        selectedProductTypeKey: form.productTypeKey,
        formState: productTypeForm,
      });
    }

    if (
      normalizeTemplateKey(item?.product_type?.key) === normalizeTemplateKey(form.productTypeKey) &&
      Number(item?.product_type?.version || 0) === Number(form.productTypeVersion || 0)
    ) {
      return buildExistingProductTypePayload(item);
    }

    return {
      product_type: null,
      product_specs: {
        fields: [],
        item_sizes: [],
        box_sizes: [],
        box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
        raw_values: {},
      },
    };
  }, [form.productTypeKey, form.productTypeVersion, item, productTypeForm, selectedTemplate]);

  const currentPayload = useMemo(
    () => ({
      ...buildPayloadFromForm(form),
      ...currentProductTypePayload,
    }),
    [currentProductTypePayload, form],
  );

  const initialPayload = useMemo(
    () => ({
      ...buildPayloadFromForm(initialForm),
      ...buildExistingProductTypePayload(item),
    }),
    [initialForm, item],
  );
  const hasChanges =
    normalizePayloadForCompare(currentPayload) !== normalizePayloadForCompare(initialPayload);
  const canCheck = Boolean(item?.permissions?.can_check) && !hasChanges;
  const canApprove = isAdmin && (item?.pd_checked === "checked" || hasChanges);

  const handleProductTypeChange = (nextValue) => {
    const { key: nextKey, version: nextVersion } = parseTemplateOptionValue(nextValue);
    const currentKey = normalizeTemplateKey(form.productTypeKey);
    const currentVersion = Number(form.productTypeVersion || 0);
    if (nextKey === currentKey && nextVersion === currentVersion) return;

    const hasDynamicValues = hasProductTypeFormValues(productTypeForm);
    const hasExistingSelection = Boolean(currentKey);
    if (hasExistingSelection || hasDynamicValues) {
      const confirmed = window.confirm(
        "Changing the product type will reset the current product spec fields. Continue?",
      );
      if (!confirmed) {
        return;
      }
    }

    setForm((prev) => ({
      ...prev,
      productTypeKey: nextKey,
      productTypeVersion: nextVersion,
    }));
    setSelectedTemplate(null);
    setTemplateError("");
    setProductTypeForm(createProductTypeFormState({ item: {}, template: null }));
    setProductTypeErrors(cloneProductTypeValidation());
  };

  const handleProductTypeFieldChange = (fieldKey, value) => {
    setProductTypeErrors(cloneProductTypeValidation());
    setProductTypeForm((prev) => ({
      ...prev,
      fieldValues: {
        ...prev.fieldValues,
        [fieldKey]: value,
      },
    }));
  };

  const handleItemSizeChange = (fieldKey, fieldName, value) => {
    setProductTypeErrors(cloneProductTypeValidation());
    setProductTypeForm((prev) => ({
      ...prev,
      itemSizeValues: {
        ...prev.itemSizeValues,
        [fieldKey]: {
          ...(prev.itemSizeValues?.[fieldKey] || {}),
          [fieldName]: value,
        },
      },
    }));
  };

  const handleBoxSizeChange = (fieldKey, fieldName, value) => {
    setProductTypeErrors(cloneProductTypeValidation());
    setProductTypeForm((prev) => {
      const nextEntry = {
        ...(prev.boxSizeValues?.[fieldKey] || {}),
        [fieldName]: value,
      };

      const normalizedBoxType =
        fieldName === "box_type"
          ? normalizeTemplateKey(value)
          : normalizeTemplateKey(nextEntry?.box_type);

      if (normalizedBoxType !== BOX_ENTRY_TYPES.INNER) {
        nextEntry.item_count_in_inner = "0";
      }
      if (normalizedBoxType !== BOX_ENTRY_TYPES.MASTER) {
        nextEntry.box_count_in_master = "0";
      }

      return {
        ...prev,
        boxSizeValues: {
          ...prev.boxSizeValues,
          [fieldKey]: nextEntry,
        },
      };
    });
  };

  const runMutation = async (action) => {
    try {
      setSavingAction(action);
      setError("");
      setProductTypeErrors(cloneProductTypeValidation());

      if (normalizeTemplateKey(form.productTypeKey) && !templateReady) {
        setError("Please wait for the selected product type template to finish loading.");
        return;
      }

      if (selectedTemplate) {
        const validation = validateProductTypeFormState({
          template: selectedTemplate,
          selectedProductTypeKey: form.productTypeKey,
          formState: productTypeForm,
        });

        if (!validation.valid) {
          setProductTypeErrors(validation.errors);
          setError("Please fix the highlighted product type fields before saving.");
          return;
        }
      }

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
              <div className="card om-card product-database-product-type-card">
                <div className="card-body">
                  <div className="row g-3 align-items-end">
                    <div className="col-lg-4">
                      <label className="form-label">Product Type</label>
                      <select
                        className={`form-select ${productTypeErrors.product_type ? "is-invalid" : ""}`}
                        value={buildTemplateOptionValue(form.productTypeKey, form.productTypeVersion)}
                        disabled={!canEdit || templatesLoading}
                        onChange={(event) => handleProductTypeChange(event.target.value)}
                      >
                        <option value="">Select product type</option>
                        {templateOptions.map((templateOption) => (
                          <option
                            key={templateOption._id || `${templateOption.key}-${templateOption.version}`}
                            value={buildTemplateOptionValue(
                              templateOption.key,
                              templateOption.version,
                            )}
                          >
                            {templateOption.label} v{templateOption.version}
                            {templateOption.status && templateOption.status !== "active"
                              ? ` (${templateOption.status})`
                              : ""}
                          </option>
                        ))}
                      </select>
                      {productTypeErrors.product_type && (
                        <div className="invalid-feedback d-block">
                          {productTypeErrors.product_type}
                        </div>
                      )}
                    </div>

                    <div className="col-lg-8">
                      <div className="d-flex flex-wrap gap-2 justify-content-lg-end">
                        {templatesLoading && (
                          <span className="om-summary-chip">Loading product types...</span>
                        )}
                        {templateLoading && normalizeTemplateKey(form.productTypeKey) && (
                          <span className="om-summary-chip">Loading selected template...</span>
                        )}
                        {selectedTemplate && (
                          <>
                            <span className="om-summary-chip">
                              {selectedTemplate.label}
                            </span>
                            <span className="om-summary-chip">
                              Version: {selectedTemplate.version}
                            </span>
                            <span className="om-summary-chip">
                              Status: {selectedTemplate.status}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {templatesError && (
                    <div className="alert alert-danger mt-3 mb-0">
                      {templatesError}
                    </div>
                  )}
                  {templateError && (
                    <div className="alert alert-danger mt-3 mb-0">
                      {templateError}
                    </div>
                  )}
                  {!templatesLoading &&
                    !templatesError &&
                    templateOptions.length === 0 && (
                      <div className="alert alert-warning mt-3 mb-0">
                        No product type templates are available yet.
                      </div>
                    )}
                  {!normalizeTemplateKey(form.productTypeKey) &&
                    !templatesLoading &&
                    !templatesError && (
                      <div className="alert alert-light border mt-3 mb-0">
                        Select a product type to load its template-driven product spec fields.
                      </div>
                    )}
                </div>
              </div>
            </section>

            {selectedTemplate && (
              <section className="mb-4">
                <ProductTypeDynamicForm
                  template={selectedTemplate}
                  fieldValues={productTypeForm.fieldValues}
                  itemSizeValues={productTypeForm.itemSizeValues}
                  boxSizeValues={productTypeForm.boxSizeValues}
                  errors={productTypeErrors}
                  disabled={!canEdit}
                  onFieldChange={handleProductTypeFieldChange}
                  onItemSizeChange={handleItemSizeChange}
                  onBoxSizeChange={handleBoxSizeChange}
                />
              </section>
            )}

            <section className="mb-4">
              <div className="alert alert-light border mb-0">
                All measurements are maintained in the selected product type template's
                Sizes section above. The legacy PD size editor has been removed.
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
                disabled={savingAction !== "" || !templateReady}
                onClick={() => runMutation("save")}
              >
                {savingAction === "save" ? "Saving..." : "Save Changes"}
              </button>
            )}
            {isManager && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canCheck || savingAction !== "" || !templateReady}
                onClick={() => runMutation("check")}
              >
                {savingAction === "check" ? "Checking..." : "Check"}
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                className="btn btn-success"
                disabled={!canApprove || savingAction !== "" || !templateReady}
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
                      <th>Product Sizes</th>
                      <th>Box Sizes</th>
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
                        <td><SizeSummary entries={getDisplayItemSizes(row)} type="item" /></td>
                        <td>
                          <div className="small text-secondary mb-1">
                            Mode: {formatBoxMode(getDisplayBoxMode(row))}
                          </div>
                          <SizeSummary entries={getDisplayBoxSizes(row)} type="box" />
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
