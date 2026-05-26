import { useMemo, useState } from "react";
import { COMPLAINT_FILE_ACCEPT } from "./complaintConstants";

const initialForm = {
  brand: "",
  vendor: "",
  item_code: "",
  po: "",
  first_comment: "",
};

const AddComplaintModal = ({
  brandOptions = [],
  loadingOptions = false,
  onClose,
  onSubmit,
  saving = false,
  vendorOptions = [],
}) => {
  const [form, setForm] = useState(initialForm);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState("");

  const fileNames = useMemo(() => files.map((file) => file.name), [files]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setError("");
    if (!form.brand.trim() || !form.vendor.trim() || !form.item_code.trim() || !form.first_comment.trim()) {
      setError("Brand, vendor, item code, and first comment are required.");
      return;
    }

    const formData = new FormData();
    formData.append("brand", form.brand.trim());
    formData.append("vendor", form.vendor.trim());
    formData.append("item_code", form.item_code.trim());
    formData.append("po", form.po.trim());
    formData.append("first_comment", form.first_comment.trim());
    files.forEach((file) => formData.append("files", file));
    onSubmit(formData);
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-lg modal-dialog-centered">
        <div className="modal-content">
          <form onSubmit={handleSubmit}>
            <div className="modal-header">
              <h5 className="modal-title">Add Complaint</h5>
              <button type="button" className="btn-close" onClick={onClose} disabled={saving} />
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger py-2">{error}</div>}
              <div className="row g-3">
                <div className="col-md-4">
                  <label className="form-label">Brand *</label>
                  <select
                    name="brand"
                    className="form-select"
                    value={form.brand}
                    onChange={handleChange}
                    required
                    disabled={saving || loadingOptions}
                  >
                    <option value="">Select Brand</option>
                    {brandOptions.map((brand) => (
                      <option key={brand} value={brand}>
                        {brand}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label">Vendor *</label>
                  <select
                    name="vendor"
                    className="form-select"
                    value={form.vendor}
                    onChange={handleChange}
                    required
                    disabled={saving || loadingOptions}
                  >
                    <option value="">Select Vendor</option>
                    {vendorOptions.map((vendor) => (
                      <option key={vendor} value={vendor}>
                        {vendor}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label">Item Code *</label>
                  <input name="item_code" className="form-control" value={form.item_code} onChange={handleChange} required />
                </div>
                <div className="col-md-4">
                  <label className="form-label">PO</label>
                  <input name="po" className="form-control" value={form.po} onChange={handleChange} />
                </div>
                <div className="col-12">
                  <label className="form-label">First Comment *</label>
                  <textarea
                    name="first_comment"
                    className="form-control"
                    rows="4"
                    value={form.first_comment}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="col-12">
                  <label className="form-label">Files</label>
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
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Creating..." : "Create Complaint"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddComplaintModal;
