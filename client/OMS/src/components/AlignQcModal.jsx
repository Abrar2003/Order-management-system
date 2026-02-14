import { useEffect, useState } from "react";
import axios from "../api/axios";
import "../App.css";

const formatDateInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const getTodayDateInput = () => {
  const today = new Date();
  const offsetMs = today.getTimezoneOffset() * 60000;
  return new Date(today.getTime() - offsetMs).toISOString().slice(0, 10);
};

const AlignQCModal = ({
  order,
  onClose,
  onSuccess,
  initialInspector = "",
  initialQuantityRequested = "",
  initialRequestDate = "",
}) => {
  const [inspectors, setInspectors] = useState([]);
  const [inspector, setInspector] = useState(
    initialInspector ? String(initialInspector) : "",
  );
  const [request_date, setReqDate] = useState(
    formatDateInput(initialRequestDate) || getTodayDateInput(),
  );
  const [quantityRequested, setQuantityRequested] = useState(
    initialQuantityRequested !== undefined && initialQuantityRequested !== null
      ? String(initialQuantityRequested)
      : "",
  );

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
    setReqDate(formatDateInput(initialRequestDate) || getTodayDateInput());
    setQuantityRequested(
      initialQuantityRequested !== undefined && initialQuantityRequested !== null
        ? String(initialQuantityRequested)
        : "",
    );
  }, [initialInspector, initialRequestDate, initialQuantityRequested]);

  const handleSubmit = async () => {
    const token = localStorage.getItem("token");

    if (!inspector || !request_date || quantityRequested === "") {
      alert("Inspector, request date and quantity requested are required.");
      return;
    }

    const quantityRequestedNumber = Number(quantityRequested);

    if (Number.isNaN(quantityRequestedNumber) || quantityRequestedNumber < 0) {
      alert("Quantity values must be valid non-negative numbers.");
      return;
    }

    if (quantityRequestedNumber > Number(order.quantity)) {
      alert("Quantity requested cannot exceed client demand.");
      return;
    }

    try {
      await axios.post(
        "/qc/align-qc",
        {
          order: order._id,
          item: order.item,
          inspector,
          request_date,
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
      <div className="modal-dialog modal-dialog-centered" role="document">
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
                <div className="fw-semibold">{order.quantity}</div>
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
              <label className="form-label">Request Date</label>
              <input
                type="date"
                className="form-control"
                value={request_date}
                onChange={(e) => setReqDate(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label">Quantity Requested</label>
              <input
                type="number"
                className="form-control"
                value={quantityRequested}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  if (nextValue === "" || Number(nextValue) >= 0) {
                    setQuantityRequested(nextValue);
                  }
                }}
                min="0"
              />
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
