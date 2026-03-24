import { useEffect, useState } from "react";
import api from "../api/axios";
import { toISODateString } from "../utils/date";
import "../App.css";

const createInitialForm = (record = null) => ({
  order_id: String(
    record?.order_id?.order_id
    || record?.order_id_value
    || record?.order_id
    || "",
  ).trim(),
  brandId: String(record?.brand?.id || "").trim(),
  vendor: String(record?.vendor?.name || "").trim(),
  creation_date: toISODateString(record?.creation_date) || "",
  log: String(record?.log || ""),
});

const normalizeVendors = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));

const EmailLogsModal = ({
  onClose,
  onSuccess,
  mode = "create",
  record = null,
}) => {
  const isUpdateMode = mode === "update" && Boolean(record?._id);
  const [form, setForm] = useState(() => createInitialForm(record));
  const [options, setOptions] = useState({ brands: [], vendors: [] });
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;

    const fetchOptions = async () => {
      try {
        setLoadingOptions(true);
        setOptionsError("");

        const response = await api.get("/email-logs/create/options");
        if (cancelled) return;

        const nextBrands = Array.isArray(response?.data?.data?.brands)
          ? response.data.data.brands
              .map((brand) => ({
                id: String(brand?.id || "").trim(),
                name: String(brand?.name || "").trim(),
              }))
              .filter((brand) => brand.id && brand.name)
          : [];

        setOptions({
          brands: nextBrands,
          vendors: normalizeVendors(response?.data?.data?.vendors),
        });
      } catch (err) {
        if (cancelled) return;
        setOptions({ brands: [], vendors: [] });
        setOptionsError("Failed to load brand and vendor options.");
      } finally {
        if (!cancelled) {
          setLoadingOptions(false);
        }
      }
    };

    fetchOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setForm(createInitialForm(record));
    setError("");
    setSuccess("");
  }, [record, isUpdateMode]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!form.order_id || !form.brandId || !form.vendor || !form.creation_date) {
      setError("Please fill all required fields.");
      return;
    }

    const selectedBrand = options.brands.find((brand) => brand.id === form.brandId);
    if (!selectedBrand) {
      setError("Please select a valid brand.");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        order_id: String(form.order_id || "").trim(),
        brand: {
          name: selectedBrand.name,
          id: selectedBrand.id,
        },
        vendor: String(form.vendor || "").trim(),
        creation_date: String(form.creation_date || "").trim(),
      };
      if (isUpdateMode) {
        payload.log = String(form.log || "").trim();
      }

      const response = isUpdateMode
        ? await api.patch(`/email-logs/${record._id}`, payload)
        : await api.post("/email-logs", payload);

      const successMessage = response?.data?.message
        || (isUpdateMode
          ? "Email log updated successfully."
          : "Email log created successfully.");

      setSuccess(successMessage);
      if (!isUpdateMode) {
        setForm(createInitialForm());
      }
      onSuccess?.(successMessage);
    } catch (err) {
      setError(
        err?.response?.data?.message
        || (isUpdateMode ? "Failed to update email log." : "Failed to create email log."),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              {isUpdateMode ? "Update Email Log" : "Create Email Log"}
            </h5>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              onClick={onClose}
              disabled={saving}
            />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="modal-body d-grid gap-3">
              {optionsError && <div className="alert alert-warning mb-0">{optionsError}</div>}
              {error && <div className="alert alert-danger mb-0">{error}</div>}
              {success && <div className="alert alert-success mb-0">{success}</div>}

              <div>
                <label className="form-label">PO Number</label>
                <input
                  type="text"
                  name="order_id"
                  className="form-control"
                  value={form.order_id}
                  onChange={handleChange}
                  placeholder="Enter PO number"
                  disabled={saving}
                  required
                />
              </div>

              <div>
                <label className="form-label">Brand</label>
                <select
                  name="brandId"
                  className="form-select"
                  value={form.brandId}
                  onChange={handleChange}
                  disabled={saving || loadingOptions || options.brands.length === 0}
                  required
                >
                  <option value="">Select Brand</option>
                  {options.brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">Vendor</label>
                <select
                  name="vendor"
                  className="form-select"
                  value={form.vendor}
                  onChange={handleChange}
                  disabled={saving || loadingOptions || options.vendors.length === 0}
                  required
                >
                  <option value="">Select Vendor</option>
                  {options.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">
                  Creation Date
                </label>
                <input
                  type="date"
                  name="creation_date"
                  className="form-control"
                  value={form.creation_date}
                  onChange={handleChange}
                  disabled={saving}
                  required
                />
              </div>

              {isUpdateMode && (
                <div>
                  <label className="form-label">Log Matter</label>
                  <textarea
                    name="log"
                    className="form-control"
                    value={form.log}
                    onChange={handleChange}
                    placeholder="Enter log details..."
                    rows="4"
                    disabled={saving}
                  />
                </div>
              )}

            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : (isUpdateMode ? "Update Log" : "Create Record")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EmailLogsModal;
