import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import { editCompleteOrder } from "../services/orders.service";
import OrderEtdWithHistory from "./OrderEtdWithHistory";
import { formatDateDDMMYYYY, toISODateString } from "../utils/date";
import "../App.css";

const createInitialForm = (order) => ({
  order_id: String(order?.order_id || "").trim(),
  brand: String(order?.brand || "").trim(),
  vendor: String(order?.vendor || "").trim(),
  order_date: toISODateString(order?.order_date) || "",
  ETD: toISODateString(order?.ETD) || "",
});

const normalizeUniqueOptions = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));

const EditCompleteOrderModal = ({
  order,
  rowCount = 0,
  onClose,
  onSuccess,
}) => {
  const [form, setForm] = useState(() => createInitialForm(order));
  const [options, setOptions] = useState({ brands: [], vendors: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(createInitialForm(order));
    setError("");
  }, [order]);

  useEffect(() => {
    let cancelled = false;

    const fetchOptions = async () => {
      try {
        const response = await api.get("/orders/brands-and-vendors");
        if (cancelled) return;

        setOptions({
          brands: normalizeUniqueOptions(response?.data?.brands),
          vendors: normalizeUniqueOptions(response?.data?.vendors),
        });
      } catch (fetchError) {
        if (cancelled) return;
        setOptions({ brands: [], vendors: [] });
      }
    };

    fetchOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  const brandOptions = useMemo(
    () => normalizeUniqueOptions([...options.brands, form.brand]),
    [form.brand, options.brands],
  );
  const vendorOptions = useMemo(
    () => normalizeUniqueOptions([...options.vendors, form.vendor]),
    [form.vendor, options.vendors],
  );

  const validateForm = () => {
    if (!String(form.order_id || "").trim()) return "PO number is required.";
    if (!String(form.brand || "").trim()) return "Brand is required.";
    if (!String(form.vendor || "").trim()) return "Vendor is required.";
    if (!String(form.order_date || "").trim()) return "Order date is required.";
    if (!String(form.ETD || "").trim()) return "ETD is required.";
    return null;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!order?._id || saving) return;

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    const payload = {
      order_id: String(form.order_id || "").trim(),
      brand: String(form.brand || "").trim(),
      vendor: String(form.vendor || "").trim(),
      order_date: String(form.order_date || "").trim(),
      ETD: String(form.ETD || "").trim(),
    };

    const confirmMessage = [
      "Confirm complete order update:",
      `Current PO: ${order?.order_id || "N/A"}`,
      `Next PO: ${payload.order_id}`,
      `Brand: ${payload.brand}`,
      `Vendor: ${payload.vendor}`,
      `Order Date: ${formatDateDDMMYYYY(payload.order_date)}`,
      `ETD: ${formatDateDDMMYYYY(payload.ETD)}`,
      `Rows affected: ${Number(rowCount || 0) || 1}`,
    ].join("\n");

    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      setSaving(true);
      setError("");
      const response = await editCompleteOrder(order._id, payload);
      onSuccess?.(response);
    } catch (submitError) {
      setError(submitError?.response?.data?.message || "Failed to update complete order.");
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
              Update Complete Order | {order?.order_id || "N/A"}
            </h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
              disabled={saving}
            />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="modal-body d-grid gap-3">
              <div className="small text-secondary">
                This updates the general PO info for all active rows in this order.
              </div>
              <div className="small text-secondary">
                Current Order Date: {formatDateDDMMYYYY(order?.order_date)}
              </div>
              <div className="small text-secondary">
                Current ETD:{" "}
                <OrderEtdWithHistory
                  orderId={order?.order_id}
                  etd={order?.ETD}
                  className="ms-1"
                />
              </div>

              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label">PO Number</label>
                  <input
                    type="text"
                    className="form-control"
                    value={form.order_id}
                    onChange={(e) => setForm((prev) => ({ ...prev, order_id: e.target.value }))}
                    disabled={saving}
                  />
                </div>

                <div className="col-md-6">
                  <label className="form-label">Brand</label>
                  <select
                    className="form-select"
                    value={form.brand}
                    onChange={(e) => setForm((prev) => ({ ...prev, brand: e.target.value }))}
                    disabled={saving}
                  >
                    <option value="">Select Brand</option>
                    {brandOptions.map((brandValue) => (
                      <option key={brandValue} value={brandValue}>
                        {brandValue}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-md-6">
                  <label className="form-label">Vendor</label>
                  <select
                    className="form-select"
                    value={form.vendor}
                    onChange={(e) => setForm((prev) => ({ ...prev, vendor: e.target.value }))}
                    disabled={saving}
                  >
                    <option value="">Select Vendor</option>
                    {vendorOptions.map((vendorValue) => (
                      <option key={vendorValue} value={vendorValue}>
                        {vendorValue}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-md-6">
                  <label className="form-label">Order Date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={form.order_date}
                    onChange={(e) => setForm((prev) => ({ ...prev, order_date: e.target.value }))}
                    disabled={saving}
                  />
                </div>

                <div className="col-md-6">
                  <label className="form-label">ETD</label>
                  <input
                    type="date"
                    className="form-control"
                    value={form.ETD}
                    onChange={(e) => setForm((prev) => ({ ...prev, ETD: e.target.value }))}
                    disabled={saving}
                  />
                </div>
              </div>

              {error && <div className="alert alert-danger mb-0">{error}</div>}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving..." : "Save Complete Order"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EditCompleteOrderModal;
