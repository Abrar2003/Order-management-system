import { useState } from "react";
import { convertSampleToItem } from "../../services/samples.service";
import "../../App.css";

const ConvertToItemModal = ({ sample, onClose, onConverted }) => {
  const [form, setForm] = useState({
    code: String(sample?.code || "").toUpperCase(),
    name: String(sample?.name || ""),
    description: String(sample?.description || ""),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const code = String(form.code || "").trim();
    const name = String(form.name || "").trim();
    const description = String(form.description || "").trim();

    if (!code) {
      setError("Item code is required.");
      return;
    }
    if (!name) {
      setError("Item name is required.");
      return;
    }
    if (!description) {
      setError("Item description is required.");
      return;
    }

    try {
      setSaving(true);
      await convertSampleToItem(sample._id, { code, name, description });
      onConverted?.();
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to convert sample to item.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered" role="document">
        <form className="modal-content" onSubmit={handleSubmit}>
          <div className="modal-header">
            <h5 className="modal-title">Convert to Item | {sample?.code}</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>
          <div className="modal-body d-grid gap-3">
            {error && <div className="alert alert-danger mb-0">{error}</div>}
            <div>
              <label className="form-label">Item Code</label>
              <input
                type="text"
                className="form-control"
                value={form.code}
                onChange={(e) => setForm(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                required
              />
            </div>
            <div>
              <label className="form-label">Item Name</label>
              <input
                type="text"
                className="form-control"
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="form-label">Item Description</label>
              <textarea
                className="form-control"
                rows="3"
                value={form.description}
                onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                required
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-success" disabled={saving}>
              {saving ? "Converting..." : "Convert to Item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ConvertToItemModal;
