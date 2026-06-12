import { useMemo, useState } from "react";
import { COMPLAINT_FILE_ACCEPT } from "./complaintConstants";

const UploadComplaintFilesModal = ({ complaint, onClose, onSubmit, saving = false }) => {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState("");
  const fileNames = useMemo(() => files.map((file) => file.name), [files]);

  const handleSubmit = (event) => {
    event.preventDefault();
    setError("");
    if (files.length === 0) {
      setError("Select at least one file.");
      return;
    }
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    onSubmit(formData);
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <form onSubmit={handleSubmit}>
            <div className="modal-header">
              <h5 className="modal-title">Upload Files</h5>
              <button type="button" className="btn-close" onClick={onClose} disabled={saving} />
            </div>
            <div className="modal-body">
              <div className="small text-secondary mb-2">
                {complaint?.complaint_no || complaint?.item_code || "Complain"}
              </div>
              {error && <div className="alert alert-danger py-2">{error}</div>}
              <input
                type="file"
                className="form-control"
                accept={COMPLAINT_FILE_ACCEPT}
                multiple
                onChange={(event) => setFiles(Array.from(event.target.files || []))}
              />
              {fileNames.length > 0 && (
                <div className="small text-secondary mt-2">
                  Selected: {fileNames.join(", ")}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Uploading..." : "Upload Files"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default UploadComplaintFilesModal;
