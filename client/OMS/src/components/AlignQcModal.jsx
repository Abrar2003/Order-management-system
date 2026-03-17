import { useEffect, useState } from "react";
import axios from "../api/axios";
import {
  getTodayDDMMYYYY,
  isValidDDMMYYYY,
  toDDMMYYYYInputValue,
  toISODateString,
} from "../utils/date";
import { formatCbm } from "../utils/cbm";
import { getUserFromToken } from "../auth/auth.utils";
import "../App.css";

const normalizeRequestType = (value) =>
  String(value || "").trim().toUpperCase() === "AQL" ? "AQL" : "FULL";

const computeAqlSampleQuantity = (quantity) => {
  const parsedQuantity = Number(quantity);
  if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) return 0;
  return Math.max(1, Math.ceil(parsedQuantity * 0.1));
};

const toLocalIsoDate = (dateValue) => {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const AlignQCModal = ({
  order,
  onClose,
  onSuccess,
  initialInspector = "",
  initialQuantityRequested = "",
  initialRequestDate = "",
  initialRequestType = "FULL",
  openQuantity = null,
}) => {
  const user = getUserFromToken();
  const normalizedRole = String(user?.role || "").trim().toLowerCase();
  const isManager = normalizedRole === "manager";
  const todayIso = toLocalIsoDate(new Date());
  const managerMinAllowedDateIso = (() => {
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - 2);
    return toLocalIsoDate(minDate);
  })();
  const [inspectors, setInspectors] = useState([]);
  const [inspector, setInspector] = useState(
    initialInspector ? String(initialInspector) : "",
  );
  const [requestType, setRequestType] = useState(
    normalizeRequestType(initialRequestType),
  );
  const [request_date, setReqDate] = useState(
    toDDMMYYYYInputValue(initialRequestDate, "") || getTodayDDMMYYYY(),
  );
  const [quantityRequested, setQuantityRequested] = useState(
    initialQuantityRequested !== undefined && initialQuantityRequested !== null
      ? String(initialQuantityRequested)
      : "",
  );
  const [selectedDateRequests, setSelectedDateRequests] = useState([]);
  const [selectedDateRequestsLoading, setSelectedDateRequestsLoading] = useState(false);
  const [selectedDateRequestsError, setSelectedDateRequestsError] = useState("");

  const parsedOpenQuantity = Number(openQuantity);
  const fallbackOpenQuantity = Number(order?.quantity);
  const effectiveOpenQuantity = Number.isFinite(parsedOpenQuantity)
    ? parsedOpenQuantity
    : Number.isFinite(fallbackOpenQuantity)
      ? fallbackOpenQuantity
      : 0;
  const aqlSampleQuantity = computeAqlSampleQuantity(effectiveOpenQuantity);
  const effectiveQuantityRequested =
    requestType === "AQL"
      ? String(aqlSampleQuantity)
      : quantityRequested;

  useEffect(() => {
    const token = localStorage.getItem("token");

    axios
      .get("/auth/?role=QC", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      .then((res) => {
        setInspectors(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {
        setInspectors([]);
      });
  }, []);

  useEffect(() => {
    setInspector(initialInspector ? String(initialInspector) : "");
    setRequestType(normalizeRequestType(initialRequestType));
    setReqDate(toDDMMYYYYInputValue(initialRequestDate, "") || getTodayDDMMYYYY());
    setQuantityRequested(
      initialQuantityRequested !== undefined && initialQuantityRequested !== null
        ? String(initialQuantityRequested)
        : "",
    );
  }, [
    initialInspector,
    initialRequestDate,
    initialQuantityRequested,
    initialRequestType,
  ]);

  useEffect(() => {
    const requestDateIso = toISODateString(request_date);
    if (!requestDateIso || !isValidDDMMYYYY(request_date)) {
      setSelectedDateRequests([]);
      setSelectedDateRequestsError("");
      setSelectedDateRequestsLoading(false);
      return undefined;
    }

    let cancelled = false;

    const fetchSelectedDateRequests = async () => {
      try {
        setSelectedDateRequestsLoading(true);
        setSelectedDateRequestsError("");

        const response = await axios.get("/qc/daily-report", {
          params: { date: requestDateIso },
        });

        if (cancelled) return;

        setSelectedDateRequests(
          Array.isArray(response?.data?.aligned_requests)
            ? response.data.aligned_requests
            : [],
        );
      } catch (err) {
        if (cancelled) return;
        setSelectedDateRequests([]);
        setSelectedDateRequestsError(
          err?.response?.data?.message || "Failed to load requests for selected date.",
        );
      } finally {
        if (!cancelled) {
          setSelectedDateRequestsLoading(false);
        }
      }
    };

    fetchSelectedDateRequests();

    return () => {
      cancelled = true;
    };
  }, [request_date]);

  const handleSubmit = async () => {
    const token = localStorage.getItem("token");
    const requestDateIso = toISODateString(request_date);

    if (
      !inspector ||
      !request_date ||
      (requestType === "FULL" && quantityRequested === "")
    ) {
      alert("Inspector, request date and quantity requested are required.");
      return;
    }
    if (!isValidDDMMYYYY(request_date) || !requestDateIso) {
      alert("Request date must be in DD/MM/YYYY format.");
      return;
    }
    if (
      isManager &&
      (
        requestDateIso < managerMinAllowedDateIso
        || requestDateIso > todayIso
      )
    ) {
      alert("Manager can align QC only for today and previous 2 days.");
      return;
    }

    const quantityRequestedNumber =
      requestType === "AQL"
        ? aqlSampleQuantity
        : Number(quantityRequested);

    if (Number.isNaN(quantityRequestedNumber) || quantityRequestedNumber < 0) {
      alert("Quantity values must be valid non-negative numbers.");
      return;
    }
    if (requestType === "AQL" && quantityRequestedNumber <= 0) {
      alert("AQL sample quantity is invalid for this order.");
      return;
    }

    if (quantityRequestedNumber > effectiveOpenQuantity) {
      alert("Quantity requested cannot exceed pending quantity.");
      return;
    }

    try {
      await axios.post(
        "/qc/align-qc",
        {
          order: order._id,
          item: order.item,
          inspector,
          request_type: requestType,
          request_date: requestDateIso,
          quantities: {
            client_demand: order.quantity,
            quantity_requested: quantityRequestedNumber,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      alert("QC alignment successful");
      onSuccess();
    } catch (err) {
      console.error(err);
      alert("QC alignment failed");
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Align QC Request</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="row g-2">
              <div className="col-sm-6">
                <div className="small text-secondary">Order ID</div>
                <div className="fw-semibold">{order.order_id}</div>
              </div>
              <div className="col-sm-6">
                <div className="small text-secondary">Item</div>
                <div className="fw-semibold">{order.item.item_code}</div>
              </div>
              <div className="col-12">
                <div className="small text-secondary">Description</div>
                <div className="fw-semibold">{order.item.description}</div>
              </div>
              <div className="col-6">
                <div className="small text-secondary">Order Quantity</div>
                <div className="fw-semibold">{order.quantity}</div>
              </div>
              <div className="col-6">
                <div className="small text-secondary">Open Quantity</div>
                <div className="fw-semibold">{effectiveOpenQuantity}</div>
              </div>
            </div>

            <div>
              <label className="form-label">QC Inspector</label>
              <select
                className="form-select"
                value={inspector}
                onChange={(e) => setInspector(e.target.value)}
              >
                <option value="">Select Inspector</option>
                {inspectors.map((qcInspector) => (
                  <option key={qcInspector._id} value={qcInspector._id}>
                    {qcInspector.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label d-block mb-2">QC Request Type</label>
              <div className="d-flex gap-3">
                <div className="form-check">
                  <input
                    id="qc-request-type-full"
                    className="form-check-input"
                    type="radio"
                    name="qc-request-type"
                    checked={requestType === "FULL"}
                    onChange={() => setRequestType("FULL")}
                  />
                  <label className="form-check-label" htmlFor="qc-request-type-full">
                    FULL
                  </label>
                </div>
                <div className="form-check">
                  <input
                    id="qc-request-type-aql"
                    className="form-check-input"
                    type="radio"
                    name="qc-request-type"
                    checked={requestType === "AQL"}
                    onChange={() => setRequestType("AQL")}
                  />
                  <label className="form-check-label" htmlFor="qc-request-type-aql">
                    AQL
                  </label>
                </div>
              </div>
            </div>

            <div>
              <label className="form-label">Request Date</label>
              <input
                type="date"
                lang="en-GB"
                className="form-control"
                value={toISODateString(request_date)}
                min={isManager ? managerMinAllowedDateIso : undefined}
                max={isManager ? todayIso : undefined}
                onChange={(e) => setReqDate(toDDMMYYYYInputValue(e.target.value, ""))}
              />
            </div>

            <div>
              <label className="form-label">Quantity Requested</label>
              <input
                type="number"
                className="form-control"
                value={effectiveQuantityRequested}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  if (nextValue === "" || Number(nextValue) >= 0) {
                    setQuantityRequested(nextValue);
                  }
                }}
                min="0"
                disabled={requestType === "AQL"}
              />
              {requestType === "AQL" && (
                <div className="small text-secondary mt-1">
                  AQL request uses 10% sample ({aqlSampleQuantity}) and backend auto-handles pass logic.
                </div>
              )}
            </div>

            <div>
              <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
                <label className="form-label mb-0">Requests On Selected Date</label>
                <span className="small text-secondary">
                  {selectedDateRequests.length} request{selectedDateRequests.length === 1 ? "" : "s"}
                </span>
              </div>

              {selectedDateRequestsError ? (
                <div className="small text-danger">{selectedDateRequestsError}</div>
              ) : selectedDateRequestsLoading ? (
                <div className="small text-secondary">Loading requests...</div>
              ) : selectedDateRequests.length === 0 ? (
                <div className="small text-secondary">
                  No QC requests found on this date.
                </div>
              ) : (
                <div className="table-responsive align-qc-request-table-wrap">
                  <table className="table table-sm table-striped align-middle mb-0 align-qc-request-table">
                    <thead className="table-light">
                      <tr>
                        <th>PO</th>
                        <th>Item Code</th>
                        <th>Inspector</th>
                        <th>Requested Qty</th>
                        <th>Inspected CBM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDateRequests.map((request, index) => (
                        <tr
                          key={request?.qc_id || `${request?.order_id || "po"}-${request?.item_code || "item"}-${index}`}
                          className={
                            request?.goods_not_ready
                              ? "weekly-summary-warning-row"
                              : request?.is_inspection_done
                                ? "om-report-success-row"
                                : ""
                          }
                        >
                          <td>{request?.order_id || "N/A"}</td>
                          <td>{request?.item_code || "N/A"}</td>
                          <td>{request?.inspector?.name || "Unassigned"}</td>
                          <td>{request?.quantity_requested ?? 0}</td>
                          <td>{formatCbm(request?.inspected_cbm_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSubmit}>
              Align QC
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AlignQCModal;
