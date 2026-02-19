import { useMemo, useState } from "react";
import { editOrder } from "../services/orders.service";
import "../App.css";

const toDateInputValue = (value) => {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const makeInitialShipmentRows = (shipment = []) =>
  (Array.isArray(shipment) ? shipment : []).map((entry) => ({
    container: String(entry?.container ?? ""),
    stuffing_date: toDateInputValue(entry?.stuffing_date),
    quantity: String(entry?.quantity ?? ""),
    remaining_remarks: String(entry?.remaining_remarks ?? ""),
  }));

const createEmptyShipmentRow = () => ({
  container: "",
  stuffing_date: toDateInputValue(new Date()),
  quantity: "",
  remaining_remarks: "",
});

const EditOrderModal = ({ order, onClose, onSuccess }) => {
  const [form, setForm] = useState({
    brand: String(order?.brand ?? ""),
    vendor: String(order?.vendor ?? ""),
    quantity: String(order?.quantity ?? ""),
    item_code: String(order?.item?.item_code ?? ""),
    description: String(order?.item?.description ?? ""),
    shipment: makeInitialShipmentRows(order?.shipment),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const orderQuantity = Number(form.quantity);
  const totalShipped = useMemo(
    () =>
      (form.shipment || []).reduce((sum, entry) => {
        const quantity = Number(entry?.quantity);
        return sum + (Number.isFinite(quantity) ? Math.max(0, quantity) : 0);
      }, 0),
    [form.shipment],
  );
  const remainingQuantity = Number.isFinite(orderQuantity)
    ? Math.max(0, orderQuantity - totalShipped)
    : 0;

  const updateShipmentRow = (index, field, value) => {
    setForm((prev) => {
      const shipment = [...prev.shipment];
      shipment[index] = {
        ...shipment[index],
        [field]: value,
      };
      return { ...prev, shipment };
    });
  };

  const removeShipmentRow = (index) => {
    setForm((prev) => ({
      ...prev,
      shipment: prev.shipment.filter((_, i) => i !== index),
    }));
  };

  const addShipmentRow = () => {
    setForm((prev) => ({
      ...prev,
      shipment: [...prev.shipment, createEmptyShipmentRow()],
    }));
  };

  const validateForm = () => {
    const brand = String(form.brand || "").trim();
    const vendor = String(form.vendor || "").trim();
    const itemCode = String(form.item_code || "").trim();
    const quantity = Number(form.quantity);

    if (!brand) return "brand is required";
    if (!vendor) return "vendor is required";
    if (!itemCode) return "item_code is required";
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return "quantity must be a valid positive number";
    }

    let cumulative = 0;
    for (let i = 0; i < form.shipment.length; i += 1) {
      const row = form.shipment[i] || {};
      const container = String(row.container || "").trim();
      const stuffingDate = toDateInputValue(row.stuffing_date);
      const shipmentQty = Number(row.quantity);

      if (!container) return `shipment row ${i + 1}: container is required`;
      if (!stuffingDate) return `shipment row ${i + 1}: stuffing date is invalid`;
      if (!Number.isFinite(shipmentQty) || shipmentQty <= 0) {
        return `shipment row ${i + 1}: quantity must be a positive number`;
      }

      cumulative += shipmentQty;
      if (cumulative > quantity) {
        return "total shipment quantity cannot exceed order quantity";
      }
    }

    return null;
  };

  const handleSubmit = async () => {
    setError("");
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    const payload = {
      brand: String(form.brand || "").trim(),
      vendor: String(form.vendor || "").trim(),
      quantity: Number(form.quantity),
      item_code: String(form.item_code || "").trim(),
      description: String(form.description ?? "").trim(),
      shipment: form.shipment.map((entry) => ({
        container: String(entry?.container || "").trim(),
        stuffing_date: toDateInputValue(entry?.stuffing_date),
        quantity: Number(entry?.quantity),
        remaining_remarks: String(entry?.remaining_remarks ?? "").trim(),
      })),
    };

    try {
      setSaving(true);
      const response = await editOrder(order?._id, payload);
      onSuccess?.(response);
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to update order.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              Edit Order | {order?.order_id || "N/A"} | {order?.item?.item_code || "N/A"}
            </h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="row g-2">
              <div className="col-md-6">
                <label className="form-label">Brand</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.brand}
                  onChange={(e) => setForm((prev) => ({ ...prev, brand: e.target.value }))}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Vendor</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.vendor}
                  onChange={(e) => setForm((prev) => ({ ...prev, vendor: e.target.value }))}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label">Quantity</label>
                <input
                  type="number"
                  className="form-control"
                  min="1"
                  value={form.quantity}
                  onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label">Item Code</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.item_code}
                  onChange={(e) => setForm((prev) => ({ ...prev, item_code: e.target.value }))}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label">Description</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>
            </div>

            <div className="d-flex justify-content-between align-items-center">
              <h6 className="mb-0">Shipment Rows</h6>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={addShipmentRow}>
                Add Row
              </button>
            </div>

            <div className="table-responsive">
              <table className="table table-sm table-striped align-middle mb-0">
                <thead>
                  <tr>
                    <th style={{ width: "18%" }}>Container</th>
                    <th style={{ width: "18%" }}>Stuffing Date</th>
                    <th style={{ width: "14%" }}>Quantity</th>
                    <th style={{ width: "40%" }}>Remarks</th>
                    <th style={{ width: "10%" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {form.shipment.length === 0 && (
                    <tr>
                      <td colSpan="5" className="text-center text-secondary py-3">
                        No shipment rows
                      </td>
                    </tr>
                  )}
                  {form.shipment.map((entry, index) => (
                    <tr key={`shipment-row-${index}`}>
                      <td>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={entry.container}
                          onChange={(e) =>
                            updateShipmentRow(index, "container", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          className="form-control form-control-sm"
                          value={entry.stuffing_date}
                          onChange={(e) =>
                            updateShipmentRow(index, "stuffing_date", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          className="form-control form-control-sm"
                          value={entry.quantity}
                          onChange={(e) =>
                            updateShipmentRow(index, "quantity", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={entry.remaining_remarks}
                          onChange={(e) =>
                            updateShipmentRow(index, "remaining_remarks", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => removeShipmentRow(index)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="d-flex flex-wrap gap-2">
              <span className="om-summary-chip">Total shipped: {totalShipped}</span>
              <span className="om-summary-chip">Remaining: {remainingQuantity}</span>
            </div>

            {error && <div className="alert alert-danger mb-0">{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditOrderModal;
