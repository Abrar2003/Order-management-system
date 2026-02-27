import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import UpdateQcModal from "../components/UpdateQcModal";
import ShippingModal from "../components/ShippingModal";
import EditOrderModal from "../components/EditOrderModal";
import EditInspectionRecordsModal from "../components/EditInspectionRecordsModal";
import { getUserFromToken } from "../auth/auth.utils";
import { formatDateDDMMYYYY } from "../utils/date";
import Barcode from "react-barcode";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import "../App.css";

const normalizeLabels = (labels) => {
  if (!Array.isArray(labels)) return [];
  const numericLabels = labels
    .map((label) => Number(label))
    .filter((label) => Number.isFinite(label));
  return [...new Set(numericLabels)].sort((a, b) => a - b);
};

const toTimestamp = (value) => {
  if (!value) return 0;
  const asString = String(value).trim();
  if (!asString) return 0;

  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) {
    const parsed = new Date(`${asString}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(asString)) {
    const [day, month, year] = asString.split(/[/-]/).map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const formatLbhValue = (value) => {
  const length = Number(value?.L || 0);
  const breadth = Number(value?.B || 0);
  const height = Number(value?.H || 0);
  const safeLength = Number.isFinite(length) ? length : 0;
  const safeBreadth = Number.isFinite(breadth) ? breadth : 0;
  const safeHeight = Number.isFinite(height) ? height : 0;
  if (safeLength <= 0 && safeBreadth <= 0 && safeHeight <= 0) {
    return "Not Set";
  }
  return `${safeLength} x ${safeBreadth} x ${safeHeight}`;
};

const isPositiveCbmValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};

const InfoBox = ({ label, value, compact = false }) => (
  <div className={compact ? "qc-info-compact-item" : "col-md-3 col-lg-3"}>
    <div className="qc-info-label">{label}</div>
    <div className="qc-info-value" title={value ?? ""}>
      {value}
    </div>
  </div>
);

const isShipmentEditableStatus = (statusValue) => {
  const normalized = String(statusValue || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "partial shipped"
    || normalized === "partially shipped"
    || normalized === "shipped"
  );
};

const QcDetails = () => {
  const { id } = useParams();
  const [qc, setQc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showShippingModal, setShowShippingModal] = useState(false);
  const [showEditShippingModal, setShowEditShippingModal] = useState(false);
  const [showEditInspectionModal, setShowEditInspectionModal] = useState(false);
  const [deletingInspectionId, setDeletingInspectionId] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);
  const qcDetailsRef = useRef(null);

  const navigate = useNavigate();
  const location = useLocation();
  const user = getUserFromToken();
  const normalizedRole = String(user?.role || "").trim().toLowerCase();
  const userId = user?.id || user?._id;
  const isAdmin = normalizedRole === "admin" || normalizedRole === "manager";
  const isOnlyAdmin = normalizedRole === "admin";
  const canFinalizeShipping = ["admin", "manager", "dev"].includes(
    normalizedRole,
  );
  const hasShippingRecords =
    Array.isArray(qc?.order?.shipment) && qc.order.shipment.length > 0;
  const canShowEditShippingButton =
    isOnlyAdmin &&
    (hasShippingRecords || isShipmentEditableStatus(qc?.order?.status));

  const requirementsMet =
    Boolean(qc?.packed_size) && Boolean(qc?.finishing) && Boolean(qc?.branding);
  const hasPendingQuantities =
    (qc?.quantities?.qc_checked || 0) === 0 ||
    (qc?.quantities?.pending || 0) > 0;
  const qcIsPending = hasPendingQuantities || !requirementsMet;
  const isInspectionDone = qc?.order?.status === "Inspection Done";
  const assignedInspectorId = qc?.inspector?._id
    ? String(qc.inspector._id)
    : "";
  const hasActiveInspectionRecords = Array.isArray(qc?.inspection_record)
    && qc.inspection_record.some((record) => {
      const checked = Number(record?.checked || 0);
      const passed = Number(record?.passed || 0);
      const offered = Number(record?.vendor_offered || 0);
      const labelsAdded = Array.isArray(record?.labels_added)
        ? record.labels_added.length
        : 0;
      return checked > 0 || passed > 0 || offered > 0 || labelsAdded > 0;
    });
  const canClaimInspection =
    normalizedRole === "qc" &&
    !hasActiveInspectionRecords &&
    (qc?.quantities?.qc_checked || 0) === 0;
  const canUpdateQc =
    isAdmin ||
    (!isInspectionDone &&
      normalizedRole === "qc" &&
      qcIsPending &&
      (assignedInspectorId === String(userId) || canClaimInspection));

  const sortedLabels = useMemo(() => normalizeLabels(qc?.labels), [qc?.labels]);
  const backTarget = useMemo(() => {
    const fromQcList = String(location.state?.fromQcList || "").trim();
    if (
      fromQcList &&
      fromQcList.startsWith("/qc") &&
      !fromQcList.startsWith("/qc/")
    ) {
      return fromQcList;
    }
    return "/qc";
  }, [location.state]);
  const hasQcListBackState = useMemo(() => {
    const fromQcList = String(location.state?.fromQcList || "").trim();
    return (
      Boolean(fromQcList) &&
      fromQcList.startsWith("/qc") &&
      !fromQcList.startsWith("/qc/")
    );
  }, [location.state]);

  const handleBackNavigation = useCallback(() => {
    if (hasQcListBackState) {
      navigate(-1);
      return;
    }
    navigate(backTarget, { replace: true });
  }, [backTarget, hasQcListBackState, navigate]);

  const labelRange = sortedLabels.length
    ? `${sortedLabels[0]} - ${sortedLabels[sortedLabels.length - 1]}`
    : "None";
  const labelRangesText = useMemo(() => {
    const ranges = [];
    const seen = new Set();

    (qc?.inspection_record || []).forEach((record) => {
      (record?.label_ranges || []).forEach((range) => {
        const start = Number(range?.start);
        const end = Number(range?.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;

        const key = `${start}-${end}`;
        if (seen.has(key)) return;
        seen.add(key);
        ranges.push(key);
      });
    });

    return ranges.length > 0 ? ranges.join(" | ") : "None";
  }, [qc?.inspection_record]);
  const barcodeValue = qc?.barcode > 0 ? String(qc.barcode) : "";

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
  const itemMasterDetails = useMemo(() => {
    const itemMaster = qc?.item_master || {};
    const fallbackBrand = Array.isArray(itemMaster?.brands)
      ? itemMaster.brands.find((brand) => String(brand || "").trim())
      : "";
    const brandName = String(itemMaster?.brand_name || fallbackBrand || "").trim();
    const inspectedCbm = String(
      itemMaster?.cbm?.inspected_total ?? itemMaster?.cbm?.total ?? "0",
    ).trim();
    const calculatedCbm = String(
      itemMaster?.cbm?.calculated_total ?? "0",
    ).trim();
    const netWeight = Number(itemMaster?.weight?.net ?? 0);
    const grossWeight = Number(itemMaster?.weight?.gross ?? 0);

    return {
      code: String(itemMaster?.code || qc?.item?.item_code || "N/A").trim() || "N/A",
      description:
        String(itemMaster?.description || itemMaster?.name || "N/A").trim() || "N/A",
      brandName: brandName || "N/A",
      weightNet: Number.isFinite(netWeight) ? netWeight : 0,
      weightGross: Number.isFinite(grossWeight) ? grossWeight : 0,
      itemLbh: formatLbhValue(itemMaster?.item_LBH),
      boxLbh: formatLbhValue(itemMaster?.box_LBH),
      inspectedCbm: isPositiveCbmValue(inspectedCbm) ? inspectedCbm : "Not Set",
      calculatedCbm: isPositiveCbmValue(calculatedCbm) ? calculatedCbm : "Not Set",
    };
  }, [qc]);

  const requestInspectionTimeline = useMemo(() => {
    const requestHistory = Array.isArray(qc?.request_history)
      ? qc.request_history
      : [];
    const inspectionHistory = Array.isArray(qc?.inspection_record)
      ? qc.inspection_record
      : [];

    const requestSnapshotsAsc = [...requestHistory]
      .map((request) => {
        const requestTime = Math.max(
          toTimestamp(request?.request_date),
          toTimestamp(request?.createdAt),
        );
        return {
          ...request,
          __requestTime: requestTime,
        };
      })
      .sort((a, b) => a.__requestTime - b.__requestTime);

    const resolveRequestForInspection = (inspectionDate, createdAt) => {
      if (requestSnapshotsAsc.length === 0) return null;
      const inspectionTime = Math.max(
        toTimestamp(inspectionDate),
        toTimestamp(createdAt),
      );

      if (!inspectionTime) {
        return requestSnapshotsAsc[requestSnapshotsAsc.length - 1];
      }

      let matched = null;
      for (const request of requestSnapshotsAsc) {
        if (request.__requestTime <= inspectionTime) {
          matched = request;
        }
      }

      return matched || requestSnapshotsAsc[0];
    };

    // const requestRows = requestSnapshotsAsc.map((request, index) => ({
    //   key: `request-${request?._id || index}`,
    //   rowType: "Request",
    //   sortTime: request.__requestTime || 0,
    //   requestDate: request?.request_date || "",
    //   inspectionDate: "",
    //   inspectorName: request?.inspector?.name || "N/A",
    //   requestedQty: request?.quantity_requested ?? 0,
    //   offeredQty: "-",
    //   inspectedQty: "-",
    //   passedQty: "-",
    //   cbmTotal: "-",
    //   pendingAfter: "-",
    //   remarks: request?.remarks || "QC aligned",
    // }));

    const inspectionRows = inspectionHistory.map((record, index) => {
      const linkedRequest = resolveRequestForInspection(
        record?.inspection_date,
        record?.createdAt,
      );
      const inspectionCbm = record?.cbm?.total;
      const cbmValue = isPositiveCbmValue(inspectionCbm)
        ? String(inspectionCbm)
        : "Not Set";

      return {
        key: `inspection-${record?._id || index}`,
        recordId: record?._id || null,
        rowType: "Inspection",
        sortTime:
          toTimestamp(record?.inspection_date) ||
          toTimestamp(record?.createdAt),
        requestDate: record?.requested_date || linkedRequest?.request_date || "",
        inspectionDate: record?.inspection_date || record?.createdAt || "",
        inspectorName: record?.inspector?.name || "N/A",
        requestedQty:record?.vendor_requested ??
          linkedRequest?.quantity_requested ??  0,
        offeredQty: record?.vendor_offered ?? 0,
        inspectedQty: record?.checked ?? 0,
        passedQty: record?.passed ?? 0,
        cbmTotal: cbmValue,
        pendingAfter: record?.pending_after ?? 0,
        remarks: record?.remarks || "None",
      };
    });

    return [ ...inspectionRows].sort(
      (a, b) => (b.sortTime || 0) - (a.sortTime || 0),
    );
  }, [qc?.request_history, qc?.inspection_record]);

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

  const handleExportPdf = useCallback(async () => {
    if (!qcDetailsRef.current || exportingPdf) return;

    try {
      setExportingPdf(true);
      const target = qcDetailsRef.current;
      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        windowWidth: Math.max(target.scrollWidth, target.clientWidth),
        windowHeight: Math.max(target.scrollHeight, target.clientHeight),
        scrollX: 0,
        scrollY: -window.scrollY,
        onclone: (clonedDoc) => {
          const clonedRoot = clonedDoc.querySelector("[data-qc-pdf-root='true']");
          if (!clonedRoot) return;
          clonedRoot.querySelectorAll("button, .btn").forEach((node) => {
            node.style.display = "none";
          });
        },
      });

      const imageData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 18;
      const printableWidth = pageWidth - margin * 2;
      const printableHeight = pageHeight - margin * 2;
      const imageHeight = (canvas.height * printableWidth) / canvas.width;

      let heightLeft = imageHeight;
      let yPosition = margin;

      pdf.addImage(
        imageData,
        "PNG",
        margin,
        yPosition,
        printableWidth,
        imageHeight,
        undefined,
        "FAST",
      );

      heightLeft -= printableHeight;
      while (heightLeft > 0) {
        pdf.addPage();
        yPosition = margin - (imageHeight - heightLeft);
        pdf.addImage(
          imageData,
          "PNG",
          margin,
          yPosition,
          printableWidth,
          imageHeight,
          undefined,
          "FAST",
        );
        heightLeft -= printableHeight;
      }

      const orderId = String(qc?.order?.order_id || id || "qc").trim() || "qc";
      const safeOrderId = orderId.replace(/[^a-zA-Z0-9_-]/g, "_");
      pdf.save(`qc-details-${safeOrderId}.pdf`);
    } catch (error) {
      console.error("Export QC PDF Error:", error);
      alert("Failed to export QC details as PDF.");
    } finally {
      setExportingPdf(false);
    }
  }, [exportingPdf, id, qc?.order?.order_id]);

  const handleDeleteInspectionRecord = useCallback(
    async (recordId) => {
      if (!isOnlyAdmin || !recordId) return;

      const confirmed = window.confirm(
        "Are you sure you want to delete this inspection record?",
      );
      if (!confirmed) return;

      try {
        setDeletingInspectionId(String(recordId));
        await api.delete(`/qc/${id}/inspection-record/${recordId}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        });
        await fetchQcDetails();
      } catch (err) {
        console.error(err);
        alert(
          err?.response?.data?.message
            || "Failed to delete inspection record.",
        );
      } finally {
        setDeletingInspectionId("");
      }
    },
    [fetchQcDetails, id, isOnlyAdmin],
  );

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

      <div className="page-shell py-3" ref={qcDetailsRef} data-qc-pdf-root="true">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={handleBackNavigation}
          >
            Back
          </button>
          <h2 className="h4 mb-0">QC Details</h2>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={handleExportPdf}
            disabled={exportingPdf}
          >
            {exportingPdf ? "Exporting..." : "Export PDF"}
          </button>
        </div>

        <div className="card om-card">
          <div className="card-body d-grid gap-4">
            <section>
              <h3 className="h6 mb-3">{`Order Information | ${qc.order.order_id} | ${qc.order.brand} | ${qc.order.vendor} |  Request Date: ${formatDateDDMMYYYY(qc.request_date)}`}</h3>
              <h3 className="h6 mb-3">{`Status: ${qc.order.status} | Inspector: ${qc?.inspector?.name}`}</h3>
              <div className="qc-order-inline-grid">
                <InfoBox compact label="Item Code" value={qc.item.item_code} />
                <InfoBox
                  compact
                  label="Description"
                  value={qc.item.description}
                />
                <InfoBox
                  compact
                  label="Order Quantity"
                  value={qc.quantities.client_demand}
                />
                <InfoBox
                  compact
                  label="Passed"
                  value={qc.quantities.qc_passed}
                />
                <InfoBox
                  compact
                  label="Pending"
                  value={qc.quantities.pending}
                />
              </div>
            </section>

            <section>
              <h3 className="h6 mb-3">Item Master Details</h3>
              <div className="row g-3">
                <InfoBox label="Net Weight" value={itemMasterDetails.weightNet} />
                <InfoBox
                  label="Gross Weight"
                  value={itemMasterDetails.weightGross}
                />
                <InfoBox label="Item LBH" value={itemMasterDetails.itemLbh} />
                <InfoBox label="Box LBH" value={itemMasterDetails.boxLbh} />
                <InfoBox
                  label="Inspected CBM"
                  value={itemMasterDetails.inspectedCbm}
                />
                <InfoBox
                  label="Calculated CBM"
                  value={itemMasterDetails.calculatedCbm}
                />
              </div>
            </section>

            <section>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h3 className="h6 mb-0">Request And Inspection Records</h3>
                {isAdmin && (
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => setShowEditInspectionModal(true)}
                    disabled={!Array.isArray(qc?.inspection_record) || qc.inspection_record.length === 0}
                  >
                    Edit Records
                  </button>
                )}
              </div>
              {requestInspectionTimeline.length > 0 ? (
                <div className="table-responsive">
                  <table className="table table-sm table-striped align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Request Date</th>
                        <th>Inspection Date</th>
                        <th>Inspector</th>
                        <th>Requested</th>
                        <th>Offered</th>
                        <th>Inspected</th>
                        <th>Passed</th>
                        <th>CBM</th>
                        <th>Pending</th>
                        <th>Remarks</th>
                        {isOnlyAdmin && <th>Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {requestInspectionTimeline.map((row) => (
                        <tr key={row.key}>
                          <td>{formatDateDDMMYYYY(row.requestDate)}</td>
                          <td>{formatDateDDMMYYYY(row.inspectionDate)}</td>
                          <td>{row.inspectorName}</td>
                          <td>{row.requestedQty}</td>
                          <td>{row.offeredQty}</td>
                          <td>{row.inspectedQty}</td>
                          <td>{row.passedQty}</td>
                          <td>{row.cbmTotal}</td>
                          <td>{row.pendingAfter}</td>
                          <td>{row.remarks}</td>
                          {isOnlyAdmin && (
                            <td>
                              {row.rowType === "Inspection" && row.recordId ? (
                                <button
                                  type="button"
                                  className="btn btn-outline-danger btn-sm"
                                  disabled={deletingInspectionId === String(row.recordId)}
                                  onClick={() => handleDeleteInspectionRecord(row.recordId)}
                                >
                                  {deletingInspectionId === String(row.recordId)
                                    ? "Deleting..."
                                    : "Delete"}
                                </button>
                              ) : (
                                <span className="text-secondary small">N/A</span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-secondary small">
                  No request or inspection records yet.
                </div>
              )}
            </section>



            <section>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h3 className="h6 mb-0">Shipping Details</h3>
                {canShowEditShippingButton && (
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => setShowEditShippingModal(true)}
                  >
                    Edit Shipping
                  </button>
                )}
              </div>
              {!hasShippingRecords ? (
                <div className="alert alert-success py-2 mb-0">
                  Shipping Pending
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm table-striped align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Stuffing Date</th>
                        <th>Container Number</th>
                        <th>Quantity</th>
                        <th>Remaining</th>
                        <th>Remaining Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qc.order.shipment.map((record) => (
                        <tr key={record._id}>
                          <td>
                            {formatDateDDMMYYYY(
                              record?.stuffing_date || record?.createdAt,
                            )}
                          </td>
                          <td>{record?.container || "N/A"}</td>
                          <td>{record?.quantity ?? 0}</td>
                          <td>{ record?.pending ?? 0}</td>
                          <td>{ record?.remaining_remarks ?? "None"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h3 className="h6 mb-3">QC Notes</h3>
              <div className="row g-3">
                <InfoBox label="Labels" value={labelRange} />
                <InfoBox label="Label Ranges" value={labelRangesText} />
                <InfoBox label="Remarks" value={qc.remarks || "None"} />
              </div>
            </section>

            <section>
              <h3 className="h6 mb-3">QC Attributes</h3>
              <div className="row g-3 mb-3">
                <InfoBox
                  label="CBM Total"
                  value={
                    isPositiveCbmValue(cbmData.total)
                      ? cbmData.total
                      : "Not Set"
                  }
                />
                <InfoBox
                  label="Packed Size"
                  value={qc.packed_size ? "Yes" : "No"}
                />
                <InfoBox
                  label="Finishing"
                  value={qc.finishing ? "Yes" : "No"}
                />
                <InfoBox label="Branding" value={qc.branding ? "Yes" : "No"} />
              </div>

              <div className="row g-3">
                <div className="col-lg-6">
                  <div className="qc-info-label">Barcode</div>
                  <div className="qc-info-value">
                    {barcodeValue || "Not Set"}
                  </div>
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
              {canFinalizeShipping &&
                ["Inspection Done", "Partial Shipped"].includes(
                  qc?.order?.status,
                ) && (
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setShowShippingModal(true)}
                  >
                    Finalize Shipping
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
                    : isInspectionDone
                      ? "After inspection is done, only admin can update this record."
                      : normalizedRole === "qc" &&
                          assignedInspectorId === String(userId)
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

      {showShippingModal && (
        <ShippingModal
          order={qc?.order}
          onClose={() => setShowShippingModal(false)}
          onSuccess={() => {
            setShowShippingModal(false);
            fetchQcDetails();
          }}
        />
      )}

      {showEditShippingModal && canShowEditShippingButton && (
        <EditOrderModal
          order={qc?.order}
          onClose={() => setShowEditShippingModal(false)}
          onSuccess={() => {
            setShowEditShippingModal(false);
            fetchQcDetails();
          }}
        />
      )}

      {showEditInspectionModal && (
        <EditInspectionRecordsModal
          qc={qc}
          onClose={() => setShowEditInspectionModal(false)}
          onSuccess={() => {
            setShowEditInspectionModal(false);
            fetchQcDetails();
          }}
        />
      )}
    </>
  );
};

export default QcDetails;
