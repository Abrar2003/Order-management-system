import { useEffect, useMemo, useState } from "react";
import { BOX_ENTRY_TYPES } from "../utils/measuredSizeForm";
import {
  flattenTemplateFields,
  normalizeTemplateKey,
  sortTemplateGroups,
} from "../utils/productTypeTemplates";

const normalizeText = (value) => String(value ?? "").trim();

const getSizeErrorMessage = (errors = {}, fieldName = "") =>
  normalizeText(errors?.[fieldName]);

const DynamicSizeField = ({
  field,
  entry = {},
  errors = {},
  disabled = false,
  isBox = false,
  onChange,
}) => {
  const fieldKey = normalizeTemplateKey(field?.key);
  const normalizedBoxType = normalizeTemplateKey(entry?.box_type || field?.box_type);
  const needsInnerCount = normalizedBoxType === BOX_ENTRY_TYPES.INNER;
  const needsMasterCount = normalizedBoxType === BOX_ENTRY_TYPES.MASTER;

  return (
    <div className="om-product-type-size-card">
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
          <div className="fw-semibold">{field?.label}</div>
          {field?.description && (
            <div className="small text-secondary">{field.description}</div>
          )}
        </div>
        <div className="d-flex flex-wrap gap-2">
          <span className="om-summary-chip">
            Remark: {field?.size_remark || fieldKey}
          </span>
          {isBox && (
            <span className="om-summary-chip">
              Mode: {needsInnerCount || needsMasterCount ? "Carton" : "Individual"}
            </span>
          )}
        </div>
      </div>

      {normalizeText(errors?._error) && (
        <div className="alert alert-danger py-2 small mb-3">{errors._error}</div>
      )}

      <div className="row g-3">
        {["L", "B", "H"].map((dimensionKey) => (
          <div className="col-md-4" key={`${fieldKey}-${dimensionKey}`}>
            <label className="form-label">
              {dimensionKey}
              {field?.required ? " *" : ""}
            </label>
            <input
              type="number"
              min="0"
              step="0.001"
              className={`form-control ${getSizeErrorMessage(errors, dimensionKey) ? "is-invalid" : ""}`}
              value={entry?.[dimensionKey] ?? ""}
              disabled={disabled}
              onChange={(event) => onChange?.(fieldKey, dimensionKey, event.target.value)}
            />
            {getSizeErrorMessage(errors, dimensionKey) && (
              <div className="invalid-feedback d-block">
                {getSizeErrorMessage(errors, dimensionKey)}
              </div>
            )}
          </div>
        ))}

        <div className="col-md-6">
          <label className="form-label">Net Weight</label>
          <input
            type="number"
            min="0"
            step="0.001"
            className={`form-control ${getSizeErrorMessage(errors, "net_weight") ? "is-invalid" : ""}`}
            value={entry?.net_weight ?? ""}
            disabled={disabled}
            onChange={(event) => onChange?.(fieldKey, "net_weight", event.target.value)}
          />
          {getSizeErrorMessage(errors, "net_weight") && (
            <div className="invalid-feedback d-block">
              {getSizeErrorMessage(errors, "net_weight")}
            </div>
          )}
        </div>

        <div className="col-md-6">
          <label className="form-label">Gross Weight</label>
          <input
            type="number"
            min="0"
            step="0.001"
            className={`form-control ${getSizeErrorMessage(errors, "gross_weight") ? "is-invalid" : ""}`}
            value={entry?.gross_weight ?? ""}
            disabled={disabled}
            onChange={(event) => onChange?.(fieldKey, "gross_weight", event.target.value)}
          />
          {getSizeErrorMessage(errors, "gross_weight") && (
            <div className="invalid-feedback d-block">
              {getSizeErrorMessage(errors, "gross_weight")}
            </div>
          )}
        </div>

        {isBox && (
          <>
            <div className="col-md-4">
              <label className="form-label">Box Type</label>
              <select
                className={`form-select ${getSizeErrorMessage(errors, "box_type") ? "is-invalid" : ""}`}
                value={entry?.box_type || field?.box_type || BOX_ENTRY_TYPES.INDIVIDUAL}
                disabled={disabled}
                onChange={(event) => onChange?.(fieldKey, "box_type", event.target.value)}
              >
                <option value={BOX_ENTRY_TYPES.INDIVIDUAL}>Individual</option>
                <option value={BOX_ENTRY_TYPES.INNER}>Inner</option>
                <option value={BOX_ENTRY_TYPES.MASTER}>Master</option>
              </select>
              {getSizeErrorMessage(errors, "box_type") && (
                <div className="invalid-feedback d-block">
                  {getSizeErrorMessage(errors, "box_type")}
                </div>
              )}
            </div>

            <div className="col-md-4">
              <label className="form-label">Item Count In Inner</label>
              <input
                type="number"
                min="0"
                step="1"
                className={`form-control ${getSizeErrorMessage(errors, "item_count_in_inner") ? "is-invalid" : ""}`}
                value={entry?.item_count_in_inner ?? ""}
                disabled={disabled || !needsInnerCount}
                onChange={(event) =>
                  onChange?.(fieldKey, "item_count_in_inner", event.target.value)
                }
              />
              {getSizeErrorMessage(errors, "item_count_in_inner") && (
                <div className="invalid-feedback d-block">
                  {getSizeErrorMessage(errors, "item_count_in_inner")}
                </div>
              )}
            </div>

            <div className="col-md-4">
              <label className="form-label">Box Count In Master</label>
              <input
                type="number"
                min="0"
                step="1"
                className={`form-control ${getSizeErrorMessage(errors, "box_count_in_master") ? "is-invalid" : ""}`}
                value={entry?.box_count_in_master ?? ""}
                disabled={disabled || !needsMasterCount}
                onChange={(event) =>
                  onChange?.(fieldKey, "box_count_in_master", event.target.value)
                }
              />
              {getSizeErrorMessage(errors, "box_count_in_master") && (
                <div className="invalid-feedback d-block">
                  {getSizeErrorMessage(errors, "box_count_in_master")}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const DynamicField = ({
  field,
  value,
  error = "",
  disabled = false,
  onChange,
}) => {
  const fieldKey = normalizeTemplateKey(field?.key);
  const inputType = normalizeTemplateKey(field?.input_type);
  const options = Array.isArray(field?.options) ? field.options : [];

  if (inputType === "textarea") {
    return (
      <div className="col-12">
        <label className="form-label">
          {field?.label}
          {field?.required ? " *" : ""}
        </label>
        <textarea
          className={`form-control ${error ? "is-invalid" : ""}`}
          rows="3"
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) => onChange?.(fieldKey, event.target.value)}
        />
        {field?.description && <div className="form-text">{field.description}</div>}
        {error && <div className="invalid-feedback d-block">{error}</div>}
      </div>
    );
  }

  if (inputType === "boolean") {
    return (
      <div className="col-md-6">
        <div className="form-check form-switch mt-4 pt-2">
          <input
            className={`form-check-input ${error ? "is-invalid" : ""}`}
            type="checkbox"
            role="switch"
            checked={Boolean(value)}
            disabled={disabled}
            onChange={(event) => onChange?.(fieldKey, event.target.checked)}
          />
          <label className="form-check-label">
            {field?.label}
            {field?.required ? " *" : ""}
          </label>
        </div>
        {field?.description && <div className="form-text">{field.description}</div>}
        {error && <div className="invalid-feedback d-block">{error}</div>}
      </div>
    );
  }

  if (inputType === "select") {
    return (
      <div className="col-md-6">
        <label className="form-label">
          {field?.label}
          {field?.required ? " *" : ""}
        </label>
        <select
          className={`form-select ${error ? "is-invalid" : ""}`}
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) => onChange?.(fieldKey, event.target.value)}
        >
          <option value="">Select</option>
          {options.map((option) => (
            <option key={`${fieldKey}-${option}`} value={option}>
              {option}
            </option>
          ))}
        </select>
        {field?.description && <div className="form-text">{field.description}</div>}
        {error && <div className="invalid-feedback d-block">{error}</div>}
      </div>
    );
  }

  if (inputType === "multiselect") {
    const selectedValues = Array.isArray(value) ? value : [];
    return (
      <div className="col-12">
        <label className="form-label d-block mb-2">
          {field?.label}
          {field?.required ? " *" : ""}
        </label>
        <div className="om-product-type-checkbox-grid">
          {options.map((option) => {
            const checked = selectedValues.includes(option);
            return (
              <label
                key={`${fieldKey}-${option}`}
                className="form-check d-flex align-items-center gap-2"
              >
                <input
                  type="checkbox"
                  className="form-check-input mt-0"
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => {
                    const nextValues = event.target.checked
                      ? [...selectedValues, option]
                      : selectedValues.filter((entry) => entry !== option);
                    onChange?.(fieldKey, nextValues);
                  }}
                />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
        {field?.description && <div className="form-text">{field.description}</div>}
        {error && <div className="invalid-feedback d-block">{error}</div>}
      </div>
    );
  }

  if (inputType === "file") {
    const fileName = value instanceof File ? value.name : normalizeText(value?.name || value?.file_name);
    return (
      <div className="col-12">
        <label className="form-label">
          {field?.label}
          {field?.required ? " *" : ""}
        </label>
        <input
          type="file"
          className={`form-control ${error ? "is-invalid" : ""}`}
          disabled={disabled}
          onChange={(event) => onChange?.(fieldKey, event.target.files?.[0] || null)}
        />
        <div className="form-text">
          {field?.description || "Selected file metadata is saved here. Use the existing item file uploads for permanent storage."}
        </div>
        {fileName && (
          <div className="small text-secondary mt-1">Selected: {fileName}</div>
        )}
        {error && <div className="invalid-feedback d-block">{error}</div>}
      </div>
    );
  }

  return (
    <div className={inputType === "text" || inputType === "number" || inputType === "date" ? "col-md-6" : "col-12"}>
      <label className="form-label">
        {field?.label}
        {field?.required ? " *" : ""}
      </label>
      <input
        type={inputType === "number" ? "number" : inputType === "date" ? "date" : "text"}
        min={inputType === "number" ? "0" : undefined}
        step={inputType === "number" ? "0.001" : undefined}
        className={`form-control ${error ? "is-invalid" : ""}`}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange?.(fieldKey, event.target.value)}
      />
      {field?.unit && <div className="form-text">Unit: {field.unit}</div>}
      {field?.description && <div className="form-text">{field.description}</div>}
      {error && <div className="invalid-feedback d-block">{error}</div>}
    </div>
  );
};

const ProductTypeDynamicForm = ({
  template,
  fieldValues = {},
  itemSizeValues = {},
  boxSizeValues = {},
  errors = {},
  disabled = false,
  onFieldChange,
  onItemSizeChange,
  onBoxSizeChange,
}) => {
  const groups = useMemo(() => sortTemplateGroups(template?.groups), [template]);
  const [openGroups, setOpenGroups] = useState([]);

  useEffect(() => {
    setOpenGroups(groups.slice(0, 2).map((group) => normalizeTemplateKey(group?.key)));
  }, [groups]);

  if (!template) {
    return null;
  }

  return (
    <div className="d-grid gap-3">
      {groups.map((group) => {
        const groupKey = normalizeTemplateKey(group?.key);
        const isOpen = openGroups.includes(groupKey);
        const groupFields = flattenTemplateFields({ groups: [group] });

        return (
          <section key={groupKey} className="card om-card om-product-type-group-card">
            <button
              type="button"
              className="card-header bg-transparent border-0 d-flex justify-content-between align-items-center text-start"
              onClick={() =>
                setOpenGroups((prev) =>
                  prev.includes(groupKey)
                    ? prev.filter((entry) => entry !== groupKey)
                    : [...prev, groupKey],
                )
              }
            >
              <div>
                <div className="fw-semibold">{group?.label}</div>
                {group?.description && (
                  <div className="small text-secondary">{group.description}</div>
                )}
              </div>
              <span className="small text-secondary">{isOpen ? "Hide" : "Show"}</span>
            </button>

            {isOpen && (
              <div className="card-body">
                <div className="row g-3">
                  {groupFields.map((field) => {
                    const fieldKey = normalizeTemplateKey(field?.key);
                    const inputType = normalizeTemplateKey(field?.input_type);

                    if (inputType === "item_size") {
                      return (
                        <div className="col-12" key={fieldKey}>
                          <DynamicSizeField
                            field={field}
                            entry={itemSizeValues?.[fieldKey]}
                            errors={errors?.item_sizes?.[fieldKey] || {}}
                            disabled={disabled}
                            onChange={onItemSizeChange}
                          />
                        </div>
                      );
                    }

                    if (inputType === "box_size") {
                      return (
                        <div className="col-12" key={fieldKey}>
                          <DynamicSizeField
                            field={field}
                            entry={boxSizeValues?.[fieldKey]}
                            errors={errors?.box_sizes?.[fieldKey] || {}}
                            disabled={disabled}
                            isBox
                            onChange={onBoxSizeChange}
                          />
                        </div>
                      );
                    }

                    return (
                      <DynamicField
                        key={fieldKey}
                        field={field}
                        value={fieldValues?.[fieldKey]}
                        error={errors?.fields?.[fieldKey] || ""}
                        disabled={disabled}
                        onChange={onFieldChange}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default ProductTypeDynamicForm;
