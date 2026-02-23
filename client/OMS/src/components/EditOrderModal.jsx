import { useMemo, useState } from "react";
import { editOrder } from "../services/orders.service";
import { getUserFromToken } from "../auth/auth.utils";
import {
  formatDateDDMMYYYY,
  getTodayDDMMYYYY,
  isValidDDMMYYYY,
  toDDMMYYYYInputValue,
  toISODateString,
} from "../utils/date";
import "../App.css";

const makeInitialShipmentRows = (shipment = []) =>
  (Array.isArray(shipment) ? shipment : []).map((entry) => ({
    container: String(entry?.container ?? ""),
    stuffing_date: toDDMMYYYYInputValue(entry?.stuffing_date, ""),
    quantity: String(entry?.quantity ?? ""),
    remaining_remarks: String(entry?.remaining_remarks ?? ""),
  }));

const createEmptyShipmentRow = () => ({
  container: "",
  stuffing_date: getTodayDDMMYYYY(),
  quantity: "",
  remaining_remarks: "",
});

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildAdjustedShipmentPreview = (shipmentRows, targetQuantity) => {
  const normalizedTarget = Number(targetQuantity);
  if (!Number.isFinite(normalizedTarget) || normalizedTarget <= 0) return [];

  let cumulative = 0;
  const adjustedRows = [];

  for (const row of Array.isArray(shipmentRows) ? shipmentRows : []) {
    if (cumulative >= normalizedTarget) break;

    const rawQty = Number(row?.quantity);
    if (!Number.isFinite(rawQty) || rawQty <= 0) continue;

    const remaining = Math.max(0, normalizedTarget - cumulative);
    const adjustedQty = Math.min(rawQty, remaining);
    if (adjustedQty <= 0) continue;

    cumulative += adjustedQty;
    adjustedRows.push({
      container: String(row?.container || "").trim(),
      stuffing_date: toDDMMYYYYInputValue(row?.stuffing_date, ""),
      quantity: adjustedQty,
      pending: Math.max(0, normalizedTarget - cumulative),
      remaining_remarks: String(row?.remaining_remarks || "").trim(),
    });
  }

  return adjustedRows;
};

