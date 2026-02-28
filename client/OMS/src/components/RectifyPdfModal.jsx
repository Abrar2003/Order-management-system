import { useState } from "react";
import { rectifyPdfOrders } from "../services/orders.service";
import "../App.css";

const decodeBase64ToBlob = (base64String, mimeType) => {
  const binary = window.atob(String(base64String || ""));
  const length = binary.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
};

const triggerFileDownload = (blob, fileName) => {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName || "rectified-orders.xlsx";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(objectUrl);
};

const RectifyPdfModal = ({ onClose, onSuccess }) => {
  const [file, setFile] = useState(null);
  const [brand, setBrand] = useState("");
  const [vendor, setVendor] = useState("");
  const [applyChanges, setApplyChanges] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const handleSubmit = async () => {
    if (!file) {
      setError("Please select a PDF file.");
      return;
    }
    if (!String(brand || "").trim()) {
      setError("Brand is required.");
      return;
    }
    if (!String(vendor || "").trim()) {
      setError("Vendor is required.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setResult(null);

      const response = await rectifyPdfOrders({
        file,
        brand,
        vendor,
        applyChanges,
      });

      const fileBase64 = String(response?.file_base64 || "");
      if (fileBase64) {
        const blob = decodeBase64ToBlob(
          fileBase64,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        triggerFileDownload(blob, response?.file_name || "rectified-orders.xlsx");
      }

      setResult(response);
      onSuccess?.(response);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to rectify PDF.");
    } finally {
      setLoading(false);
    }
  };

  const summary = result?.summary || null;
  const apply = result?.apply || null;

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-lg" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Rectify PDF</h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
              disabled={loading}
            />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="row g-2">
              <div className="col-md-12">
                <label className="form-label">PDF File</label>
                <input
                  type="file"
                  className="form-control"
                  accept=".pdf,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  disabled={loading}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Brand</label>
                <input
                  type="text"
                  className="form-control"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  disabled={loading}
                  placeholder="e.g. BB"
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Vendor</label>
                <input
                  type="text"
                  className="form-control"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  disabled={loading}
                  placeholder="e.g. Lumi Art"
                />
              </div>
              <div className="col-md-12">
                <div className="form-check">
                  <input
                    id="rectify-apply-changes"
                    type="checkbox"
                    className="form-check-input"
                    checked={applyChanges}
                    onChange={(e) => setApplyChanges(Boolean(e.target.checked))}
                    disabled={loading}
                  />
                  <label className="form-check-label" htmlFor="rectify-apply-changes">
                    Apply changed entries directly to DB (new + modified rows)
                  </label>
                </div>
              </div>
            </div>

            {summary && (
              <div className="card">
                <div className="card-body d-grid gap-1">
                  <div className="small">Extracted: {Number(summary.extracted_rows || 0)}</div>
                  <div className="small">Valid: {Number(summary.valid_rows || 0)}</div>
                  <div className="small">Invalid: {Number(summary.invalid_rows || 0)}</div>
                  <div className="small">Duplicates in PDF: {Number(summary.duplicate_keys_in_pdf || 0)}</div>
                  <div className="small">Unchanged: {Number(summary.unchanged_rows || 0)}</div>
                  <div className="small">Changed: {Number(summary.changed_rows || 0)}</div>
                  <div className="small">New: {Number(summary.new_rows || 0)}</div>
                  <div className="small">Modified: {Number(summary.modified_rows || 0)}</div>
                  {apply?.applied && (
                    <>
                      <div className="small mt-2">Inserted: {Number(apply.inserted_count || 0)}</div>
                      <div className="small">Updated: {Number(apply.updated_count || 0)}</div>
                      <div className="small">
                        Quantity skipped: {Number(apply.quantity_skipped_count || 0)}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {error && <div className="alert alert-danger py-2 mb-0">{error}</div>}
            {result?.message && !error && (
              <div className="alert alert-success py-2 mb-0">{result.message}</div>
            )}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? "Processing..." : "Rectify PDF"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RectifyPdfModal;

