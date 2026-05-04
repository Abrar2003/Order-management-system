import { useCallback, useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import { usePermissions } from "../auth/PermissionContext";
import {
  createProductTypeTemplate,
  getProductTypeTemplateByKey,
  getProductTypeTemplates,
  updateProductTypeTemplate,
  updateProductTypeTemplateStatus,
} from "../services/productTypeTemplates.service";
import {
  PRODUCT_TYPE_TEMPLATE_INPUT_TYPES,
  PRODUCT_TYPE_TEMPLATE_STATUSES,
  PRODUCT_TYPE_TEMPLATE_VALUE_TYPES,
  createTemplateDraft,
  createTemplateFieldDraft,
  createTemplateGroupDraft,
  normalizeTemplateKey,
} from "../utils/productTypeTemplates";
import "../App.css";

const normalizeText = (value) => String(value ?? "").trim();

const buildTemplateRef = (key = "", version = "") =>
  normalizeTemplateKey(key) && Number(version) > 0
    ? `${normalizeTemplateKey(key)}::${Number(version)}`
    : "";

const parseTemplateRef = (value = "") => {
  const [keyPart = "", versionPart = ""] = String(value || "").split("::");
  const version = Number.parseInt(versionPart, 10);
  return {
    key: normalizeTemplateKey(keyPart),
    version: Number.isFinite(version) && version > 0 ? version : 0,
  };
};

const splitCsvText = (value) =>
  String(value ?? "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseJsonText = (value, fallback = {}) => {
  const normalized = normalizeText(value);
  if (!normalized) return fallback;
  return JSON.parse(normalized);
};

const serializeDraftField = (field = {}) => ({
  ...field,
  options_text: Array.isArray(field?.options) ? field.options.join(", ") : "",
  source_headers_text: Array.isArray(field?.source_headers)
    ? field.source_headers.join(", ")
    : "",
  size_source_headers_text: {
    L: Array.isArray(field?.size_source_headers?.L)
      ? field.size_source_headers.L.join(", ")
      : "",
    B: Array.isArray(field?.size_source_headers?.B)
      ? field.size_source_headers.B.join(", ")
      : "",
    H: Array.isArray(field?.size_source_headers?.H)
      ? field.size_source_headers.H.join(", ")
      : "",
    net_weight: Array.isArray(field?.size_source_headers?.net_weight)
      ? field.size_source_headers.net_weight.join(", ")
      : "",
    gross_weight: Array.isArray(field?.size_source_headers?.gross_weight)
      ? field.size_source_headers.gross_weight.join(", ")
      : "",
    item_count_in_inner: Array.isArray(field?.size_source_headers?.item_count_in_inner)
      ? field.size_source_headers.item_count_in_inner.join(", ")
      : "",
    box_count_in_master: Array.isArray(field?.size_source_headers?.box_count_in_master)
      ? field.size_source_headers.box_count_in_master.join(", ")
      : "",
  },
  validation_text: JSON.stringify(field?.validation || {}, null, 2),
  default_value_text:
    field?.default_value === null || field?.default_value === undefined
      ? ""
      : typeof field.default_value === "object"
      ? JSON.stringify(field.default_value, null, 2)
      : String(field.default_value),
});

const createEditorDraft = (template = null) => {
  const source = template
    ? JSON.parse(JSON.stringify(template))
    : createTemplateDraft();

  return {
    ...source,
    groups: (Array.isArray(source?.groups) ? source.groups : []).map((group) => ({
      ...group,
      fields: (Array.isArray(group?.fields) ? group.fields : []).map((field) =>
        serializeDraftField(field),
      ),
    })),
  };
};

const buildTemplatePayloadFromDraft = (draft = {}) => ({
  key: normalizeText(draft?.key),
  label: normalizeText(draft?.label),
  description: normalizeText(draft?.description),
  version: Number(draft?.version || 1),
  status: normalizeText(draft?.status || "draft") || "draft",
  groups: (Array.isArray(draft?.groups) ? draft.groups : []).map((group, groupIndex) => ({
    key: normalizeText(group?.key),
    label: normalizeText(group?.label),
    description: normalizeText(group?.description),
    order: Number(group?.order ?? groupIndex),
    is_active: group?.is_active !== false,
    fields: (Array.isArray(group?.fields) ? group.fields : []).map((field, fieldIndex) => ({
      key: normalizeText(field?.key),
      label: normalizeText(field?.label),
      description: normalizeText(field?.description),
      input_type: normalizeText(field?.input_type || "text"),
      value_type: normalizeText(field?.value_type || "string"),
      unit: normalizeText(field?.unit),
      required: Boolean(field?.required),
      searchable: Boolean(field?.searchable),
      filterable: Boolean(field?.filterable),
      show_in_table: Boolean(field?.show_in_table),
      order: Number(field?.order ?? fieldIndex),
      options: splitCsvText(field?.options_text),
      default_value: (() => {
        const inputType = normalizeText(field?.input_type || "text");
        const valueType = normalizeText(field?.value_type || "string");
        const rawText = normalizeText(field?.default_value_text);
        if (!rawText) return null;
        if (valueType === "number") return Number(rawText);
        if (valueType === "boolean") return rawText.toLowerCase() === "true";
        if (valueType === "array" || inputType === "multiselect") {
          return splitCsvText(rawText);
        }
        if (valueType === "object" || inputType === "file") {
          return parseJsonText(rawText, {});
        }
        return rawText;
      })(),
      validation: parseJsonText(field?.validation_text, {}),
      source_headers: splitCsvText(field?.source_headers_text),
      size_source_headers: {
        L: splitCsvText(field?.size_source_headers_text?.L),
        B: splitCsvText(field?.size_source_headers_text?.B),
        H: splitCsvText(field?.size_source_headers_text?.H),
        net_weight: splitCsvText(field?.size_source_headers_text?.net_weight),
        gross_weight: splitCsvText(field?.size_source_headers_text?.gross_weight),
        item_count_in_inner: splitCsvText(
          field?.size_source_headers_text?.item_count_in_inner,
        ),
        box_count_in_master: splitCsvText(
          field?.size_source_headers_text?.box_count_in_master,
        ),
      },
      size_remark: normalizeText(field?.size_remark),
      box_type: normalizeText(field?.box_type || "individual"),
      is_active: field?.is_active !== false,
    })),
  })),
});

const TemplateEditorModal = ({
  draft,
  setDraft,
  onClose,
  onSave,
  saving = false,
  error = "",
  isEdit = false,
}) => {
  const updateDraft = (path, value) => {
    setDraft((prev) => ({
      ...prev,
      [path]: value,
    }));
  };

  const updateGroup = (groupIndex, fieldName, value) => {
    setDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((group, index) =>
        index === groupIndex ? { ...group, [fieldName]: value } : group,
      ),
    }));
  };

  const updateTemplateField = (groupIndex, fieldIndex, fieldName, value) => {
    setDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((group, index) => {
        if (index !== groupIndex) return group;
        return {
          ...group,
          fields: group.fields.map((field, innerIndex) =>
            innerIndex === fieldIndex ? { ...field, [fieldName]: value } : field,
          ),
        };
      }),
    }));
  };

  const updateTemplateFieldNested = (
    groupIndex,
    fieldIndex,
    nestedKey,
    nestedField,
    value,
  ) => {
    setDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((group, index) => {
        if (index !== groupIndex) return group;
        return {
          ...group,
          fields: group.fields.map((field, innerIndex) => {
            if (innerIndex !== fieldIndex) return field;
            return {
              ...field,
              [nestedKey]: {
                ...(field?.[nestedKey] || {}),
                [nestedField]: value,
              },
            };
          }),
        };
      }),
    }));
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
        className="modal-dialog modal-dialog-centered modal-xl"
        role="document"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <div>
              <h5 className="modal-title">
                {isEdit ? "Edit Product Type Template" : "Create Product Type Template"}
              </h5>
              <div className="small text-muted">
                Configure groups, fields, and import/source mapping.
              </div>
            </div>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              onClick={onClose}
            />
          </div>

          <div className="modal-body">
            {error && <div className="alert alert-danger">{error}</div>}

            <div className="row g-3 mb-4">
              <div className="col-md-3">
                <label className="form-label">Key</label>
                <input
                  type="text"
                  className="form-control"
                  value={draft.key}
                  onChange={(event) => updateDraft("key", event.target.value)}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label">Label</label>
                <input
                  type="text"
                  className="form-control"
                  value={draft.label}
                  onChange={(event) => updateDraft("label", event.target.value)}
                />
              </div>
              <div className="col-md-2">
                <label className="form-label">Version</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="form-control"
                  value={draft.version}
                  onChange={(event) => updateDraft("version", event.target.value)}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  value={draft.status}
                  onChange={(event) => updateDraft("status", event.target.value)}
                >
                  {PRODUCT_TYPE_TEMPLATE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-12">
                <label className="form-label">Description</label>
                <textarea
                  rows="2"
                  className="form-control"
                  value={draft.description}
                  onChange={(event) => updateDraft("description", event.target.value)}
                />
              </div>
            </div>

            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="mb-0">Groups</h6>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    groups: [...prev.groups, createTemplateGroupDraft()],
                  }))
                }
              >
                Add Group
              </button>
            </div>

            <div className="d-grid gap-3">
              {draft.groups.map((group, groupIndex) => (
                <div className="card om-card" key={`group-${groupIndex}`}>
                  <div className="card-body">
                    <div className="d-flex justify-content-between align-items-center gap-2 mb-3">
                      <h6 className="mb-0">Group {groupIndex + 1}</h6>
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            groups: prev.groups.filter((_, index) => index !== groupIndex),
                          }))
                        }
                      >
                        Remove Group
                      </button>
                    </div>

                    <div className="row g-3 mb-3">
                      <div className="col-md-3">
                        <label className="form-label">Key</label>
                        <input
                          type="text"
                          className="form-control"
                          value={group.key}
                          onChange={(event) =>
                            updateGroup(groupIndex, "key", event.target.value)
                          }
                        />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label">Label</label>
                        <input
                          type="text"
                          className="form-control"
                          value={group.label}
                          onChange={(event) =>
                            updateGroup(groupIndex, "label", event.target.value)
                          }
                        />
                      </div>
                      <div className="col-md-2">
                        <label className="form-label">Order</label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          className="form-control"
                          value={group.order}
                          onChange={(event) =>
                            updateGroup(groupIndex, "order", event.target.value)
                          }
                        />
                      </div>
                      <div className="col-md-3 d-flex align-items-end">
                        <label className="form-check mb-2">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={group.is_active !== false}
                            onChange={(event) =>
                              updateGroup(groupIndex, "is_active", event.target.checked)
                            }
                          />
                          <span className="form-check-label ms-2">Active Group</span>
                        </label>
                      </div>
                      <div className="col-12">
                        <label className="form-label">Description</label>
                        <textarea
                          rows="2"
                          className="form-control"
                          value={group.description}
                          onChange={(event) =>
                            updateGroup(groupIndex, "description", event.target.value)
                          }
                        />
                      </div>
                    </div>

                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <h6 className="mb-0">Fields</h6>
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            groups: prev.groups.map((entry, index) =>
                              index === groupIndex
                                ? {
                                    ...entry,
                                    fields: [...entry.fields, serializeDraftField(createTemplateFieldDraft())],
                                  }
                                : entry,
                            ),
                          }))
                        }
                      >
                        Add Field
                      </button>
                    </div>

                    <div className="d-grid gap-3">
                      {group.fields.map((field, fieldIndex) => (
                        <div className="border rounded-4 p-3" key={`field-${groupIndex}-${fieldIndex}`}>
                          <div className="d-flex justify-content-between align-items-center gap-2 mb-3">
                            <div className="fw-semibold">Field {fieldIndex + 1}</div>
                            <button
                              type="button"
                              className="btn btn-outline-danger btn-sm"
                              onClick={() =>
                                setDraft((prev) => ({
                                  ...prev,
                                  groups: prev.groups.map((entry, index) =>
                                    index === groupIndex
                                      ? {
                                          ...entry,
                                          fields: entry.fields.filter(
                                            (_, innerIndex) => innerIndex !== fieldIndex,
                                          ),
                                        }
                                      : entry,
                                  ),
                                }))
                              }
                            >
                              Remove Field
                            </button>
                          </div>

                          <div className="row g-3">
                            <div className="col-md-3">
                              <label className="form-label">Key</label>
                              <input
                                type="text"
                                className="form-control"
                                value={field.key}
                                onChange={(event) =>
                                  updateTemplateField(
                                    groupIndex,
                                    fieldIndex,
                                    "key",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>
                            <div className="col-md-4">
                              <label className="form-label">Label</label>
                              <input
                                type="text"
                                className="form-control"
                                value={field.label}
                                onChange={(event) =>
                                  updateTemplateField(
                                    groupIndex,
                                    fieldIndex,
                                    "label",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>
                            <div className="col-md-2">
                              <label className="form-label">Order</label>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                className="form-control"
                                value={field.order}
                                onChange={(event) =>
                                  updateTemplateField(
                                    groupIndex,
                                    fieldIndex,
                                    "order",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>
                            <div className="col-md-3">
                              <label className="form-label">Unit</label>
                              <input
                                type="text"
                                className="form-control"
                                value={field.unit}
                                onChange={(event) =>
                                  updateTemplateField(
                                    groupIndex,
                                    fieldIndex,
                                    "unit",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>

                            <div className="col-md-4">
                              <label className="form-label">Input Type</label>
                              <select
                                className="form-select"
                                value={field.input_type}
                                onChange={(event) =>
                                  updateTemplateField(
                                    groupIndex,
                                    fieldIndex,
                                    "input_type",
                                    event.target.value,
                                  )
                                }
                              >
                                {PRODUCT_TYPE_TEMPLATE_INPUT_TYPES.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="col-md-4">
                              <label className="form-label">Value Type</label>
                              <select
                                className="form-select"
                                value={field.value_type}
                                onChange={(event) =>
                                  updateTemplateField(
                                    groupIndex,
                                    fieldIndex,
                                    "value_type",
                                    event.target.value,
                                  )
                                }
                              >
                                {PRODUCT_TYPE_TEMPLATE_VALUE_TYPES.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="col-md-4">
                              <label className="form-label">Box Type</label>
                              <select
                                className="form-select"
                                value={field.box_type || "individual"}
                                onChange={(event) =>
                                  updateTemplateField(
                                    groupIndex,
                                    fieldIndex,
                                    "box_type",
                                    event.target.value,
                                  )
                                }
                              >
                                <option value="individual">individual</option>
                                <option value="inner">inner</option>
                                <option value="master">master</option>
                              </select>
                            </div>

                            <div className="col-12">
                              <label className="form-label">Description</label>
                              <textarea
                                rows="2"
                                className="form-control"
                                value={field.description}
                                onChange={(event) =>
                                  updateTemplateField(
                                    groupIndex,
                                    fieldIndex,
                                    "description",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>

                            <div className="col-md-4">
                              <label className="form-label">Options</label>
                              <input
                                type="text"
                                className="form-control"
                                value={field.options_text}
                                placeholder="Option A, Option B"
                                onChange={(event) =>
                                  updateTemplateField(
                                    groupIndex,
                                    fieldIndex,
                                    "options_text",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>
                            <div className="col-md-4">
                              <label className="form-label">Source Headers</label>
                              <input
                                type="text"
                                className="form-control"
                                value={field.source_headers_text}
                                placeholder="Header 1, Header 2"
                                onChange={(event) =>
                                  updateTemplateField(
                                    groupIndex,
                                    fieldIndex,
                                    "source_headers_text",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>
                            <div className="col-md-4">
                              <label className="form-label">Size Remark</label>
                              <input
                                type="text"
                                className="form-control"
                                value={field.size_remark}
                                onChange={(event) =>
                                  updateTemplateField(
                                    groupIndex,
                                    fieldIndex,
                                    "size_remark",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>

                            <div className="col-md-6">
                              <label className="form-label">Default Value</label>
                              <textarea
                                rows="2"
                                className="form-control"
                                value={field.default_value_text}
                                onChange={(event) =>
                                  updateTemplateField(
                                    groupIndex,
                                    fieldIndex,
                                    "default_value_text",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>
                            <div className="col-md-6">
                              <label className="form-label">Validation JSON</label>
                              <textarea
                                rows="2"
                                className="form-control font-monospace"
                                value={field.validation_text}
                                onChange={(event) =>
                                  updateTemplateField(
                                    groupIndex,
                                    fieldIndex,
                                    "validation_text",
                                    event.target.value,
                                  )
                                }
                              />
                            </div>

                            <div className="col-12">
                              <div className="row g-2">
                                {[
                                  "L",
                                  "B",
                                  "H",
                                  "net_weight",
                                  "gross_weight",
                                  "item_count_in_inner",
                                  "box_count_in_master",
                                ].map((sizeKey) => (
                                  <div className="col-md-6 col-xl-3" key={sizeKey}>
                                    <label className="form-label small text-secondary">
                                      {sizeKey}
                                    </label>
                                    <input
                                      type="text"
                                      className="form-control"
                                      value={field.size_source_headers_text?.[sizeKey] || ""}
                                      onChange={(event) =>
                                        updateTemplateFieldNested(
                                          groupIndex,
                                          fieldIndex,
                                          "size_source_headers_text",
                                          sizeKey,
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="col-12">
                              <div className="d-flex flex-wrap gap-3">
                                {[
                                  ["required", "Required"],
                                  ["searchable", "Searchable"],
                                  ["filterable", "Filterable"],
                                  ["show_in_table", "Show In Table"],
                                  ["is_active", "Active"],
                                ].map(([fieldName, label]) => (
                                  <label className="form-check" key={`${groupIndex}-${fieldIndex}-${fieldName}`}>
                                    <input
                                      type="checkbox"
                                      className="form-check-input"
                                      checked={Boolean(field?.[fieldName])}
                                      onChange={(event) =>
                                        updateTemplateField(
                                          groupIndex,
                                          fieldIndex,
                                          fieldName,
                                          event.target.checked,
                                        )
                                      }
                                    />
                                    <span className="form-check-label ms-2">{label}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? "Saving..." : isEdit ? "Save Template" : "Create Template"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ProductTypeTemplates = () => {
  const { hasPermission, isAdmin, role } = usePermissions();
  const canViewTemplates = hasPermission("product_type_templates", "view");
  const canManageTemplates =
    isAdmin &&
    (hasPermission("product_type_templates", "create") ||
      hasPermission("product_type_templates", "edit"));

  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedTemplateRef, setSelectedTemplateRef] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDraft, setEditorDraft] = useState(() => createEditorDraft());
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState("");

  const loadTemplates = useCallback(async () => {
    if (!canViewTemplates) {
      setTemplates([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await getProductTypeTemplates();
      const rows = Array.isArray(response?.data) ? response.data : [];
      setTemplates(rows);
      setSelectedTemplateRef(
        (prev) =>
          prev || buildTemplateRef(rows[0]?.key, rows[0]?.version),
      );
    } catch (loadError) {
      setTemplates([]);
      setError(
        loadError?.response?.data?.message ||
          loadError?.message ||
          "Failed to load product type templates.",
      );
    } finally {
      setLoading(false);
    }
  }, [canViewTemplates]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    const { key: selectedKey, version: selectedVersion } = parseTemplateRef(selectedTemplateRef);
    if (!selectedKey) {
      setSelectedTemplate(null);
      setTemplateError("");
      return;
    }

    const loadTemplate = async () => {
      try {
        setTemplateLoading(true);
        setTemplateError("");
        const response = await getProductTypeTemplateByKey(selectedKey, {
          ...(selectedVersion > 0 ? { version: selectedVersion } : {}),
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
    };

    loadTemplate();
  }, [selectedTemplateRef]);

  const openCreate = () => {
    setEditingTemplateId("");
    setEditorDraft(createEditorDraft());
    setEditorError("");
    setEditorOpen(true);
  };

  const openEdit = () => {
    setEditingTemplateId(selectedTemplate?._id || "");
    setEditorDraft(createEditorDraft(selectedTemplate));
    setEditorError("");
    setEditorOpen(true);
  };

  const handleSaveTemplate = async () => {
    try {
      setEditorSaving(true);
      setEditorError("");
      const payload = buildTemplatePayloadFromDraft(editorDraft);

      let response;
      if (editingTemplateId) {
        response = await updateProductTypeTemplate(editingTemplateId, payload);
      } else {
        response = await createProductTypeTemplate(payload);
      }

      setSuccess(
        response?.message ||
          (editingTemplateId
            ? "Product type template updated successfully."
            : "Product type template created successfully."),
      );
      setEditorOpen(false);
      setSelectedTemplate(response?.data || null);
      setSelectedTemplateRef(
        buildTemplateRef(
          response?.data?.key || payload.key,
          response?.data?.version || payload.version,
        ),
      );
      await loadTemplates();
    } catch (saveError) {
      setEditorError(
        saveError?.response?.data?.message ||
          saveError?.message ||
          "Failed to save product type template.",
      );
    } finally {
      setEditorSaving(false);
    }
  };

  const handleStatusChange = async (nextStatus) => {
    if (!selectedTemplate?._id || !nextStatus || nextStatus === selectedTemplate?.status) {
      return;
    }

    try {
      setTemplateError("");
      const response = await updateProductTypeTemplateStatus(selectedTemplate._id, nextStatus);
      setSuccess(response?.message || "Template status updated successfully.");
      setSelectedTemplate(response?.data || null);
      setSelectedTemplateRef(
        buildTemplateRef(
          response?.data?.key || selectedTemplate.key,
          response?.data?.version || selectedTemplate.version,
        ),
      );
      await loadTemplates();
    } catch (statusError) {
      setTemplateError(
        statusError?.response?.data?.message ||
          statusError?.message ||
          "Failed to update template status.",
      );
    }
  };

  const handleArchive = async () => {
    if (!selectedTemplate?._id) return;
    const confirmed = window.confirm(
      `Archive template ${selectedTemplate.label || selectedTemplate.key}?`,
    );
    if (!confirmed) return;

    await handleStatusChange("archived");
  };

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
          <div>
            <div className="small text-uppercase text-secondary fw-semibold mb-1">
              Settings
            </div>
            <h2 className="h4 mb-1">Product Type Templates</h2>
            <p className="text-secondary mb-0">
              Configure dynamic product spec templates for Product Database and future imports.
            </p>
          </div>

          <div className="d-flex gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={loadTemplates}
              disabled={loading}
            >
              Refresh
            </button>
            {canManageTemplates && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={openCreate}
              >
                Create Template
              </button>
            )}
          </div>
        </div>

        {!canViewTemplates ? (
          <div className="alert alert-danger">
            Product type templates are not available for your access level.
          </div>
        ) : (
          <>
            {error && <div className="alert alert-danger">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}

            <div className="row g-3">
              <div className="col-xl-4">
                <div className="card om-card h-100">
                  <div className="card-body p-0">
                    {loading ? (
                      <div className="p-4 text-center text-secondary">
                        Loading product type templates...
                      </div>
                    ) : templates.length === 0 ? (
                      <div className="p-4 text-center text-secondary">
                        No templates found.
                      </div>
                    ) : (
                      <div className="list-group list-group-flush product-type-template-list">
                        {templates.map((template) => {
                          const isActive =
                            buildTemplateRef(template?.key, template?.version) ===
                            selectedTemplateRef;
                          return (
                            <button
                              key={`${template._id || template.key}-${template.version}`}
                              type="button"
                              className={`list-group-item list-group-item-action text-start ${isActive ? "active" : ""}`}
                              onClick={() =>
                                setSelectedTemplateRef(
                                  buildTemplateRef(template.key, template.version),
                                )
                              }
                            >
                              <div className="d-flex justify-content-between align-items-start gap-2">
                                <div>
                                  <div className="fw-semibold">
                                    {template.label}
                                  </div>
                                  <div className="small text-secondary">
                                    {template.key} | v{template.version}
                                  </div>
                                </div>
                                <span className="badge text-bg-light border text-secondary">
                                  {template.status}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="col-xl-8">
                <div className="card om-card h-100">
                  <div className="card-body">
                    {templateLoading ? (
                      <div className="text-center py-5 text-secondary">
                        Loading template details...
                      </div>
                    ) : templateError ? (
                      <div className="alert alert-danger mb-0">{templateError}</div>
                    ) : !selectedTemplate ? (
                      <div className="text-center py-5 text-secondary">
                        Select a template to view its groups and fields.
                      </div>
                    ) : (
                      <>
                        <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
                          <div>
                            <h3 className="h5 mb-1">{selectedTemplate.label}</h3>
                            <div className="small text-secondary">
                              {selectedTemplate.key} | v{selectedTemplate.version}
                            </div>
                            {selectedTemplate.description && (
                              <p className="text-secondary mb-0 mt-2">
                                {selectedTemplate.description}
                              </p>
                            )}
                          </div>

                          <div className="d-flex flex-wrap gap-2 justify-content-end">
                            <span className="om-summary-chip">
                              Status: {selectedTemplate.status}
                            </span>
                            <span className="om-summary-chip">
                              Groups: {selectedTemplate.groups?.length || 0}
                            </span>
                            <span className="om-summary-chip">
                              Viewer: {role || "user"}
                            </span>
                          </div>
                        </div>

                        {canManageTemplates && (
                          <div className="d-flex flex-wrap gap-2 mb-3">
                            <button
                              type="button"
                              className="btn btn-outline-primary btn-sm"
                              onClick={openEdit}
                            >
                              Edit Template
                            </button>
                            <select
                              className="form-select form-select-sm w-auto"
                              value={selectedTemplate.status}
                              onChange={(event) => handleStatusChange(event.target.value)}
                            >
                              {PRODUCT_TYPE_TEMPLATE_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="btn btn-outline-danger btn-sm"
                              onClick={handleArchive}
                            >
                              Archive
                            </button>
                          </div>
                        )}

                        <div className="d-grid gap-3">
                          {(selectedTemplate.groups || []).map((group) => (
                            <section
                              key={`${selectedTemplate.key}-${group.key}`}
                              className="card om-card product-type-template-group-card"
                            >
                              <div className="card-body">
                                <div className="d-flex flex-wrap justify-content-between gap-2 mb-3">
                                  <div>
                                    <h4 className="h6 mb-1">{group.label}</h4>
                                    <div className="small text-secondary">
                                      {group.key} | order {group.order}
                                    </div>
                                    {group.description && (
                                      <div className="small text-secondary mt-1">
                                        {group.description}
                                      </div>
                                    )}
                                  </div>
                                  <span className="om-summary-chip">
                                    Fields: {group.fields?.length || 0}
                                  </span>
                                </div>

                                <div className="row g-3">
                                  {(group.fields || []).map((field) => (
                                    <div
                                      className="col-12"
                                      key={`${group.key}-${field.key}-${field._id || field.order}`}
                                    >
                                      <div className="border rounded-4 p-3">
                                        <div className="d-flex flex-wrap justify-content-between gap-2 mb-2">
                                          <div>
                                            <div className="fw-semibold">{field.label}</div>
                                            <div className="small text-secondary">
                                              {field.key}
                                            </div>
                                          </div>
                                          <div className="d-flex flex-wrap gap-2">
                                            <span className="om-summary-chip">
                                              {field.input_type}
                                            </span>
                                            <span className="om-summary-chip">
                                              {field.value_type}
                                            </span>
                                            {field.required && (
                                              <span className="om-summary-chip">Required</span>
                                            )}
                                          </div>
                                        </div>

                                        {field.description && (
                                          <div className="small text-secondary mb-2">
                                            {field.description}
                                          </div>
                                        )}

                                        <div className="small d-flex flex-wrap gap-2">
                                          {field.unit && (
                                            <span className="om-summary-chip">
                                              Unit: {field.unit}
                                            </span>
                                          )}
                                          {field.size_remark && (
                                            <span className="om-summary-chip">
                                              Remark: {field.size_remark}
                                            </span>
                                          )}
                                          {field.box_type && (
                                            <span className="om-summary-chip">
                                              Box Type: {field.box_type}
                                            </span>
                                          )}
                                          {Array.isArray(field.options) && field.options.length > 0 && (
                                            <span className="om-summary-chip">
                                              Options: {field.options.join(", ")}
                                            </span>
                                          )}
                                          {Array.isArray(field.source_headers) &&
                                            field.source_headers.length > 0 && (
                                              <span className="om-summary-chip">
                                                Headers: {field.source_headers.join(", ")}
                                              </span>
                                            )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </section>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {editorOpen && canManageTemplates && (
        <TemplateEditorModal
          draft={editorDraft}
          setDraft={setEditorDraft}
          onClose={() => setEditorOpen(false)}
          onSave={handleSaveTemplate}
          saving={editorSaving}
          error={editorError}
          isEdit={Boolean(editingTemplateId)}
        />
      )}
    </>
  );
};

export default ProductTypeTemplates;
