import { useEffect, useMemo, useState } from "react";
import { bulkUpdateRevisedEtd } from "../services/orders.service";
import OrderEtdWithHistory from "./OrderEtdWithHistory";
import { formatDateDDMMYYYY } from "../utils/date";
import "../App.css";

const BulkRevisedEtdModal = ({
  orders = [],
  onClose,
  onSuccess,
}) => {
  const normalizedOrders = useMemo(
    () => (Array.isArray(orders) ? orders : []).filter((order) => order?._id),
    [orders],
  );
  const [selectedOrderIds, setSelectedOrderIds] = useState(() => new Set());
  const [revisedDate, setRevisedDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSelectedOrderIds(new Set(normalizedOrders.map((order) => String(order._id))));
    setRevisedDate("");
    setError("");
  }, [normalizedOrders]);

  const allSelected = normalizedOrders.length > 0
    && selectedOrderIds.size === normalizedOrders.length;
  const selectedCount = selectedOrderIds.size;

  const toggleOrderSelection = (orderId) => {
    const normalizedOrderId = String(orderId || "").trim();
    if (!normalizedOrderId) return;

    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(normalizedOrderId)) {
        next.delete(normalizedOrderId);
      } else {
        next.add(normalizedOrderId);
      }
      return next;
    });
  };

  const handleToggleAll = () => {
    if (allSelected) {
      setSelectedOrderIds(new Set());
      return;
    }
    setSelectedOrderIds(new Set(normalizedOrders.map((order) => String(order._id))));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;

    const orderIds = [...selectedOrderIds];
    if (orderIds.length === 0) {
      setError("Select at least one item.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      await bulkUpdateRevisedEtd({
        orderIds,
        revised_ETD: revisedDate,
      });
      onSuccess?.();
    } catch (submitError) {
      setError(
        submitError?.response?.data?.message || "Failed to bulk update revised ETD.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-xl" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Bulk Revised ETD</h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
              disabled={saving}
            />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="modal-body d-grid gap-3">
              <div className="d-flex flex-wrap justify-content-between align-items-end gap-3">
                <div>
                  <label htmlFor="bulk-revised-etd-date" className="form-label">
                    Revised ETD
                  </label>
                  <input
                    id="bulk-revised-etd-date"
                    type="date"
                    className="form-control"
                    value={revisedDate}
                    onChange={(e) => setRevisedDate(e.target.value)}
                    disabled={saving}
                  />
                  <div className="form-text">
                    Leave empty and save to clear revised ETD on the selected items.
                  </div>
                </div>

                <div className="d-flex flex-wrap gap-2 align-items-center">
                  <span className="om-summary-chip">
                    Selected: {selectedCount} / {normalizedOrders.length}
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={handleToggleAll}
                    disabled={saving || normalizedOrders.length === 0}
                  >
                    {allSelected ? "Clear All" : "Select All"}
                  </button>
                </div>
              </div>

              <div className="table-responsive" style={{ maxHeight: "360px" }}>
                <table className="table table-sm table-striped align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: "4rem" }}>
                        <input
                          type="checkbox"
                          className="form-check-input"
                          checked={allSelected}
                          onChange={handleToggleAll}
                          disabled={saving || normalizedOrders.length === 0}
                        />
                      </th>
                      <th>Item Code</th>
                      <th>Description</th>
                      <th>Status</th>
                      <th>Current ETD</th>
                      <th>Current Revised ETD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {normalizedOrders.length === 0 && (
                      <tr>
                        <td colSpan="6" className="text-center py-3">
                          No items found for this PO.
                        </td>
                      </tr>
                    )}
                    {normalizedOrders.map((order) => {
                      const normalizedOrderId = String(order?._id || "");
                      return (
                        <tr key={normalizedOrderId}>
                          <td>
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={selectedOrderIds.has(normalizedOrderId)}
                              onChange={() => toggleOrderSelection(normalizedOrderId)}
                              disabled={saving}
                            />
                          </td>
                          <td>{order?.item?.item_code || "N/A"}</td>
                          <td>{order?.item?.description || "N/A"}</td>
                          <td>{order?.status || "N/A"}</td>
                          <td>
                            <OrderEtdWithHistory
                              orderId={order?.order_id}
                              itemCode={order?.item?.item_code}
                              etd={order?.ETD}
                              revisedEtd={order?.revised_ETD}
                            />
                          </td>
                          <td>{formatDateDDMMYYYY(order?.revised_ETD)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {revisedDate ? (
                <div className="small text-secondary">
                  New revised ETD: {formatDateDDMMYYYY(revisedDate)}
                </div>
              ) : null}

              {error ? <div className="alert alert-danger mb-0">{error}</div> : null}
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
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving..." : "Update Selected Items"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default BulkRevisedEtdModal;
