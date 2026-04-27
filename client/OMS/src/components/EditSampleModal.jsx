import { useMemo, useState } from "react";
import api from "../api/axios";
import {
  formatDateDDMMYYYY,
  getTodayDDMMYYYY,
  isValidDDMMYYYY,
  toDDMMYYYYInputValue,
  toISODateString,
} from "../utils/date";
import { useShippingInspectors } from "../hooks/useShippingInspectors";
import {
  SHIPPED_BY_VENDOR_OPTION,
} from "../hooks/useShippingInspectors";
import "../App.css";

const normalizeShipmentDraftInvoiceNumber = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized && normalized !== "N/A" ? normalized : "";
};

const normalizeStuffedById = (entry = {}) => {
  const id = String(entry?.stuffed_by?.id ?? "").trim();
  const name = String(entry?.stuffed_by?.name ?? "").trim();
  if (name.toLowerCase() === SHIPPED_BY_VENDOR_OPTION.name.toLowerCase()) {
    return SHIPPED_BY_VENDOR_OPTION.id;
  }
  return id;
};

const makeInitialShipmentRows = (shipment = []) =>
  (Array.isArray(shipment) ? shipment : []).map((entry) => ({
    container: String(entry?.container ?? ""),
    invoice_number: normalizeShipmentDraftInvoiceNumber(entry?.invoice_number),
    stuffing_date: toDDMMYYYYInputValue(entry?.stuffing_date, ""),
    quantity: String(entry?.quantity ?? ""),
    remaining_remarks: String(entry?.remaining_remarks ?? ""),
    stuffed_by_id: normalizeStuffedById(entry),
    stuffed_by_name: String(entry?.stuffed_by?.name ?? ""),
  }));

const createEmptyShipmentRow = () => ({
  container: "",
  invoice_number: "",
  stuffing_date: getTodayDDMMYYYY(),
  quantity: "",
  remaining_remarks: "",
  stuffed_by_id: "",
  stuffed_by_name: "",
});

