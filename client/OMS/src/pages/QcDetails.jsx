import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import UpdateQcModal from "../components/UpdateQcModal";
import AlignQCModal from "../components/AlignQcModal";
import { getUserFromToken } from "../auth/auth.utils";
import "../App.css";
// import JsBarcode from "jsbarcode";
import Barcode from "react-barcode";

const normalizeLabels = (labels) => {
  if (!Array.isArray(labels)) return [];
  const numericLabels = labels
    .map((label) => Number(label))
    .filter((label) => Number.isFinite(label));
  return [...new Set(numericLabels)].sort((a, b) => a - b);
};

const findRejectedLabels = (sortedLabels) => {
  if (sortedLabels.length < 2) return [];
  const rejected = [];
  for (let i = 1; i < sortedLabels.length; i++) {
    const previous = sortedLabels[i - 1];
    const current = sortedLabels[i];
    if (current - previous > 1) {
      for (let missing = previous + 1; missing < current; missing++) {
        rejected.push(missing);
      }
    }
  }
  return rejected;
};

const BarcodePreview = ({ value }) => {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!value || !svgRef.current) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: "CODE128",
        lineColor: "#111827",
        width: 2,
        height: 60,
        displayValue: true,
        margin: 0,
      });
    } catch (error) {
      console.error("Failed to render barcode", error);
    }
  }, [value]);

  if (!value) return null;

  return <svg ref={svgRef} className="qc-barcode" />;
};

