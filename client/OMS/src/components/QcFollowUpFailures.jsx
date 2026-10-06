import { useCallback, useEffect, useState } from "react";
import api from "../api/axios";

const formatDate = (value) => value ? new Date(value).toLocaleString() : "—";

const QcFollowUpFailures = ({ open, onClose }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/jobs/qc-update-followups", { params: { state: "failed" } });
      setRows(Array.isArray(response.data?.data) ? response.data.data : []);
    } catch (loadError) {
      setError(loadError?.response?.data?.message || "Failed to load QC sync failures.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [load, open]);

  const retry = async (id) => {
    setRetrying(id);
    try {
      await api.post(`/jobs/qc-update-followups/${encodeURIComponent(id)}/retry`);
      await load();
    } catch (retryError) {
      setError(retryError?.response?.data?.message || "Failed to queue the retry.");
    } finally {
      setRetrying("");
    }
  };

  if (!open) return null;
  return (
    <div className="om-notification-popup-backdrop" role="dialog" aria-modal="true" aria-label="QC sync failures" onMouseDown={onClose}>
      <div className="om-notification-popup" onMouseDown={(event) => event.stopPropagation()}>
        <div className="om-notification-popup-header d-flex align-items-center justify-content-between gap-3">
          <div><h3 className="h5 mb-1">QC Sync Failures</h3><small className="text-secondary">Failed follow-up work can be safely retried.</small></div>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
        </div>
        <div className="om-notification-popup-body">
        {error && <div className="alert alert-danger py-2">{error}</div>}
        {loading ? <div className="text-secondary">Loading…</div> : rows.length === 0 ? <div className="text-secondary">No failed QC syncs.</div> : (
          <div className="table-responsive"><table className="table table-sm align-middle mb-0"><thead><tr><th>PO</th><th>Attempts</th><th>Failed</th><th>Error</th><th /></tr></thead><tbody>
            {rows.map((row) => <tr key={row.id}><td>{row.order_id || row.qc_id}</td><td>{row.attempts}</td><td>{formatDate(row.failed_at)}</td><td className="text-danger">{row.last_error || "Unknown error"}</td><td><button type="button" className="btn btn-outline-primary btn-sm" disabled={retrying === row.id} onClick={() => retry(row.id)}>{retrying === row.id ? "Retrying…" : "Retry"}</button></td></tr>)}
          </tbody></table></div>
        )}</div>
        <div className="om-notification-popup-footer text-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default QcFollowUpFailures;