const EditSampleModal = ({ sample, onClose, onSuccess }) => {
  const [form, setForm] = useState({
    code: String(sample?.code ?? ""),
    name: String(sample?.name ?? ""),
    description: String(sample?.description ?? ""),
    brand: String(sample?.brand ?? ""),
    vendor: Array.isArray(sample?.vendor)
      ? sample.vendor.join(", ")
      : String(sample?.vendor ?? ""),
    shipment: makeInitialShipmentRows(sample?.shipment),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const {
    inspectors,
    inspectorById,
    loadingInspectors,
    inspectorError,
  } = useShippingInspectors();

  const shipmentInspectorOptions = useMemo(() => {
    const optionMap = new Map(inspectors.map((entry) => [entry.id, entry]));

    (form.shipment || []).forEach((entry) => {
      const inspectorId = String(entry?.stuffed_by_id || "").trim();
      const inspectorName = String(entry?.stuffed_by_name || "").trim();
      if (!inspectorId || optionMap.has(inspectorId)) return;
      optionMap.set(inspectorId, {
        id: inspectorId,
        name: inspectorName || inspectorId,
      });
    });

    return Array.from(optionMap.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [form.shipment, inspectors]);

  const updateShipmentRow = (index, field, value) => {
    setForm((prev) => {
      const shipment = [...prev.shipment];
      const nextEntry = {
        ...shipment[index],
        [field]: value,
      };

      if (field === "stuffed_by_id") {
        nextEntry.stuffed_by_name =
          inspectorById.get(String(value || "").trim())?.name || "";
      }

      shipment[index] = nextEntry;
      return { ...prev, shipment };
    });
  };

  const removeShipmentRow = (index) => {
    setForm((prev) => ({
      ...prev,
      shipment: prev.shipment.filter((_, rowIndex) => rowIndex !== index),
    }));
  };

  const addShipmentRow = () => {
    setForm((prev) => ({
      ...prev,
      shipment: [...prev.shipment, createEmptyShipmentRow()],
    }));
  };

  const validateForm = () => {
    const code = String(form.code || "").trim();
    if (!code) return "code is required";

    for (let i = 0; i < form.shipment.length; i += 1) {
      const row = form.shipment[i] || {};
      const container = String(row.container || "").trim();
      const stuffingDate = String(row.stuffing_date || "").trim();
      const stuffingDateIso = toISODateString(stuffingDate);
      const shipmentQty = Number(row.quantity);
      const stuffedById = String(row.stuffed_by_id || "").trim();

      if (!container) return `shipment row ${i + 1}: container is required`;
      if (!stuffingDateIso || !isValidDDMMYYYY(stuffingDate)) {
        return `shipment row ${i + 1}: stuffing date must be in DD/MM/YYYY format`;
      }
      if (!stuffedById) {
        return `shipment row ${i + 1}: stuffed by is required`;
      }
      if (!Number.isFinite(shipmentQty) || shipmentQty <= 0) {
        return `shipment row ${i + 1}: quantity must be a positive number`;
      }
    }

    return null;
  };

  const buildConfirmationMessage = (payload) => {
    const lines = [
      "Confirm these sample changes:",
      `Code: ${payload.code}`,
      `Name: ${payload.name || "N/A"}`,
      `Brand: ${payload.brand || "N/A"}`,
      `Vendor: ${payload.vendor || "N/A"}`,
      "Shipment Rows:",
    ];

    if (payload.shipment.length === 0) {
      lines.push("0) None");
    } else {
      payload.shipment.forEach((entry, idx) => {
        lines.push(
          `${idx + 1}) ${entry.container} | invoice ${entry.invoice_number || "N/A"} | stuffed by ${entry.stuffed_by.name || "-"} | ${formatDateDDMMYYYY(entry.stuffing_date, "-")} | qty ${entry.quantity} | remarks ${entry.remaining_remarks || "-"}`,
        );
      });
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
      code: String(form.code || "").trim(),
      name: String(form.name || "").trim(),
      description: String(form.description || "").trim(),
      brand: String(form.brand || "").trim(),
      vendor: String(form.vendor || "").trim(),
      shipment: form.shipment.map((entry) => ({
        stuffed_by: {
          id: String(entry?.stuffed_by_id || "").trim(),
          name:
            inspectorById.get(String(entry?.stuffed_by_id || "").trim())?.name
            || String(entry?.stuffed_by_name || "").trim(),
        },
        container: String(entry?.container || "").trim(),
        invoice_number: String(entry?.invoice_number || "").trim(),
        stuffing_date: toISODateString(entry?.stuffing_date),
        quantity: Number(entry?.quantity),
        remaining_remarks: String(entry?.remaining_remarks ?? "").trim(),
      })),
    };

    if (!window.confirm(buildConfirmationMessage(payload))) {
      return;
    }

    try {
      setSaving(true);
      const response = await api.patch(
        `/samples/${encodeURIComponent(String(sample?._id || "").trim())}`,
        payload,
      );
      onSuccess?.(response?.data);
      onClose?.();
    } catch (submitError) {
      setError(submitError?.response?.data?.message || "Failed to update sample.");
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
              Edit Sample | {sample?.code || "N/A"}
            </h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="row g-2">
              <div className="col-md-6">
                <label className="form-label">Sample Code</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.code}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))
                  }
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Sample Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Brand</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.brand}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, brand: event.target.value }))
                  }
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Vendor</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.vendor}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, vendor: event.target.value }))
                  }
                />
              </div>
              <div className="col-12">
                <label className="form-label">Description</label>
                <textarea
                  className="form-control"
                  rows="2"
                  value={form.description}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, description: event.target.value }))
                  }
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
                    <th style={{ width: "16%" }}>Shipped By</th>
                    <th style={{ width: "16%" }}>Container</th>
                    <th style={{ width: "16%" }}>Invoice Number</th>
                    <th style={{ width: "14%" }}>Stuffing Date</th>
                    <th style={{ width: "10%" }}>Quantity</th>
                    <th style={{ width: "20%" }}>Remarks</th>
                    <th style={{ width: "8%" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {form.shipment.length === 0 && (
                    <tr>
                      <td colSpan="7" className="text-center text-secondary py-3">
                        No shipment rows
                      </td>
                    </tr>
                  )}
                  {form.shipment.map((entry, index) => (
                    <tr key={`sample-shipment-row-${index}`}>
                      <td>
                        <select
                          className="form-select form-select-sm"
                          value={entry.stuffed_by_id}
                          disabled={loadingInspectors}
                          onChange={(event) =>
                            updateShipmentRow(index, "stuffed_by_id", event.target.value)
                          }
                        >
                          <option value="">
                            {loadingInspectors ? "Loading inspectors..." : "Select shipped by"}
                          </option>
                          {shipmentInspectorOptions.map((inspector) => (
                            <option key={inspector.id} value={inspector.id}>
                              {inspector.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={entry.container}
                          onChange={(event) =>
                            updateShipmentRow(index, "container", event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={entry.invoice_number}
                          onChange={(event) =>
                            updateShipmentRow(index, "invoice_number", event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          className="form-control form-control-sm"
                          value={toISODateString(entry.stuffing_date)}
                          onChange={(event) =>
                            updateShipmentRow(
                              index,
                              "stuffing_date",
                              toDDMMYYYYInputValue(event.target.value, ""),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          className="form-control form-control-sm"
                          value={entry.quantity}
                          onChange={(event) =>
                            updateShipmentRow(index, "quantity", event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={entry.remaining_remarks}
                          onChange={(event) =>
                            updateShipmentRow(index, "remaining_remarks", event.target.value)
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

            {inspectorError && <div className="alert alert-warning mb-0">{inspectorError}</div>}
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

export default EditSampleModal;