const EditOrderModal = ({ order, onClose, onSuccess }) => {
  const user = getUserFromToken();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";

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

  const targetQuantity = Number(form.quantity);
  const inputTotalShipped = useMemo(
    () =>
      (form.shipment || []).reduce((sum, entry) => {
        const quantity = Number(entry?.quantity);
        return sum + (Number.isFinite(quantity) ? Math.max(0, quantity) : 0);
      }, 0),
    [form.shipment],
  );

  const adjustedShipmentPreview = useMemo(
    () => buildAdjustedShipmentPreview(form.shipment, targetQuantity),
    [form.shipment, targetQuantity],
  );
  const adjustedShippedTotal = useMemo(
    () =>
      adjustedShipmentPreview.reduce(
        (sum, entry) => sum + toSafeNumber(entry?.quantity),
        0,
      ),
    [adjustedShipmentPreview],
  );
  const adjustedRemaining = Number.isFinite(targetQuantity)
    ? Math.max(0, targetQuantity - adjustedShippedTotal)
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
    if (!isAdmin) return;
    setForm((prev) => ({
      ...prev,
      shipment: prev.shipment.filter((_, i) => i !== index),
    }));
  };

  const addShipmentRow = () => {
    if (!isAdmin) return;
    setForm((prev) => ({
      ...prev,
      shipment: [...prev.shipment, createEmptyShipmentRow()],
    }));
  };

  const validateForm = () => {
    const brand = String(form.brand || "").trim();
    const vendor = String(form.vendor || "").trim();
    const itemCode = String(form.item_code || "").trim();

    if (!brand) return "brand is required";
    if (!vendor) return "vendor is required";
    if (!itemCode) return "item_code is required";

    if (isAdmin) {
      const quantity = Number(form.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return "quantity must be a valid positive number";
      }

      for (let i = 0; i < form.shipment.length; i += 1) {
        const row = form.shipment[i] || {};
        const container = String(row.container || "").trim();
        const stuffingDate = String(row.stuffing_date || "").trim();
        const stuffingDateIso = toISODateString(stuffingDate);
        const shipmentQty = Number(row.quantity);

        if (!container) return `shipment row ${i + 1}: container is required`;
        if (!stuffingDateIso || !isValidDDMMYYYY(stuffingDate)) {
          return `shipment row ${i + 1}: stuffing date must be in DD/MM/YYYY format`;
        }
        if (!Number.isFinite(shipmentQty) || shipmentQty <= 0) {
          return `shipment row ${i + 1}: quantity must be a positive number`;
        }
      }
    }

    return null;
  };

  const buildConfirmationMessage = (payload) => {
    const lines = [
      "Confirm these changes:",
      `Order ID: ${order?.order_id || "N/A"}`,
      `Item Code: ${payload.item_code}`,
      `Description: ${payload.description || "N/A"}`,
      `Brand: ${payload.brand}`,
      `Vendor: ${payload.vendor}`,
    ];

    if (isAdmin) {
      lines.push(
        `Order Quantity: ${toSafeNumber(order?.quantity)} -> ${payload.quantity}`,
      );
      lines.push(`Input Shipment Total: ${inputTotalShipped}`);
      lines.push(`Adjusted Shipment Total: ${adjustedShippedTotal}`);
      lines.push(`Adjusted Remaining: ${adjustedRemaining}`);
      lines.push("Adjusted Shipment Rows:");

      if (adjustedShipmentPreview.length === 0) {
        lines.push("0) None");
      } else {
        adjustedShipmentPreview.forEach((entry, idx) => {
          lines.push(
            `${idx + 1}) ${entry.container} | ${formatDateDDMMYYYY(entry.stuffing_date, "-")} | qty ${entry.quantity} | pending ${entry.pending} | remarks ${entry.remaining_remarks || "-"}`,
          );
        });
      }
    }

    return lines.join("\n");
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
      item_code: String(form.item_code || "").trim(),
      description: String(form.description ?? "").trim(),
    };

    if (isAdmin) {
      payload.quantity = Number(form.quantity);
      payload.shipment = form.shipment.map((entry) => ({
        container: String(entry?.container || "").trim(),
        stuffing_date: toISODateString(entry?.stuffing_date),
        quantity: Number(entry?.quantity),
        remaining_remarks: String(entry?.remaining_remarks ?? "").trim(),
      }));
    }

    const confirmMessage = buildConfirmationMessage(payload);
    if (!window.confirm(confirmMessage)) {
      return;
    }

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
                  disabled={!isAdmin}
                  onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))}
                />
                {!isAdmin && (
                  <div className="small text-secondary mt-1">
                    Only admin can edit quantity or shipping details.
                  </div>
                )}
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
              {isAdmin && (
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={addShipmentRow}>
                  Add Row
                </button>
              )}
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
                          disabled={!isAdmin}
                          onChange={(e) =>
                            updateShipmentRow(index, "container", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={entry.stuffing_date}
                          disabled={!isAdmin}
                          onChange={(e) =>
                            updateShipmentRow(index, "stuffing_date", e.target.value)
                          }
                          placeholder="DD/MM/YYYY"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          className="form-control form-control-sm"
                          value={entry.quantity}
                          disabled={!isAdmin}
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
                          disabled={!isAdmin}
                          onChange={(e) =>
                            updateShipmentRow(index, "remaining_remarks", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        {isAdmin ? (
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm"
                            onClick={() => removeShipmentRow(index)}
                          >
                            Remove
                          </button>
                        ) : (
                          <span className="text-secondary small">N/A</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="d-flex flex-wrap gap-2">
              <span className="om-summary-chip">Input shipped: {inputTotalShipped}</span>
              {isAdmin && (
                <>
                  <span className="om-summary-chip">
                    Adjusted shipped: {adjustedShippedTotal}
                  </span>
                  <span className="om-summary-chip">
                    Adjusted remaining: {adjustedRemaining}
                  </span>
                </>
              )}
            </div>

            {isAdmin && (
              <div className="small text-secondary">
                Any positive quantity is allowed. On save, shipment rows and QC
                quantities are auto-adjusted to match the final quantity.
              </div>
            )}

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
