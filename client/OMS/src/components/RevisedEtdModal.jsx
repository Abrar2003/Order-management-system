import { useEffect, useState } from "react";
import { editOrder } from "../services/orders.service";
import OrderEtdWithHistory from "./OrderEtdWithHistory";
import { formatDateDDMMYYYY, toISODateString } from "../utils/date";
import "../App.css";

const RevisedEtdModal = ({ order, onClose, onSuccess }) => {
  const [revisedDate, setRevisedDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    setRevisedDate(toISODateString(order?.revised_ETD) || "");
  }, [order?._id, order?.revised_ETD]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!order?._id || saving) return;

    try {
      setSaving(true);
      setError("");
      await editOrder(order._id, {
        revised_ETD: String(revisedDate || "").trim(),
      });
      onSuccess?.();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to update revised ETD.");
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
              Revised ETD | {order?.order_id || "N/A"} | {order?.item?.item_code || "N/A"}
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
                Current ETD:{" "}
                <OrderEtdWithHistory
                  orderId={order?.order_id}
                  itemCode={order?.item?.item_code}
                  etd={order?.ETD}
                  revisedEtd={order?.revised_ETD}
                  className="ms-1"
                />
              </div>
              <div className="small text-secondary">
                Current Revised ETD: {formatDateDDMMYYYY(order?.revised_ETD)}
              </div>

              <div>
                <label htmlFor="revised-etd-input" className="form-label">
                  Revised ETD
                </label>
                <input
                  id="revised-etd-input"
                  type="date"
                  className="form-control"
                  value={revisedDate}
                  onChange={(e) => setRevisedDate(e.target.value)}
                  disabled={saving}
                />
                <div className="form-text">
                  Leave empty and save to clear revised ETD.
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
                {saving ? "Saving..." : "Save Revised ETD"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default RevisedEtdModal;
