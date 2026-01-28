import { useState } from "react";
import { uploadOrders } from "../services/orders.service";
import "../App.css";

const UploadOrdersModal = ({ onClose, onSuccess }) => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleUpload = async () => {
    if (!file) {
      setError("Please select an Excel file");
      return;
    }

    try {
      setLoading(true);
      setError("");
      await uploadOrders(file);
      onSuccess(); // refresh orders
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h2>Upload Orders</h2>

        <input
        className="fileInput"
          type="file"
          accept=".xlsx,.xls,.xlsm"
          onChange={(e) => setFile(e.target.files[0])}
        />

        {error && <p style={{ color: "red" }}>{error}</p>}

        <div style={{ marginTop: "20px" }}>
          <button onClick={onClose} style={cancelBtn}>
            Cancel
          </button>

          <button
            onClick={handleUpload}
            disabled={loading}
            style={uploadBtn}
          >
            {loading ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------- Styles ---------- */

const overlayStyle = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0,0,0,0.5)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 1000,
};

const modalStyle = {
  background: "#fff",
  padding: "24px",
  borderRadius: "8px",
  width: "400px",
};

const uploadBtn = {
  padding: "8px 16px",
  backgroundColor: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: "4px",
  cursor: "pointer",
  marginLeft: "10px",
};

const cancelBtn = {
  padding: "8px 16px",
  backgroundColor: "#9ca3af",
  border: "none",
  borderRadius: "4px",
  cursor: "pointer",
};

export default UploadOrdersModal;
