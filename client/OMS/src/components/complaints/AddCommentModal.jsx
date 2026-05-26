import { useState } from "react";

const AddCommentModal = ({ complaint, onClose, onSubmit, saving = false }) => {
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    setError("");
    if (!comment.trim()) {
      setError("Comment is required.");
      return;
    }
    onSubmit({ comment: comment.trim() });
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <form onSubmit={handleSubmit}>
            <div className="modal-header">
              <h5 className="modal-title">Add Comment</h5>
              <button type="button" className="btn-close" onClick={onClose} disabled={saving} />
            </div>
            <div className="modal-body">
              <div className="small text-secondary mb-2">
                {complaint?.complaint_no || complaint?.item_code || "Complaint"}
              </div>
              {error && <div className="alert alert-danger py-2">{error}</div>}
              <textarea
                className="form-control"
                rows="4"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Write comment"
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving..." : "Add Comment"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddCommentModal;
