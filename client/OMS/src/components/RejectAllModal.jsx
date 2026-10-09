import { useState } from "react";
import api from "../api/axios";
import useBulkQcImageUpload from "../hooks/useBulkQcImageUpload";
import { createQcImageUploadIntent } from "../services/qcImages.service";
import { resolveLatestRequestEntry } from "../utils/qcRequests";

const RejectAllModal = ({ qc, onClose, onSuccess }) => {
  const [reason, setReason] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { state: uploadState, startUpload, reset: resetUpload } = useBulkQcImageUpload({
    qcId: qc?._id,
    maxFiles: 1,
  });

  const handleSubmit = async () => {
    const trimmedReason = String(reason || "").trim();
    if (!trimmedReason) {
      setError("Reason is required.");
      return;
    }

    if (!imageFile) {
      setError("One rejection image is required.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      const intentResponse = await createQcImageUploadIntent({
        qcId: qc?._id,
        operation: "reject_all",
        imageType: "rejected_images",
        requestHistoryId: resolveLatestRequestEntry(qc?.request_history)?._id,
        comment: trimmedReason,
      });
      const uploadIntentId = intentResponse?.data?.data?.intent_id;
      resetUpload();
      const uploadResult = await startUpload({
        uploadMode: "single",
        imageType: "rejected_images",
        uploadIntentId,
        comment: trimmedReason,
        files: [imageFile],
      });
      if (Number(uploadResult?.failedCount || 0) > 0 || Number(uploadResult?.uploadedCount || 0) !== 1) {
        throw new Error("The rejection image could not be uploaded. Please retry.");
      }
      await api.patch(`/qc/reject-all/${qc?._id}`, {
        reason: trimmedReason,
        image_upload_intent_id: uploadIntentId,
      });
      onSuccess?.();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to reject this QC request.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Reject All</h5>
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
                onChange={(event) => setReason(event.target.value)}
                placeholder="Enter the rejection reason"
                disabled={saving}
              />
            </div>

            <div>
              <label className="form-label">Rejected Image</label>
              <input
                type="file"
                className="form-control"
                accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] || null;
                  setImageFile(nextFile);
                }}
                disabled={saving}
              />
              {imageFile && (
                <div className="small text-secondary mt-1">{imageFile.name}</div>
              )}
            </div>

            {error && <div className="alert alert-danger mb-0">{error}</div>}
            {saving && uploadState.isUploading && (
              <div className="small text-secondary">
                Uploading image directly to storage: {uploadState.progressPercent}%
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
              onClick={handleSubmit}
              disabled={saving}
            >
              {saving ? "Saving..." : "Reject All"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RejectAllModal;
