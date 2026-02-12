import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import UpdateQcModal from "../components/UpdateQcModal";
import AlignQCModal from "../components/AlignQcModal";
import { getUserFromToken } from "../auth/auth.utils";
import Barcode from "react-barcode";
import "../App.css";

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

const formatDateLabel = (value) => {
  if (!value) return "N/A";
  const asString = String(value).trim();
  if (!asString) return "N/A";
  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) return asString;
  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return asString;
  return parsed.toLocaleDateString();
};

const InfoBox = ({ label, value, compact = false }) => (
  <div className={compact ? "qc-info-compact-item" : "col-md-3 col-lg-3"}>
    <div className="qc-info-label">{label}</div>
    <div className="qc-info-value" title={value ?? ""}>{value}</div>
  </div>
);

const QcDetails = () => {
  const { id } = useParams();
  const [qc, setQc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showAlignModal, setShowAlignModal] = useState(false);

  const navigate = useNavigate();
  const user = getUserFromToken();
  const userId = user?.id || user?._id;
  const isAdmin = user?.role === "admin";
  const canRealign = ["admin", "manager"].includes(user?.role);

  const requirementsMet = Boolean(qc?.packed_size) && Boolean(qc?.finishing) && Boolean(qc?.branding);
  const hasPendingQuantities = (qc?.quantities?.qc_checked || 0) === 0 || (qc?.quantities?.pending || 0) > 0;
  const qcIsPending = hasPendingQuantities || !requirementsMet;
  const assignedInspectorId = qc?.inspector?._id ? String(qc.inspector._id) : "";
  const hasInspectionRecords = Array.isArray(qc?.inspection_record) && qc.inspection_record.length > 0;
  const canClaimInspection =
    user?.role === "QC" && !hasInspectionRecords && (qc?.quantities?.qc_checked || 0) === 0;
  const canUpdateQc =
    isAdmin ||
    (user?.role === "QC" && qcIsPending && (assignedInspectorId === String(userId) || canClaimInspection));

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

  const rejectedLabelsText = rejectedLabels.length ? rejectedLabels.join(", ") : "None";
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

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-shell py-5 text-center">Loading...</div>
      </>
    );
  }

  if (!qc) {
    return (
      <>
        <Navbar />
        <div className="page-shell py-5 text-center">No QC found</div>
      </>
    );
  }

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigate("/qc")}>
            Back
          </button>
          <h2 className="h4 mb-0">QC Details</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card">
          <div className="card-body d-grid gap-4">
            <section>
              <h3 className="h6 mb-3">{`Order Information | ${qc.order.order_id} | ${qc.order.brand} | ${qc.order.vendor} | ${new Date(qc.request_date).toLocaleDateString()}`}</h3>
              <div className="qc-order-inline-grid">
                <InfoBox compact label="Item Code" value={qc.item.item_code} />
                <InfoBox compact label="Description" value={qc.item.description} />
                <InfoBox compact label="Order Quantity" value={qc.quantities.client_demand} />
                <InfoBox
                  compact
                  label="Quantity Requested"
                  value={qc.quantities.quantity_requested ?? qc.quantities.vendor_provision}
                />
                <InfoBox compact label="Vendor Provision" value={qc.quantities.vendor_provision} />
                <InfoBox compact label="QC Checked" value={qc.quantities.qc_checked} />
                <InfoBox compact label="Passed" value={qc.quantities.qc_passed} />
                <InfoBox compact label="Rejected" value={qc.quantities.qc_rejected} />
                <InfoBox compact label="Pending" value={qc.quantities.pending} />
              </div>
            </section>

            {/* <section>
              <h3 className="h6 mb-3">Item Information</h3>
              <div className="row g-3">
                <InfoBox label="Item Code" value={qc.item.item_code} />
                <InfoBox label="Description" value={qc.item.description} />
                <InfoBox label="Request Date" value={new Date(qc.request_date).toLocaleDateString()} />
              </div>
            </section> */}

            <section>
              <h3 className="h6 mb-3">Inspection Records</h3>
              {Array.isArray(qc.inspection_record) && qc.inspection_record.length > 0 ? (
                <div className="table-responsive">
                  <table className="table table-sm table-striped align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Inspector</th>
                        <th>Requested</th>
                        <th>Offered</th>
                        <th>Checked</th>
                        <th>Passed</th>
                        <th>Rejected</th>
                        <th>Pending After</th>
                        <th>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qc.inspection_record.map((record) => (
                        <tr key={record._id}>
                          <td>{formatDateLabel(record?.inspection_date || record?.createdAt)}</td>
                          <td>{record?.inspector?.name || "N/A"}</td>
                          <td>{record?.vendor_requested ?? 0}</td>
                          <td>{record?.vendor_offered ?? 0}</td>
                          <td>{record?.checked ?? 0}</td>
                          <td>{record?.passed ?? 0}</td>
                          <td>{record?.rejected ?? 0}</td>
                          <td>{record?.pending_after ?? 0}</td>
                          <td>{record?.remarks || "None"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-secondary small">No inspection records yet.</div>
              )}
            </section>

            <section>
              <h3 className="h6 mb-3">Status</h3>
              {qc.order.status === "Under Inspection" && (
                <div className="alert alert-success py-2 mb-0">
                  {qc.inspector?.name ? `${qc.inspector.name} is aligned` : "QC request aligned"}
                </div>
              )}
              {qc.order.status === "Finalized" && (
                <div className="alert alert-success py-2 mb-0">Finalized</div>
              )}
            </section>

            <section>
              <h3 className="h6 mb-3">QC Notes</h3>
              <div className="row g-3">
                <InfoBox label="Labels" value={labelRange} />
                <InfoBox label="Rejected Labels" value={rejectedLabelsText} />
                <InfoBox label="Remarks" value={qc.remarks || "None"} />
              </div>
            </section>

            <section>
              <h3 className="h6 mb-3">QC Attributes</h3>
              <div className="row g-3 mb-3">
                <InfoBox label="CBM Top" value={isPositiveCbmValue(cbmData.top) ? cbmData.top : "Not Set"} />
                <InfoBox label="CBM Bottom" value={isPositiveCbmValue(cbmData.bottom) ? cbmData.bottom : "Not Set"} />
                <InfoBox label="CBM Total" value={isPositiveCbmValue(cbmData.total) ? cbmData.total : "Not Set"} />
                <InfoBox label="Packed Size" value={qc.packed_size ? "Yes" : "No"} />
                <InfoBox label="Finishing" value={qc.finishing ? "Yes" : "No"} />
                <InfoBox label="Branding" value={qc.branding ? "Yes" : "No"} />
              </div>

              <div className="row g-3">
                <div className="col-lg-6">
                  <div className="qc-info-label">Barcode</div>
                  <div className="qc-info-value">{barcodeValue || "Not Set"}</div>
                </div>
                {barcodeValue && (
                  <div className="col-lg-6">
                    <div className="qc-barcode-wrapper">
                      <Barcode value={barcodeValue} />
                    </div>
                  </div>
                )}
              </div>
            </section>

            <div className="d-flex justify-content-end flex-wrap gap-2">
              {canRealign && (
                <button type="button" className="btn btn-outline-secondary" onClick={() => setShowAlignModal(true)}>
                  Re-align QC
                </button>
              )}

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowUpdateModal(true)}
                disabled={!canUpdateQc}
                title={
                  canUpdateQc
                    ? ""
                    : user?.role === "QC" && assignedInspectorId === String(userId)
                      ? "No pending quantity left to update."
                      : "Only admin or an eligible QC inspector can update this record."
                }
              >
                Update QC Record
              </button>
            </div>
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
          initialQuantityRequested={qc?.quantities?.quantity_requested}
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
