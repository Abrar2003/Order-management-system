import { useState } from "react";
import { COMPLAINT_STATUS_OPTIONS } from "./complaintConstants";

const ChangeStatusModal = ({ complaint, onClose, onSubmit, saving = false }) => {
  const [status, setStatus] = useState(complaint?.status || "open");
  const [comment, setComment] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit({ status, comment: comment.trim() });
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <form onSubmit={handleSubmit}>
            <div className="modal-header">
              <h5 className="modal-title">Change Status</h5>
              <button type="button" className="btn-close" onClick={onClose} disabled={saving} />
            </div>
            <div className="modal-body">
              <div className="small text-secondary mb-2">
                {complaint?.complaint_no || complaint?.item_code || "Complaint"}
              </div>
              <label className="form-label">Status</label>
              <select className="form-select mb-3" value={status} onChange={(event) => setStatus(event.target.value)}>
                {COMPLAINT_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <label className="form-label">Comment</label>
              <textarea
                className="form-control"
                rows="3"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Optional status note"
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Updating..." : "Update Status"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChangeStatusModal;
