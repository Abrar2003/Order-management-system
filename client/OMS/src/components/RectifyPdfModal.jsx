import { useMemo, useState } from "react";
import { applyRectifiedRows, rectifyPdfOrders } from "../services/orders.service";
import { formatDateDDMMYYYY } from "../utils/date";
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [checkedRows, setCheckedRows] = useState({});

  const toDateText = (value) => {
    const formatted = formatDateDDMMYYYY(value, "");
    return formatted || "-";
  };

  const selectableRows = useMemo(
    () =>
      previewRows.filter(
        (row) => ["new", "modified"].includes(String(row?.change_type || "").toLowerCase()),
      ),
    [previewRows],
  );

  const selectedCount = selectableRows.filter((row) => checkedRows[row.row_id]).length;
  const allSelected = selectableRows.length > 0 && selectedCount === selectableRows.length;

  const toggleAllRows = (checked) => {
    const nextState = {};
    selectableRows.forEach((row) => {
      nextState[row.row_id] = checked;
    });
    setCheckedRows(nextState);
  };

  const handlePreview = async () => {
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
      setPreviewRows([]);
      setCheckedRows({});

      const response = await rectifyPdfOrders({
        file,
        brand,
        vendor,
        applyChanges: false,
      });

      const fileBase64 = String(response?.file_base64 || "");
      if (fileBase64) {
        const blob = decodeBase64ToBlob(
          fileBase64,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        triggerFileDownload(blob, response?.file_name || "rectified-orders.xlsx");
      }

      const incomingRows = Array.isArray(response?.changed_rows_data)
        ? response.changed_rows_data
        : [];
      const normalizedRows = incomingRows.map((row, index) => {
        const fallbackId = `${String(row?.order_id || "").trim()}__${String(row?.item_code || "").trim()}__${index}`;
        return {
          ...row,
          row_id: String(row?.row_id || fallbackId),
          changed_fields: Array.isArray(row?.changed_fields)
            ? row.changed_fields
            : String(row?.changed_fields || "")
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean),
        };
      });

      const nextCheckedRows = {};
      normalizedRows.forEach((row) => {
        const changeType = String(row?.change_type || "").toLowerCase();
        if (changeType === "new" || changeType === "modified") {
          nextCheckedRows[row.row_id] = true;
        }
      });

      setPreviewRows(normalizedRows);
      setCheckedRows(nextCheckedRows);
      setResult(response);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to rectify PDF.");
    } finally {
      setLoading(false);
    }
  };

  const handleApplyChecked = async () => {
    const rowsToApply = selectableRows.filter((row) => checkedRows[row.row_id]);
    if (rowsToApply.length === 0) {
      setError("Please check at least one row to update.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await applyRectifiedRows({
        rows: rowsToApply,
        brand,
        vendor,
        sourceFileName: file?.name || "",
      });

      setResult((prev) => ({
        ...(prev || {}),
        message: response?.message || "Checked rows updated in DB",
        apply: response?.apply || null,
        upload_log_id: response?.upload_log_id || null,
      }));
      onSuccess?.(response);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to update checked rows.");
    } finally {
      setLoading(false);
    }
  };

  const summary = result?.summary || null;
  const apply = result?.apply || null;

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl" role="document">
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
                  <div className="small">Closed (missing in PDF): {Number(summary.closed_rows || 0)}</div>
                  {apply?.applied && (
                    <>
                      <div className="small mt-2">Inserted: {Number(apply.inserted_count || 0)}</div>
                      <div className="small">Updated: {Number(apply.updated_count || 0)}</div>
                      <div className="small">
                        Quantity skipped: {Number(apply.quantity_skipped_count || 0)}
                      </div>
                      <div className="small">
                        Closed rows skipped in apply: {Number(apply.skipped_closed_count || 0)}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {previewRows.length > 0 && (
              <div className="card">
                <div className="card-header d-flex justify-content-between align-items-center">
                  <strong>Rectify Comparison Preview</strong>
                  <span className="small text-muted">
                    Selected: {selectedCount} / {selectableRows.length}
                  </span>
                </div>
                <div className="card-body p-0">
                  <div className="table-responsive" style={{ maxHeight: "320px" }}>
                    <table className="table table-sm table-hover align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th style={{ width: "42px" }}>
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={allSelected}
                              onChange={(e) => toggleAllRows(Boolean(e.target.checked))}
                              disabled={loading || selectableRows.length === 0}
                            />
                          </th>
                          <th>Type</th>
                          <th>Order ID</th>
                          <th>Item</th>
                          <th>Description</th>
                          <th>Qty</th>
                          <th>ETD</th>
                          <th>Order Date</th>
                          <th>Existing Status</th>
                          <th>Changed Fields</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row) => {
                          const rowType = String(row?.change_type || "").toLowerCase();
                          const isSelectable = rowType === "new" || rowType === "modified";
                          return (
                            <tr key={row.row_id}>
                              <td>
                                <input
                                  type="checkbox"
                                  className="form-check-input"
                                  checked={Boolean(checkedRows[row.row_id])}
                                  disabled={!isSelectable || loading}
                                  onChange={(e) =>
                                    setCheckedRows((prev) => ({
                                      ...prev,
                                      [row.row_id]: Boolean(e.target.checked),
                                    }))
                                  }
                                />
                              </td>
                              <td>{row.change_type || "-"}</td>
                              <td>{row.order_id || "-"}</td>
                              <td>{row.item_code || "-"}</td>
                              <td>{row.description || "-"}</td>
                              <td>{Number(row.quantity || 0)}</td>
                              <td>{toDateText(row.ETD)}</td>
                              <td>{toDateText(row.order_date)}</td>
                              <td>{row.existing_order_status || "-"}</td>
                              <td>
                                {Array.isArray(row.changed_fields) && row.changed_fields.length > 0
                                  ? row.changed_fields.join(", ")
                                  : "-"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
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
              onClick={handlePreview}
              disabled={loading}
            >
              {loading ? "Processing..." : "Extract & Preview"}
            </button>
            <button
              type="button"
              className="btn btn-success"
              onClick={handleApplyChecked}
              disabled={loading || selectedCount === 0}
            >
              {loading ? "Updating..." : "Update Checked in DB"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RectifyPdfModal;
