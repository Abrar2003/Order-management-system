import { useEffect, useState } from "react";
import "../App.css";

const ArchiveOrderModal = ({
  order,
  onClose,
  onConfirm,
  saving = false,
  error = "",
}) => {
  const [remark, setRemark] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setRemark("");
    setLocalError("");
  }, [order?._id]);

  const handleConfirm = () => {
    const trimmedRemark = String(remark || "").trim();
    if (!trimmedRemark) {
      setLocalError("Archive remark is required.");
      return;
    }
    setLocalError("");
    onConfirm?.(trimmedRemark);
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              Archive Order | {order?.order_id || "N/A"} | {order?.item?.item_code || "N/A"}
            </h5>
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
              This will remove the order from active lists and move it to archived
              orders. This action requires a remark.
            </div>

            <div>
              <label htmlFor="archive-order-remark" className="form-label">
                Archive Remark
              </label>
              <textarea
                id="archive-order-remark"
                className="form-control"
                rows={4}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                disabled={saving}
                placeholder="Enter reason for deletion/archive"
              />
            </div>

            {(localError || error) && (
              <div className="alert alert-danger mb-0">
                {localError || error}
              </div>
            )}
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
              className="btn btn-danger"
              onClick={handleConfirm}
              disabled={saving}
            >
              {saving ? "Archiving..." : "Archive Order"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArchiveOrderModal;
