import { useEffect, useMemo, useState } from "react";
import {
  COMPLAINT_FILE_ACCEPT,
  formatComplaintDateTime,
  getFileTypeLabel,
} from "./complaintConstants";

const initialForm = {
  brand: "",
  vendor: "",
  category: "",
  item_code: "",
  po: "",
};

const toText = (value) => String(value || "").trim();
const makeDraftComment = (comment = {}, index = 0) => ({
  client_id: comment._id || `new-${Date.now()}-${index}`,
  _id: comment._id || "",
  comment: comment.comment || "",
  created_by: comment.created_by || null,
  created_at: comment.created_at || "",
});

const buildOptions = (options = [], current = "") =>
  [
    ...new Set(
      [...options, current]
        .map((value) => toText(value))
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

const EditComplaintModal = ({
  brandOptions = [],
  categoryOptions = [],
  complaint,
  creatingCategory = false,
  itemCodeOptions = [],
  loadingOptions = false,
  onClose,
  onCreateCategory,
  onSubmit,
  saving = false,
  vendorOptions = [],
}) => {
  const [form, setForm] = useState(initialForm);
  const [comments, setComments] = useState([]);
  const [removeFileIds, setRemoveFileIds] = useState([]);
  const [replaceFiles, setReplaceFiles] = useState(false);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const complaintComments = Array.isArray(complaint?.comments) ? complaint.comments : [];
    setForm({
      brand: complaint?.brand || "",
      vendor: complaint?.vendor || "",
      category: complaint?.category || "",
      item_code: complaint?.item_code || "",
      po: complaint?.po || "",
    });
    setComments(
      complaintComments.length > 0
        ? complaintComments.map(makeDraftComment)
        : [makeDraftComment({ comment: complaint?.first_comment || "" })],
    );
    setRemoveFileIds([]);
    setReplaceFiles(false);
    setFiles([]);
    setError("");
  }, [complaint]);

  const resolvedBrandOptions = useMemo(
    () => buildOptions(brandOptions, form.brand),
    [brandOptions, form.brand],
  );
  const resolvedVendorOptions = useMemo(
    () => buildOptions(vendorOptions, form.vendor),
    [form.vendor, vendorOptions],
  );
  const resolvedCategoryOptions = useMemo(
    () => buildOptions(categoryOptions, form.category),
    [categoryOptions, form.category],
  );
  const resolvedItemCodeOptions = useMemo(
    () => buildOptions(itemCodeOptions, form.item_code),
    [form.item_code, itemCodeOptions],
  );
  const selectedFileNames = useMemo(() => files.map((file) => file.name), [files]);
  const existingFiles = Array.isArray(complaint?.files) ? complaint.files : [];
  const removedFileIdSet = useMemo(() => new Set(removeFileIds), [removeFileIds]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCommentChange = (clientId, value) => {
    setComments((prev) =>
      prev.map((entry) =>
        entry.client_id === clientId ? { ...entry, comment: value } : entry,
      ),
    );
  };

  const handleRemoveComment = (clientId) => {
    setComments((prev) => prev.filter((entry) => entry.client_id !== clientId));
  };

  const handleAddComment = () => {
    setComments((prev) => [
      ...prev,
      makeDraftComment({ comment: "" }, prev.length + 1),
    ]);
  };

  const toggleRemoveFile = (fileId) => {
    const safeFileId = toText(fileId);
    if (!safeFileId) return;
    setRemoveFileIds((prev) =>
      prev.includes(safeFileId)
        ? prev.filter((id) => id !== safeFileId)
        : [...prev, safeFileId],
    );
  };

  const handleCreateCategory = async () => {
    const category = toText(form.category);
    if (!category) {
      setError("Enter a category name before creating it.");
      return;
    }
    if (!onCreateCategory) return;

    try {
      setError("");
      const savedCategory = await onCreateCategory(category);
      setForm((prev) => ({ ...prev, category: savedCategory || category }));
    } catch (categoryError) {
      setError(categoryError?.response?.data?.message || "Failed to create category.");
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setError("");

    const finalComments = comments
      .map((entry) => ({
        _id: toText(entry._id),
        comment: toText(entry.comment),
      }))
      .filter((entry) => entry.comment);

    if (!toText(form.brand) || !toText(form.vendor) || !toText(form.item_code)) {
      setError("Brand, vendor, and item code are required.");
      return;
    }
    if (finalComments.length === 0) {
      setError("At least one comment is required.");
      return;
    }

    const formData = new FormData();
    formData.append("brand", toText(form.brand));
    formData.append("vendor", toText(form.vendor));
    formData.append("category", toText(form.category));
    formData.append("item_code", toText(form.item_code));
    formData.append("po", toText(form.po));
    formData.append("first_comment", finalComments[0].comment);
    formData.append("comments_json", JSON.stringify(finalComments));
    formData.append("remove_file_ids", JSON.stringify(replaceFiles ? [] : removeFileIds));
    formData.append("replace_files", replaceFiles ? "true" : "false");
    files.forEach((file) => formData.append("files", file));
    onSubmit(formData);
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
        <div className="modal-content">
          <form onSubmit={handleSubmit}>
            <div className="modal-header">
              <h5 className="modal-title">Edit Complaint</h5>
              <button type="button" className="btn-close" onClick={onClose} disabled={saving} />
            </div>
            <div className="modal-body">
              <div className="small text-secondary mb-3">
                {complaint?.complaint_no || complaint?.item_code || "Complaint"}
              </div>
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
                    {resolvedBrandOptions.map((brand) => (
                      <option key={brand} value={brand}>{brand}</option>
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
                    {resolvedVendorOptions.map((vendor) => (
                      <option key={vendor} value={vendor}>{vendor}</option>
                    ))}
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label">Item Code *</label>
                  <input
                    name="item_code"
                    className="form-control"
                    list="edit-complaint-item-code-options"
                    value={form.item_code}
                    onChange={handleChange}
                    required
                    disabled={saving || loadingOptions}
                  />
                  <datalist id="edit-complaint-item-code-options">
                    {resolvedItemCodeOptions.map((itemCode) => (
                      <option key={itemCode} value={itemCode} />
                    ))}
                  </datalist>
                </div>
                <div className="col-md-4">
                  <label className="form-label">PO</label>
                  <input name="po" className="form-control" value={form.po} onChange={handleChange} disabled={saving} />
                </div>
                <div className="col-md-8">
                  <label className="form-label">Category</label>
                  <div className="input-group">
                    <input
                      name="category"
                      className="form-control"
                      list="edit-complaint-category-options"
                      value={form.category}
                      onChange={handleChange}
                      disabled={saving || creatingCategory}
                      placeholder="Select or type category"
                    />
                    <button
                      type="button"
                      className="btn btn-outline-primary"
                      onClick={handleCreateCategory}
                      disabled={saving || creatingCategory || !toText(form.category)}
                    >
                      {creatingCategory ? "Saving..." : "Create Category"}
                    </button>
                    <datalist id="edit-complaint-category-options">
                      {resolvedCategoryOptions.map((category) => (
                        <option key={category} value={category} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>

              <div className="complaint-detail-section">
                <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
                  <h4 className="h6 mb-0">Comments</h4>
                  <button type="button" className="btn btn-outline-primary btn-sm" onClick={handleAddComment} disabled={saving}>
                    Add Comment
                  </button>
                </div>
                <div className="d-flex flex-column gap-2">
                  {comments.map((entry, index) => (
                    <div className="border rounded p-2" key={entry.client_id}>
                      <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
                        <div className="small text-secondary">
                          Comment {index + 1}
                          {entry.created_by?.name ? ` by ${entry.created_by.name}` : ""}
                          {entry.created_at ? ` on ${formatComplaintDateTime(entry.created_at)}` : ""}
                        </div>
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => handleRemoveComment(entry.client_id)}
                          disabled={saving || comments.length <= 1}
                        >
                          Delete
                        </button>
                      </div>
                      <textarea
                        className="form-control"
                        rows="3"
                        value={entry.comment}
                        onChange={(event) => handleCommentChange(entry.client_id, event.target.value)}
                        disabled={saving}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="complaint-detail-section">
                <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
                  <h4 className="h6 mb-0">Files</h4>
                  <div className="form-check">
                    <input
                      id="edit-complaint-replace-files"
                      className="form-check-input"
                      type="checkbox"
                      checked={replaceFiles}
                      onChange={(event) => setReplaceFiles(event.target.checked)}
                      disabled={saving || existingFiles.length === 0}
                    />
                    <label className="form-check-label small" htmlFor="edit-complaint-replace-files">
                      Replace all existing files
                    </label>
                  </div>
                </div>

                {existingFiles.length === 0 ? (
                  <div className="text-secondary small mb-3">No files uploaded.</div>
                ) : (
                  <div className="d-flex flex-column gap-2 mb-3">
                    {existingFiles.map((file, index) => {
                      const fileId = file._id || `${file.key || "file"}-${index}`;
                      const willRemove = replaceFiles || removedFileIdSet.has(String(fileId));
                      return (
                        <div className={`border rounded p-2 ${willRemove ? "bg-light text-secondary" : ""}`} key={fileId}>
                          <div className="d-flex justify-content-between align-items-center gap-2">
                            <div>
                              <div className="fw-semibold">{file.original_name || file.file_name || "File"}</div>
                              <div className="small text-secondary">
                                {getFileTypeLabel(file)} · Uploaded by {file.uploaded_by?.name || "Unknown"} on {formatComplaintDateTime(file.uploaded_at)}
                              </div>
                            </div>
                            <button
                              type="button"
                              className={`btn btn-sm ${willRemove ? "btn-outline-secondary" : "btn-outline-danger"}`}
                              onClick={() => toggleRemoveFile(file._id)}
                              disabled={saving || replaceFiles || !file._id}
                            >
                              {willRemove ? "Removing" : "Remove"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <label className="form-label">Add Files</label>
                <input
                  type="file"
                  className="form-control"
                  accept={COMPLAINT_FILE_ACCEPT}
                  multiple
                  onChange={(event) => setFiles(Array.from(event.target.files || []))}
                  disabled={saving}
                />
                {selectedFileNames.length > 0 && (
                  <div className="small text-secondary mt-2">
                    Selected: {selectedFileNames.join(", ")}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EditComplaintModal;
