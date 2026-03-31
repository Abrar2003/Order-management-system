import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import { formatDateDDMMYYYY } from "../utils/date";

const normalizeStatus = (value) => String(value || "").trim().toLowerCase();

const TransferQcRequestModal = ({ qc, onClose, onTransferred }) => {
  const [inspectors, setInspectors] = useState([]);
  const [selectedInspectorId, setSelectedInspectorId] = useState("");
  const [selectedRequestIds, setSelectedRequestIds] = useState([]);
  const [loadingInspectors, setLoadingInspectors] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;

    const fetchInspectors = async () => {
      try {
        setLoadingInspectors(true);
        const response = await api.get("/auth/?role=QC");
        if (ignore) return;
        setInspectors(Array.isArray(response?.data) ? response.data : []);
      } catch (fetchError) {
        if (ignore) return;
        setInspectors([]);
        setError(
          fetchError?.response?.data?.message || "Failed to load inspectors.",
        );
      } finally {
        if (!ignore) {
          setLoadingInspectors(false);
        }
      }
    };

    fetchInspectors();
    return () => {
      ignore = true;
    };
  }, []);

  const requestRows = useMemo(() => {
    const requestHistory = Array.isArray(qc?.request_history) ? qc.request_history : [];

    return requestHistory.map((entry) => {
      const requestHistoryId = String(entry?._id || "").trim();
      const requestedQuantity = Number(entry?.quantity_requested || 0);
      const status = normalizeStatus(entry?.status);
      const isTransferred = status === "transfered" || status === "transferred";

      return {
        id: requestHistoryId,
        request_date: entry?.request_date || "",
        request_type: entry?.request_type || "FULL",
        inspector_name: entry?.inspector?.name || "Unassigned",
        inspector_id: String(entry?.inspector?._id || entry?.inspector || "").trim(),
        quantity_requested: requestedQuantity,
        quantity_transferable: requestedQuantity,
        status: entry?.status || "open",
        remarks: String(entry?.remarks || "").trim(),
        selectable: !isTransferred && requestedQuantity > 0,
      };
    });
  }, [qc?.request_history]);

  const handleToggleRequest = (requestId) => {
    setSelectedRequestIds((previous) =>
      previous.includes(requestId) ? [] : [requestId],
    );
  };

  const handleSubmit = async () => {
    if (!selectedInspectorId) {
      setError("Select an inspector to transfer the request to.");
      return;
    }
    if (selectedRequestIds.length !== 1) {
      setError("Select exactly one request row to transfer.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      const response = await api.post(
        `/qc/${encodeURIComponent(qc?._id || "")}/transfer-request`,
        {
          inspector_id: selectedInspectorId,
          request_history_ids: selectedRequestIds,
        },
      );

      alert(response?.data?.message || "Request transferred successfully.");
      await Promise.resolve(onTransferred?.());
    } catch (submitError) {
      setError(
        submitError?.response?.data?.message || "Failed to transfer request.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-lg" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Transfer Request</h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
              disabled={saving}
            />
          </div>

          <div className="modal-body d-grid gap-3">
            <div>
              <label className="form-label">Target Inspector</label>
              <select
                className="form-select"
                value={selectedInspectorId}
                onChange={(event) => setSelectedInspectorId(String(event.target.value || ""))}
                disabled={loadingInspectors || saving}
              >
                <option value="">Select Inspector</option>
                {inspectors.map((inspector) => (
                  <option key={inspector._id} value={inspector._id}>
                    {inspector.name || "Unknown"}
                  </option>
                ))}
              </select>
            </div>

            <div className="table-responsive">
              <table className="table table-sm table-striped align-middle mb-0">
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Request Date</th>
                    <th>Type</th>
                    <th>Inspector</th>
                    <th>Requested</th>
                    <th>New Request Qty</th>
                    <th>Status</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {requestRows.length === 0 && (
                    <tr>
                      <td colSpan="8" className="text-center py-3">
                        No request history found.
                      </td>
                    </tr>
                  )}

                  {requestRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="checkbox"
                          className="form-check-input"
                          checked={selectedRequestIds.includes(row.id)}
                          onChange={() => handleToggleRequest(row.id)}
                          disabled={!row.selectable || saving}
                        />
                      </td>
                      <td>{formatDateDDMMYYYY(row.request_date)}</td>
                      <td>{row.request_type}</td>
                      <td>{row.inspector_name}</td>
                      <td>{row.quantity_requested}</td>
                      <td>{row.quantity_transferable}</td>
                      <td>{row.status || "open"}</td>
                      <td>{row.remarks || "None"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={saving || loadingInspectors}
            >
              {saving ? "Transferring..." : "Transfer Request"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransferQcRequestModal;
