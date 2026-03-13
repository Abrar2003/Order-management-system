import { useState } from "react";
import api from "../api/axios";

const GoodsNotReadyModal = ({ qc, onClose, onSuccess }) => {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const trimmedReason = String(reason || "").trim();
    if (!trimmedReason) {
      setError("Reason is required.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      await api.patch(`/qc/goods-not-ready/${qc?._id}`, {
        reason: trimmedReason,
      });
      onSuccess?.();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to mark goods as not ready.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Goods Not Ready</h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
              disabled={saving}
            />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="row g-2">
              <div className="col-sm-6">
                <div className="small text-secondary">Order ID</div>
                <div className="fw-semibold">{qc?.order?.order_id || "N/A"}</div>
              </div>
              <div className="col-sm-6">
                <div className="small text-secondary">Item Code</div>
                <div className="fw-semibold">{qc?.item?.item_code || "N/A"}</div>
              </div>
            </div>

            <div>
              <label className="form-label">Reason</label>
              <textarea
                className="form-control"
                rows="4"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Enter the reason goods are not ready"
                disabled={saving}
              />
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
            <button
              type="button"
              className="btn btn-outline-danger"
              onClick={handleSubmit}
              disabled={saving}
            >
              {saving ? "Saving..." : "Mark Goods Not Ready"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GoodsNotReadyModal;
