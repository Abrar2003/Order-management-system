import { useEffect, useState } from "react";
import axios from "../api/axios";
import "../App.css";

const AlignQCModal = ({ order, onClose, onSuccess }) => {
  const [inspectors, setInspectors] = useState([]);
  const [inspector, setInspector] = useState("");
  const [vendorProvision, setVendorProvision] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");

    axios.get("/auth/?role=QC", {
        headers: {
          Authorization: `Bearer ${token}`,
        }
      }).then((res) => {
      setInspectors(res.data);
    });
  }, []);

  const handleSubmit = async () => {
  const token = localStorage.getItem("token");

  if (!inspector || !vendorProvision) {
    alert("All fields are required");
    return;
  }

  try {
    await axios.post(
      "/qc/align-qc",
      {
        order: order._id,
        item: order.item,
        inspector,
        quantities: {
          client_demand: order.quantity,
          vendor_provision: Number(vendorProvision),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    alert("QC alignment successful");

    onSuccess();
  } catch (err) {
    console.error(err);
    alert("QC alignment failed");
  }
};


  return (
    <div className="modalOverlay">
      <div className="modalBox">
        <h3>Align QC Inspector</h3>

        <p><b>Order ID:</b> {order.order_id}</p>
        <p><b>Item:</b> {order.item.item_code}</p>
        <p><b>Description:</b> {order.item.description}</p>
        <p><b>Client Demand:</b> {order.quantity}</p>

        <label>QC Inspector</label>
        <select value={inspector} onChange={(e) => setInspector(e.target.value)}>
          <option value="">Select Inspector</option>
          {inspectors.map((qc) => (
            <option key={qc._id} value={qc._id}>
              {qc.name}
            </option>
          ))}
        </select>

        <label>Vendor Provision</label>
        <input
          type="number"
          value={vendorProvision}
          onChange={(e) => setVendorProvision(e.target.value)}
        />

        <div style={{ marginTop: 16 }}>
          <button onClick={handleSubmit}>Align QC</button>
          <button onClick={onClose} style={{ marginLeft: 8 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlignQCModal;
