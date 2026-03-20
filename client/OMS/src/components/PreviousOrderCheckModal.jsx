import { useEffect, useState } from "react";
import { checkPreviousOrder } from "../services/orders.service";

const KEEP_BOTH = "keep_both";
const REPLACE_PREVIOUS = "replace_previous";

const PreviousOrderCheckModal = ({
  row = null,
  action = null,
  onClose,
  onApply,
}) => {
  const [searchOrderId, setSearchOrderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [strategy, setStrategy] = useState(KEEP_BOTH);
  const [transferInspections, setTransferInspections] = useState(false);

  useEffect(() => {
    const nextAction = action && typeof action === "object" ? action : {};
    setSearchOrderId(String(nextAction?.previous_order_order_id || "").trim());
    setResult(null);
    setError("");
    setStrategy(
      String(nextAction?.strategy || "").trim().toLowerCase() === REPLACE_PREVIOUS
        ? REPLACE_PREVIOUS
        : KEEP_BOTH,
    );
    setTransferInspections(Boolean(nextAction?.transfer_inspection_records));
  }, [action, row]);

  const handleSearch = async () => {
    if (!row?.item_code) {
      setError("Selected row is missing item code.");
      return;
    }

    if (!String(searchOrderId || "").trim()) {
      setError("Previous PO is required.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await checkPreviousOrder({
        orderId: searchOrderId,
        itemCode: row.item_code,
      });

      setResult(response);
      setStrategy((current) =>
        current === REPLACE_PREVIOUS && response?.capabilities?.can_replace_previous
          ? REPLACE_PREVIOUS
          : KEEP_BOTH,
      );
      setTransferInspections(
        Boolean(action?.transfer_inspection_records)
        && Boolean(response?.capabilities?.can_transfer_inspections),
      );
    } catch (searchError) {
      setResult(null);
      setError(
        searchError?.response?.data?.message
        || searchError?.message
        || "Failed to check previous order.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (!result?.order?._id) {
      setError("Search a previous order before saving.");
      return;
    }

    if (
      strategy === REPLACE_PREVIOUS
      && !result?.capabilities?.can_replace_previous
    ) {
      setError("This previous order can be replaced only when its status is Partial Shipped.");
      return;
    }

    onApply?.({
      previous_order_db_id: result.order._id,
      previous_order_order_id: result.order.order_id,
      strategy,
      transfer_inspection_records:
        strategy === REPLACE_PREVIOUS ? Boolean(transferInspections) : false,
    });
  };

  const metrics = result?.metrics || {};
  const capabilities = result?.capabilities || {};

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Check Previous Orders</h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
              disabled={loading}
            />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="small text-muted">
              New PO: <strong>{row?.order_id || "-"}</strong> | Item:{" "}
              <strong>{row?.item_code || "-"}</strong>
            </div>

            <div className="input-group">
              <input
                type="text"
                className="form-control"
                placeholder="Enter previous PO"
                value={searchOrderId}
                onChange={(e) => setSearchOrderId(e.target.value)}
                disabled={loading}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSearch}
                disabled={loading}
              >
                {loading ? "Checking..." : "Submit"}
              </button>
            </div>

            {result?.order?._id && (
              <div className="card">
                <div className="card-body d-grid gap-1">
                  <div className="small">
                    Previous PO: <strong>{result.order.order_id || "-"}</strong>
                  </div>
                  <div className="small">Status: {result.order.status || "-"}</div>
                  <div className="small">Quantity: {Number(result.order.quantity || 0)}</div>
                  <div className="small">Pending Qty: {Number(metrics.pending_quantity || 0)}</div>
                  <div className="small">Passed Qty: {Number(metrics.passed_quantity || 0)}</div>
                  <div className="small">Shipped Qty: {Number(metrics.shipped_quantity || 0)}</div>
                </div>
              </div>
            )}

            {result?.order?._id && (
              <div className="d-grid gap-2">
                <div className="form-check">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="previous-order-strategy"
                    id="previous-order-keep-both"
                    checked={strategy === KEEP_BOTH}
                    onChange={() => setStrategy(KEEP_BOTH)}
                  />
                  <label className="form-check-label" htmlFor="previous-order-keep-both">
                    Keep both orders
                  </label>
                </div>

                <div className="form-check">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="previous-order-strategy"
                    id="previous-order-replace"
                    checked={strategy === REPLACE_PREVIOUS}
                    onChange={() => setStrategy(REPLACE_PREVIOUS)}
                    disabled={!capabilities.can_replace_previous}
                  />
                  <label className="form-check-label" htmlFor="previous-order-replace">
                    Remove previous order and add this new one
                  </label>
                </div>

                {!capabilities.can_replace_previous && (
                  <div className="small text-muted">
                    Replacement and transfer are available only when the searched order status is Partial Shipped.
                  </div>
                )}

                {capabilities.can_transfer_inspections && (
                  <div className="form-check mt-2">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="previous-order-transfer-inspections"
                      checked={transferInspections}
                      onChange={(e) => setTransferInspections(Boolean(e.target.checked))}
                      disabled={strategy !== REPLACE_PREVIOUS}
                    />
                    <label
                      className="form-check-label"
                      htmlFor="previous-order-transfer-inspections"
                    >
                      Transfer passed inspection records to the new PO
                    </label>
                  </div>
                )}
              </div>
            )}

            {error && <div className="alert alert-danger py-2 mb-0">{error}</div>}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-success"
              onClick={handleSave}
              disabled={loading || !result?.order?._id}
            >
              Save Action
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreviousOrderCheckModal;