const QcDetails = () => {
  const { id } = useParams(); // qc id from URL
  const [qc, setQc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showAlignModal, setShowAlignModal] = useState(false);
  const navigate = useNavigate();
  const user = getUserFromToken();
  const userId = user?.id || user?._id;
  const isAdmin = user?.role === "admin";
  const canRealign = ["admin", "manager"].includes(user?.role);
  const requirementsMet =
    Boolean(qc?.packed_size) && Boolean(qc?.finishing) && Boolean(qc?.branding);
  const hasPendingQuantities =
    (qc?.quantities?.qc_checked || 0) === 0 ||
    (qc?.quantities?.pending || 0) > 0;
  const qcIsPending = hasPendingQuantities || !requirementsMet;
  const canUpdateQc =
    isAdmin || (user?.role === "QC" && qc?.inspector?._id === userId && qcIsPending);
  const sortedLabels = useMemo(() => normalizeLabels(qc?.labels), [qc?.labels]);
  const labelRange = sortedLabels.length
    ? `${sortedLabels[0]} - ${sortedLabels[sortedLabels.length - 1]}`
    : "None";
  const rejectedLabels = useMemo(() => {
    if (Array.isArray(qc?.rejected_labels) && qc.rejected_labels.length > 0) {
      return normalizeLabels(qc.rejected_labels);
    }
    return findRejectedLabels(sortedLabels);
  }, [qc?.rejected_labels, sortedLabels]);
  const rejectedLabelsText = rejectedLabels.length
    ? rejectedLabels.join(", ")
    : "None";
  const barcodeValue = qc?.barcode > 0 ? String(qc.barcode) : "";
  const isPositiveCbmValue = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
  };
  const cbmData = useMemo(() => {
    if (!qc) return { top: "", bottom: "", total: "" };
    const cbmValue = qc.cbm;
    if (typeof cbmValue === "number" || typeof cbmValue === "string") {
      return { top: "", bottom: "", total: String(cbmValue) };
    }
    return {
      top: cbmValue?.top ?? "",
      bottom: cbmValue?.bottom ?? "",
      total: cbmValue?.total ?? "",
    };
  }, [qc]);

  const fetchQcDetails = useCallback(async () => {
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
  }, [id]);

  useEffect(() => {
    fetchQcDetails();
  }, [fetchQcDetails]);

  if (loading) return <p>Loading...</p>;
  if (!qc) return <p>No QC found</p>;

  const handleUpdateQc = () => {
    setShowUpdateModal(true);
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
                <p>{qc.quantities.client_demand}</p>
              </div>
              <div className="qc-info-item">
                <label>Vendor Provision</label>
                <p>{qc.quantities.vendor_provision}</p>
              </div>
              <div className="qc-info-item">
                <label>QC Checked</label>
                <p>{qc.quantities.qc_checked}</p>
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
              <div className="qc-info-item">
                <label>Request Date</label>
                <p>{new Date(qc.request_date).toLocaleDateString()}</p>
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

          <div className="qc-section">
            <h3 className="qc-section-title">QC Notes</h3>
            <div className="qc-info-grid">
              <div className="qc-info-item">
                <label>Labels</label>
                <p>{labelRange}</p>
              </div>
              <div className="qc-info-item">
                <label>Rejected Labels</label>
                <p>{rejectedLabelsText}</p>
              </div>
              <div className="qc-info-item">
                <label>Remarks</label>
                <p>{qc.remarks || "None"}</p>
              </div>
            </div>
          </div>

          <div className="qc-section">
            <h3 className="qc-section-title">QC Attributes</h3>
            <div className="qc-info-grid">
              <div className="qc-info-item">
                <label>CBM Top</label>
                <p>{isPositiveCbmValue(cbmData.top) ? cbmData.top : "Not Set"}</p>
              </div>
              <div className="qc-info-item">
                <label>CBM Bottom</label>
                <p>
                  {isPositiveCbmValue(cbmData.bottom) ? cbmData.bottom : "Not Set"}
                </p>
              </div>
              <div className="qc-info-item">
                <label>CBM Total</label>
                <p>{isPositiveCbmValue(cbmData.total) ? cbmData.total : "Not Set"}</p>
              </div>
              <div className="qc-info-item">
                <label>Packed Size</label>
                <div className="qc-display-box">
                  <span style={{ textAlign: "center", width: "100%" }}>
                    {qc.packed_size ? "Yes" : "No"}
                  </span>
                </div>
              </div>
              <div className="qc-info-item">
                <label>Finishing</label>
                <div className="qc-display-box">
                  <span style={{ textAlign: "center", width: "100%" }}>
                    {qc.finishing ? "Yes" : "No"}
                  </span>
                </div>
              </div>
              <div className="qc-info-item">
                <label>Branding</label>
                <div className="qc-display-box">
                  <span style={{ textAlign: "center", width: "100%" }}>
                    {qc.branding ? "Yes" : "No"}
                  </span>
                </div>
              </div>
            </div>
            <div className="qc-info-item barcode">
              <label>Barcode</label>
              <p>{barcodeValue || "Not Set"}</p>
              {barcodeValue ? (
                <div className="qc-barcode-wrapper">
                  <Barcode value={barcodeValue} />
                </div>
              ) : null}
            </div>
          </div>

          <div className="qc-card-footer">
            {canRealign && (
              <button
                onClick={() => setShowAlignModal(true)}
                className="secondayButton"
              >
                Re-align QC
              </button>
            )}
            <button
              onClick={handleUpdateQc}
              className="primaryButton"
              disabled={!canUpdateQc}
              title={
                canUpdateQc
                  ? ""
                  : user?.role === "QC" && qc?.inspector?._id === userId
                    ? "No pending quantity left to update."
                    : "Only the assigned QC inspector or admin can update this record."
              }
            >
              Update QC Record
            </button>
          </div>
        </div>
      </div>

      {showUpdateModal && (
        <UpdateQcModal
          qc={qc}
          isAdmin={isAdmin}
          onClose={() => setShowUpdateModal(false)}
          onUpdated={() => {
            setShowUpdateModal(false);
            fetchQcDetails();
          }}
        />
      )}

      {showAlignModal && (
        <AlignQCModal
          order={qc?.order}
          initialInspector={qc?.inspector?._id}
          initialVendorProvision={qc?.quantities?.vendor_provision}
          initialRequestDate={qc?.request_date}
          onClose={() => setShowAlignModal(false)}
          onSuccess={() => {
            setShowAlignModal(false);
            fetchQcDetails();
          }}
        />
      )}
    </>
  );
};

export default QcDetails;
