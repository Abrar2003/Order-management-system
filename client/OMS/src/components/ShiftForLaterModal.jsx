import { useState } from "react";
import api from "../api/axios";

const ShiftForLaterModal = ({ qc, request, onClose, onSuccess }) => {
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    const normalizedRemark = remark.trim();
    if (!normalizedRemark) {
      setError("Remark is required.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      const response = await api.patch(`/qc/${qc?._id}/shift-for-later`, {
        request_history_id: request?._id,
        remark: normalizedRemark,
      });
      alert(response?.data?.message || "QC request shifted for later.");
      onSuccess?.();
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        "Failed to shift the QC request for later.";
      setError(message);
      alert(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Shift for Later</h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
              disabled={saving}
            />
          </div>
          <div className="modal-body d-grid gap-3">
            <div>
              <div className="small text-secondary">Order / Item</div>
              <div className="fw-semibold">
                {qc?.order?.order_id || "N/A"} / {qc?.item?.item_code || "N/A"}
              </div>
            </div>
            <div>
              <label className="form-label" htmlFor="shift-for-later-remark">
                Remark
              </label>
              <textarea
                id="shift-for-later-remark"
                className="form-control"
                rows="4"
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
                placeholder="Why is this inspection being shifted?"
                disabled={saving}
                autoFocus
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
              className="btn btn-outline-warning"
              onClick={handleSubmit}
              disabled={saving}
            >
              {saving ? "Saving..." : "Shift for Later"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShiftForLaterModal;
