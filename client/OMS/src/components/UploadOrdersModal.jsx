import { useState } from "react";
import { createManualOrders, uploadOrders } from "../services/orders.service";
import "../App.css";

const createEmptyManualRow = (id) => ({
  id,
  order_id: "",
  item_code: "",
  description: "",
  brand: "",
  vendor: "",
  quantity: "",
  ETD: "",
  order_date: "",
});

const UploadOrdersModal = ({ onClose, onSuccess }) => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("upload");
  const [nextRowId, setNextRowId] = useState(2);
  const [manualRows, setManualRows] = useState([createEmptyManualRow(1)]);

  const handleUpload = async () => {
    if (!file) {
      setError("Please select an Excel file");
      return;
    }

    try {
      setLoading(true);
      setError("");
      await uploadOrders(file);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleManualRowChange = (rowId, field, value) => {
    setManualRows((prevRows) =>
      prevRows.map((row) =>
        row.id === rowId
          ? {
            ...row,
            [field]: value,
          }
          : row,
      ),
    );
  };

  const addManualRow = () => {
    setManualRows((prevRows) => [...prevRows, createEmptyManualRow(nextRowId)]);
    setNextRowId((prev) => prev + 1);
  };

  const removeManualRow = (rowId) => {
    setManualRows((prevRows) => {
      if (prevRows.length === 1) return prevRows;
      return prevRows.filter((row) => row.id !== rowId);
    });
  };

  const toTrimmedString = (value) => String(value ?? "").trim();

  const getManualPayloadRows = () =>
    manualRows
      .map((row) => ({
        order_id: toTrimmedString(row.order_id),
        item_code: toTrimmedString(row.item_code),
        description: toTrimmedString(row.description),
        brand: toTrimmedString(row.brand),
        vendor: toTrimmedString(row.vendor),
        quantity: row.quantity === "" ? null : Number(row.quantity),
        ETD: toTrimmedString(row.ETD),
        order_date: toTrimmedString(row.order_date),
      }))
      .filter((row) =>
        Object.values(row).some((value) => {
          if (value === null || value === undefined) return false;
          if (typeof value === "number") return Number.isFinite(value) && value !== 0;
          return String(value).trim() !== "";
        }),
      )
      .map((row) => ({
        ...row,
        ETD: row.ETD || undefined,
        order_date: row.order_date || undefined,
      }));

  const handleManualAdd = async () => {
    const payloadRows = getManualPayloadRows();

    if (payloadRows.length === 0) {
      setError("Please add at least one order row.");
      return;
    }

    const hasInvalidRequiredValues = payloadRows.some(
      (row) =>
        !row.order_id
        || !row.item_code
        || !row.brand
        || !row.vendor
        || !Number.isFinite(Number(row.quantity))
        || Number(row.quantity) <= 0,
    );
    if (hasInvalidRequiredValues) {
      setError("Each row must include PO, item code, brand, vendor, and quantity > 0.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      await createManualOrders(payloadRows);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || "Manual add failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    if (mode === "manual") {
      handleManualAdd();
      return;
    }
    handleUpload();
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Upload Orders</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="btn-group w-100" role="group" aria-label="Upload mode">
              <button
                type="button"
                className={`btn ${mode === "upload" ? "btn-primary" : "btn-outline-primary"}`}
                onClick={() => {
                  setMode("upload");
                  setError("");
                }}
              >
                Upload Excel
              </button>
              <button
                type="button"
                className={`btn ${mode === "manual" ? "btn-primary" : "btn-outline-primary"}`}
                onClick={() => {
                  setMode("manual");
                  setError("");
                }}
              >
                Manual Add
              </button>
            </div>

            {mode === "upload" ? (
              <input
                className="form-control"
                type="file"
                accept=".xlsx,.xls,.xlsm"
                onChange={(e) => setFile(e.target.files[0])}
              />
            ) : (
              <div className="d-grid gap-2">
                <div className="d-flex justify-content-between align-items-center">
                  <small className="text-muted">Add one or more order rows manually.</small>
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={addManualRow}
                  >
                    + Add Row
                  </button>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>#</th>
                        <th>PO</th>
                        <th>Item Code</th>
                        <th>Description</th>
                        <th>Brand</th>
                        <th>Vendor</th>
                        <th>Qty</th>
                        <th>ETD</th>
                        <th>Order Date</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manualRows.map((row, index) => (
                        <tr key={row.id}>
                          <td>{index + 1}</td>
                          <td>
                            <input
                              type="text"
                              className="form-control form-control-sm"
                              value={row.order_id}
                              onChange={(e) => handleManualRowChange(row.id, "order_id", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="form-control form-control-sm"
                              value={row.item_code}
                              onChange={(e) => handleManualRowChange(row.id, "item_code", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="form-control form-control-sm"
                              value={row.description}
                              onChange={(e) => handleManualRowChange(row.id, "description", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="form-control form-control-sm"
                              value={row.brand}
                              onChange={(e) => handleManualRowChange(row.id, "brand", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="form-control form-control-sm"
                              value={row.vendor}
                              onChange={(e) => handleManualRowChange(row.id, "vendor", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              className="form-control form-control-sm"
                              value={row.quantity}
                              onChange={(e) => handleManualRowChange(row.id, "quantity", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="date"
                              className="form-control form-control-sm"
                              value={row.ETD}
                              onChange={(e) => handleManualRowChange(row.id, "ETD", e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="date"
                              className="form-control form-control-sm"
                              value={row.order_date}
                              onChange={(e) => handleManualRowChange(row.id, "order_date", e.target.value)}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-outline-danger btn-sm"
                              onClick={() => removeManualRow(row.id)}
                              disabled={manualRows.length === 1}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {error && <div className="alert alert-danger py-2 mb-0">{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
              {loading ? (mode === "manual" ? "Saving..." : "Uploading...") : mode === "manual" ? "Save Orders" : "Upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UploadOrdersModal;
