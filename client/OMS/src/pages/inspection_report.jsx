import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Barcode from "react-barcode";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { formatDateDDMMYYYY } from "../utils/date";
import "../App.css";

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

const toDisplayValue = (value, fallback = "N/A") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

const isPositiveCbmValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};

const InspectionReport = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const reportRef = useRef(null);

  const [qc, setQc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);

  const backTarget = useMemo(() => {
    const fromQcDetails = String(location.state?.fromQcDetails || "").trim();
    if (fromQcDetails.startsWith("/qc/")) {
      return fromQcDetails;
    }
    return `/qc/${encodeURIComponent(id)}`;
  }, [id, location.state]);

  const orderInfo = useMemo(() => {
    return {
      orderId: toDisplayValue(qc?.order?.order_id),
      brand: toDisplayValue(qc?.order?.brand),
      vendor: toDisplayValue(qc?.order?.vendor),
      requestDate: formatDateDDMMYYYY(qc?.request_date),
      itemCode: toDisplayValue(qc?.item?.item_code),
      itemDescription: toDisplayValue(qc?.item?.description),
    };
  }, [qc]);

  const inspectionRows = useMemo(() => {
    const sourceRows = Array.isArray(qc?.inspection_record) ? qc.inspection_record : [];

    return sourceRows
      .map((record, index) => ({
        key: String(record?._id || `inspection-${index}`),
        requestDate: record?.requested_date || qc?.request_date || "",
        inspectionDate: record?.inspection_date || record?.createdAt || "",
        inspectorName: toDisplayValue(record?.inspector?.name, "N/A"),
        requestedQty: Number(record?.vendor_requested ?? 0),
        offeredQty: Number(record?.vendor_offered ?? 0),
        inspectedQty: Number(record?.checked ?? 0),
        passedQty: Number(record?.passed ?? 0),
        pendingAfter: Number(record?.pending_after ?? 0),
        remarks: toDisplayValue(record?.remarks, "None"),
        sortTime:
          toTimestamp(record?.inspection_date) ||
          toTimestamp(record?.createdAt) ||
          toTimestamp(record?.requested_date),
      }))
      .sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));
  }, [qc?.inspection_record, qc?.request_date]);

  const itemMasterSummary = useMemo(() => {
    const itemMaster = qc?.item_master || {};
    const netWeight = Number(itemMaster?.weight?.net ?? 0);
    const grossWeight = Number(itemMaster?.weight?.gross ?? 0);
    const packedSize = formatLbhValue(itemMaster?.box_LBH || itemMaster?.item_LBH);
    const inspectedCbmRaw =
      itemMaster?.cbm?.inspected_total ??
      itemMaster?.cbm?.total ??
      qc?.cbm?.total ??
      "0";
    const inspectedCbm = isPositiveCbmValue(inspectedCbmRaw)
      ? String(inspectedCbmRaw).trim()
      : "Not Set";
    const barcodeValue =
      Number(qc?.barcode || 0) > 0 ? String(qc.barcode).trim() : "Not Set";

    return {
      packedSize,
      inspectedCbm,
      netWeight: Number.isFinite(netWeight) ? netWeight : 0,
      grossWeight: Number.isFinite(grossWeight) ? grossWeight : 0,
      barcodeValue,
      checkpoints: [
        { label: "Packed Size Check", value: qc?.packed_size ? "Yes" : "No" },
        { label: "Finishing Check", value: qc?.finishing ? "Yes" : "No" },
        { label: "Branding Check", value: qc?.branding ? "Yes" : "No" },
      ],
    };
  }, [qc]);

  const fetchQcDetails = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get(`/qc/${id}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      setQc(response?.data?.data || null);
    } catch (error) {
      console.error(error);
      setQc(null);
      alert("Failed to load inspection report.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const handleConfirmAndExport = useCallback(async () => {
    if (!reportRef.current || exportingPdf || !qc) return;

    const confirmed = window.confirm(
      "Confirm export of this inspection report snapshot as PDF?",
    );
    if (!confirmed) return;

    try {
      setExportingPdf(true);
      const target = reportRef.current;
      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        windowWidth: Math.max(target.scrollWidth, target.clientWidth),
        windowHeight: Math.max(target.scrollHeight, target.clientHeight),
        scrollX: 0,
        scrollY: -window.scrollY,
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

      let remainingHeight = imageHeight;
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

      remainingHeight -= printableHeight;
      while (remainingHeight > 0) {
        pdf.addPage();
        yPosition = margin - (imageHeight - remainingHeight);
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
        remainingHeight -= printableHeight;
      }

      const orderId = toDisplayValue(qc?.order?.order_id, id || "inspection");
      const safeOrderId = orderId.replace(/[^a-zA-Z0-9_-]/g, "_");
      pdf.save(`inspection-report-${safeOrderId}.pdf`);
    } catch (error) {
      console.error("Inspection report export failed:", error);
      alert("Failed to export inspection report PDF.");
    } finally {
      setExportingPdf(false);
    }
  }, [exportingPdf, id, qc]);

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
        <div className="page-shell py-5 text-center">Inspection report not found</div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(backTarget, { replace: false })}
          >
            Back
          </button>
          <h2 className="h4 mb-0">Inspection Report</h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleConfirmAndExport}
            disabled={exportingPdf}
          >
            {exportingPdf ? "Exporting..." : "Confirm & Export PDF"}
          </button>
        </div>

        <div className="card om-card" ref={reportRef}>
          <div className="card-body d-grid gap-4">
            <section>
              <h3 className="h6 mb-3">Order Summary</h3>
              <ul className="list-group inspection-report-meta-list">
                <li className="list-group-item inspection-report-meta-row">
                  <div className="inspection-report-meta-label">Brand</div>
                  <div className="inspection-report-meta-value">{orderInfo.brand}</div>
                </li>
                <li className="list-group-item inspection-report-meta-row">
                  <div className="inspection-report-meta-label">Vendor</div>
                  <div className="inspection-report-meta-value">{orderInfo.vendor}</div>
                </li>
                <li className="list-group-item inspection-report-meta-row">
                  <div className="inspection-report-meta-label">Order ID</div>
                  <div className="inspection-report-meta-value">{orderInfo.orderId}</div>
                </li>
                <li className="list-group-item inspection-report-meta-row">
                  <div className="inspection-report-meta-label">Item Code</div>
                  <div className="inspection-report-meta-value">{orderInfo.itemCode}</div>
                </li>
                <li className="list-group-item inspection-report-meta-row">
                  <div className="inspection-report-meta-label">Description</div>
                  <div className="inspection-report-meta-value">{orderInfo.itemDescription}</div>
                </li>
                <li className="list-group-item inspection-report-meta-row">
                  <div className="inspection-report-meta-label">Request Date</div>
                  <div className="inspection-report-meta-value">{orderInfo.requestDate}</div>
                </li>
              </ul>
            </section>

            <section>
              <h3 className="h6 mb-3">Inspection Records</h3>
              {inspectionRows.length > 0 ? (
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
                        <th>Pending</th>
                        <th>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inspectionRows.map((row) => (
                        <tr key={row.key}>
                          <td>{formatDateDDMMYYYY(row.requestDate)}</td>
                          <td>{formatDateDDMMYYYY(row.inspectionDate)}</td>
                          <td>{row.inspectorName}</td>
                          <td>{row.requestedQty}</td>
                          <td>{row.offeredQty}</td>
                          <td>{row.inspectedQty}</td>
                          <td>{row.passedQty}</td>
                          <td>{row.pendingAfter}</td>
                          <td>{row.remarks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-secondary small">No inspection records found.</div>
              )}
            </section>

            <section>
              <h3 className="h6 mb-3">Product Packing Details</h3>
              <ul className="list-group mb-3 inspection-report-meta-list">
                <li className="list-group-item inspection-report-meta-row">
                  <div className="inspection-report-meta-label">Inspected CBM</div>
                  <div className="inspection-report-meta-value">{itemMasterSummary.inspectedCbm}</div>
                </li>
                <li className="list-group-item inspection-report-meta-row">
                  <div className="inspection-report-meta-label">Packed Size (L x B x H)</div>
                  <div className="inspection-report-meta-value">{itemMasterSummary.packedSize}</div>
                </li>
                {itemMasterSummary.checkpoints.map((checkpoint) => (
                  <li
                    key={checkpoint.label}
                    className="list-group-item inspection-report-meta-row"
                  >
                    <div className="inspection-report-meta-label">{checkpoint.label}</div>
                    <div className="inspection-report-meta-value">{checkpoint.value}</div>
                  </li>
                ))}
                <li className="list-group-item inspection-report-meta-row">
                  <div className="inspection-report-meta-label">Net Weight</div>
                  <div className="inspection-report-meta-value">{itemMasterSummary.netWeight}</div>
                </li>
                <li className="list-group-item inspection-report-meta-row">
                  <div className="inspection-report-meta-label">Gross Weight</div>
                  <div className="inspection-report-meta-value">{itemMasterSummary.grossWeight}</div>
                </li>
                <li className="list-group-item inspection-report-meta-row">
                  <div className="inspection-report-meta-label">Barcode</div>
                  <div className="inspection-report-meta-value">{itemMasterSummary.barcodeValue}</div>
                </li>
              </ul>

              {itemMasterSummary.barcodeValue !== "Not Set" && (
                <div className="qc-barcode-wrapper">
                  <Barcode value={itemMasterSummary.barcodeValue} />
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </>
  );
};

export default InspectionReport;
