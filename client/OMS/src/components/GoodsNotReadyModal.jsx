import { useRef, useState } from "react";
import api from "../api/axios";

const MAX_GOODS_NOT_READY_IMAGES = 10;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

const GoodsNotReadyModal = ({ qc, onClose, onSuccess }) => {
  const [reason, setReason] = useState("");
  const [images, setImages] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const imageInputRef = useRef(null);
  const existingImageCount = Array.isArray(qc?.goods_not_ready_images)
    ? qc.goods_not_ready_images.length
    : 0;
  const remainingImageSlots = Math.max(
    0,
    MAX_GOODS_NOT_READY_IMAGES - existingImageCount,
  );

  const handleSubmit = async () => {
    const trimmedReason = String(reason || "").trim();
    if (!trimmedReason) {
      setError("Reason is required.");
      return;
    }
    if (images.length > remainingImageSlots) {
      setError(`You can add up to ${remainingImageSlots} more images.`);
      return;
    }

    try {
      setSaving(true);
      setError("");
      const formData = new FormData();
      formData.append("reason", trimmedReason);
      images.forEach((image) => {
        formData.append("goods_not_ready_images", image);
      });
      await api.patch(`/qc/goods-not-ready/${qc?._id}`, formData);
      onSuccess?.();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to mark goods as not ready.");
    } finally {
      setSaving(false);
    }
  };

  const handleImagesChange = (event) => {
    const selectedImages = Array.from(event.target.files || []);
    if (selectedImages.length > remainingImageSlots) {
      setImages([]);
      setError(`You can add up to ${remainingImageSlots} more images.`);
      event.target.value = "";
      return;
    }
    const invalidImage = selectedImages.find(
      (file) => !ALLOWED_IMAGE_TYPES.has(String(file?.type || "").toLowerCase()),
    );
    if (invalidImage) {
      setImages([]);
      setError("Only JPG, JPEG, and PNG images are allowed.");
      event.target.value = "";
      return;
    }
    setError("");
    setImages(selectedImages);
  };

  const removeImage = (removeIndex) => {
    setImages((currentImages) =>
      currentImages.filter((_image, index) => index !== removeIndex),
    );
    setError("");
    // The browser-owned FileList cannot be edited reliably. Clearing it lets
    // the user make a fresh selection that matches the visible list.
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div
        className="modal-dialog modal-dialog-centered goods-not-ready-dialog"
        role="document"
      >
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

          <div className="modal-body d-grid gap-3 goods-not-ready-modal-body">
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

            <div className="goods-not-ready-field">
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

            <div className="goods-not-ready-field">
              <label className="form-label" htmlFor="goods-not-ready-images">
                Images{" "}
                <span className="text-secondary">
                  (optional, {remainingImageSlots} of 10 slots available)
                </span>
              </label>
              <input
                ref={imageInputRef}
                id="goods-not-ready-images"
                type="file"
                className="form-control"
                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                multiple
                disabled={saving || remainingImageSlots === 0}
                onChange={handleImagesChange}
              />
              {images.length > 0 && (
                <div className="goods-not-ready-file-list mt-2">
                  <div className="small text-secondary">
                    {images.length} image{images.length === 1 ? "" : "s"} selected
                  </div>
                  {images.map((file, index) => (
                    <div
                      className="goods-not-ready-file-row"
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                    >
                      <span title={file.name}>{file.name}</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-link text-danger"
                        disabled={saving}
                        onClick={() => removeImage(index)}
                        aria-label={`Remove ${file.name}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
