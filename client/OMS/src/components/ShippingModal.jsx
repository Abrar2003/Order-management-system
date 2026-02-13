import { useMemo, useState } from "react";
import axios from "../api/axios";
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

const ShippingModal = ({ order, onClose, onSuccess }) => {
  const [stuffingDate, setStuffingDate] = useState(toDateInputValue(new Date()));
  const [containerNumber, setContainerNumber] = useState("");
  const [shipmentQuantity, setShipmentQuantity] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const shippedAlready = useMemo(
    () =>
      (order?.shipment || []).reduce(
        (sum, entry) => sum + Number(entry?.quantity || 0),
        0
      ),
    [order?.shipment]
  );

  const orderQuantity = Number(order?.quantity || 0);
  const remainingQuantity = Math.max(0, orderQuantity - shippedAlready);

  const handleSubmit = async () => {
    setError("");

    if (!stuffingDate || containerNumber === "" || shipmentQuantity === "") {
      setError("Stuffing date, container number and quantity are required.");
      return;
    }

    const parsedContainer = containerNumber.trim();
    const parsedQuantity = Number(shipmentQuantity);

    if (!parsedContainer) {
      setError("Container number must be a non-empty value.");
      return;
    }

    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError("Quantity must be a valid positive number.");
      return;
    }

    if (parsedQuantity > remainingQuantity) {
      setError("Stuffed quantity cannot exceed remaining quantity.");
      return;
    }

    try {
      setSaving(true);
      await axios.patch(`/orders/finalize-order/${order._id}`, {
        stuffing_date: stuffingDate,
        container: parsedContainer,
        quantity: parsedQuantity,
        remarks
      });

      onSuccess?.();
      onClose?.();
    } catch (err) {
      setError(
        err?.response?.data?.message || "Failed to finalize shipping update."
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
            <h5 className="modal-title">Finalize Shipment</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="row g-2">
              <div className="col-sm-6">
                <div className="small text-secondary">Order ID</div>
                <div className="fw-semibold">{order?.order_id || "N/A"}</div>
              </div>
              <div className="col-sm-6">
                <div className="small text-secondary">Item</div>
                <div className="fw-semibold">{order?.item?.item_code || "N/A"}</div>
              </div>
              <div className="col-12">
                <div className="small text-secondary">Description</div>
                <div className="fw-semibold">{order?.item?.description || "N/A"}</div>
              </div>
              <div className="col-sm-4">
                <div className="small text-secondary">Order Quantity</div>
                <div className="fw-semibold">{orderQuantity}</div>
              </div>
              <div className="col-sm-4">
                <div className="small text-secondary">Already Shipped</div>
                <div className="fw-semibold">{shippedAlready}</div>
              </div>
              <div className="col-sm-4">
                <div className="small text-secondary">Remaining</div>
                <div className="fw-semibold">{remainingQuantity}</div>
              </div>
            </div>

            <div>
              <label className="form-label">Container Number</label>
              <input
                type="text"
                className="form-control"
                value={containerNumber}
                onChange={(e) => setContainerNumber(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label">Stuffing Date</label>
              <input
                type="date"
                className="form-control"
                value={stuffingDate}
                onChange={(e) => setStuffingDate(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label">Quantity</label>
              <input
                type="number"
                className="form-control"
                value={shipmentQuantity}
                onChange={(e) => setShipmentQuantity(e.target.value)}
                min="1"
              />
            </div>

            <div>
              <label className="form-label">Remarks</label>
              <input
                type="text"
                className="form-control"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>

            {error && <div className="alert alert-danger mb-0">{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? "Saving..." : "Finalize"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShippingModal;
