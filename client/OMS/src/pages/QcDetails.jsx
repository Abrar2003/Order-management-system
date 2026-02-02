import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import "../App.css";

const QcDetails = () => {
  const { id } = useParams(); // qc id from URL
  const [qc, setQc] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchQcDetails = async () => {
    try {
      const res = await api.get(`/qc/${id}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      setQc(res.data.data);
    } catch (err) {
      console.error(err);
      alert("Failed to load QC details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQcDetails();
  }, [id]);

  if (loading) return <p>Loading...</p>;
  if (!qc) return <p>No QC found</p>;

  const handleUpdateQc = () => {
    // Handle update QC record logic
    alert("Update QC Record functionality");
  };

  return (
    <>
      <Navbar />
      <div className="qc-details-container">
        <div className="qc-details-header">
          <button onClick={() => navigate("/qc")} className="backButton">
            ← Back
          </button>
          <h2 className="qc-details-title">QC Details</h2>
        </div>

        <div className="qc-card">
          <div className="qc-section">
            <h3 className="qc-section-title">Order Information</h3>
            <div className="qc-info-grid">
              <div className="qc-info-item">
                <label>Order ID</label>
                <p>{qc.order.order_id}</p>
              </div>
              <div className="qc-info-item">
                <label>Vendor</label>
                <p>{qc.order.vendor}</p>
              </div>
              <div className="qc-info-item">
                <label>Client Demand</label>
                <p>{qc.order.quantity}</p>
              </div>
              <div className="qc-info-item">
                <label>Vendor Provision</label>
                <p>{qc.quantities.vendor_provision}</p>
              </div>
              <div className="qc-info-item">
                <label>Passed</label>
                <p>{qc.quantities.qc_passed}</p>
              </div>
              <div className="qc-info-item">
                <label>Rejected</label>
                <p>{qc.quantities.qc_rejected}</p>
              </div>
              <div className="qc-info-item">
                <label>Pending</label>
                <p>{qc.quantities.pending}</p>
              </div>
            </div>
          </div>

          <div className="qc-section">
            <h3 className="qc-section-title">Item Information</h3>
            <div className="qc-info-grid">
              <div className="qc-info-item">
                <label>Item Code</label>
                <p>{qc.item.item_code}</p>
              </div>
              <div className="qc-info-item">
                <label>Description</label>
                <p>{qc.item.description}</p>
              </div>
            </div>
          </div>

          <div className="qc-section">
            <h3 className="qc-section-title">Inspector Details</h3>
            <div className="qc-info-grid">
              <div className="qc-info-item">
                <label>Inspector Name</label>
                <p>{qc.inspector?.name || "Not Assigned"}</p>
              </div>
            </div>
          </div>

          <div className="qc-section">
            <h3 className="qc-section-title">Status</h3>
            {qc.order.status === "Under Inspection" ? (
              <p className="qc-status-aligned">
                ✅ {qc.inspector?.name} is aligned
              </p>
            ) : qc.order.status === "Finalized" ? (
              <p className="qc-status-aligned">✅ Finalized</p>
            ) : null}
          </div>

          <div className="qc-card-footer">
            <button onClick={handleUpdateQc} className="primaryButton">
              Update QC Record
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default QcDetails;
