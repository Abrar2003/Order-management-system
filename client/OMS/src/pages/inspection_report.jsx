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

const toDisplayNumber = (value, fallback = "Not Set") => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
    const pisItemLbh = formatLbhValue(itemMaster?.pis_item_LBH || itemMaster?.item_LBH);
    const checkedItemLbh = formatLbhValue(
      itemMaster?.inspected_item_LBH || itemMaster?.item_LBH,
    );
    const pisBoxLbh = formatLbhValue(itemMaster?.pis_box_LBH || itemMaster?.box_LBH);
    const checkedBoxLbh = formatLbhValue(
      itemMaster?.inspected_box_LBH || itemMaster?.box_LBH,
    );
    const pisNetWeight = toDisplayNumber(itemMaster?.pis_weight?.net ?? itemMaster?.weight?.net);
    const checkedNetWeight = toDisplayNumber(
      itemMaster?.inspected_weight?.net ?? itemMaster?.weight?.net,
    );
    const pisGrossWeight = toDisplayNumber(
      itemMaster?.pis_weight?.gross ?? itemMaster?.weight?.gross,
    );
    const checkedGrossWeight = toDisplayNumber(
      itemMaster?.inspected_weight?.gross ?? itemMaster?.weight?.gross,
    );
    const inspectedCbmRaw =
      itemMaster?.cbm?.inspected_total ??
      itemMaster?.cbm?.total ??
      qc?.cbm?.total ??
      "0";
    const pisCbmRaw =
      itemMaster?.cbm?.total ??
      "0";
    const calculatedInspectedCbmRaw =
      itemMaster?.cbm?.calculated_inspected_total ??
      itemMaster?.cbm?.calculated_total ??
      "0";
    const calculatedPisCbmRaw =
      itemMaster?.cbm?.calculated_pis_total ??
      "0";
    const inspectedCbm = isPositiveCbmValue(inspectedCbmRaw)
      ? String(inspectedCbmRaw).trim()
      : "Not Set";
    const pisCbm = isPositiveCbmValue(pisCbmRaw)
      ? String(pisCbmRaw).trim()
      : "Not Set";
    const calculatedInspectedCbm = isPositiveCbmValue(calculatedInspectedCbmRaw)
      ? String(calculatedInspectedCbmRaw).trim()
      : "Not Set";
    const calculatedPisCbm = isPositiveCbmValue(calculatedPisCbmRaw)
      ? String(calculatedPisCbmRaw).trim()
      : "Not Set";
    const barcodeValue =
      Number(qc?.barcode || 0) > 0 ? String(qc.barcode).trim() : "Not Set";

    const rows = [
      { attribute: "Item Size (L x B x H)", pis: pisItemLbh, checked: checkedItemLbh },
      { attribute: "Box Size (L x B x H)", pis: pisBoxLbh, checked: checkedBoxLbh },
      { attribute: "Net Weight", pis: pisNetWeight, checked: checkedNetWeight },
      { attribute: "Gross Weight", pis: pisGrossWeight, checked: checkedGrossWeight },
      { attribute: "CBM", pis: pisCbm, checked: inspectedCbm },
      {
        attribute: "Calculated CBM (LBH)",
        pis: calculatedPisCbm,
        checked: calculatedInspectedCbm,
      },
    ];

    return {
      barcodeValue,
      checks: {
        packedSize: qc?.packed_size ? "Yes" : "No",
        finishing: qc?.finishing ? "Yes" : "No",
        branding: qc?.branding ? "Yes" : "No",
      },
      rows,
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
              <div className="inspection-report-summary-block">
                <div className="inspection-report-summary-line inspection-report-summary-line-two">
                  <div className="inspection-report-summary-field">
                    <div className="inspection-report-summary-label">Brand</div>
                    <div className="inspection-report-summary-value">{orderInfo.brand}</div>
                  </div>
                  <div className="inspection-report-summary-field">
                    <div className="inspection-report-summary-label">Vendor</div>
                    <div className="inspection-report-summary-value">{orderInfo.vendor}</div>
                  </div>
                </div>
                <div className="inspection-report-summary-line inspection-report-summary-line-three">
                  <div className="inspection-report-summary-field">
                    <div className="inspection-report-summary-label">Order ID</div>
                    <div className="inspection-report-summary-value">{orderInfo.orderId}</div>
                  </div>
                  <div className="inspection-report-summary-field">
                    <div className="inspection-report-summary-label">Item Code</div>
                    <div className="inspection-report-summary-value">{orderInfo.itemCode}</div>
                  </div>
                  <div className="inspection-report-summary-field">
                    <div className="inspection-report-summary-label">Description</div>
                    <div className="inspection-report-summary-value">{orderInfo.itemDescription}</div>
                  </div>
                </div>
                <div className="inspection-report-summary-line inspection-report-summary-line-one">
                  <div className="inspection-report-summary-field">
                    <div className="inspection-report-summary-label">Request Date</div>
                    <div className="inspection-report-summary-value">{orderInfo.requestDate}</div>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <h3 className="h6 mb-3">Inspection Records</h3>
              {inspectionRows.length > 0 ? (
                <div className="table-responsive">
                  <table className="table table-sm table-striped table-bordered align-middle mb-0 inspection-report-table-dark">
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
              <div className="table-responsive mb-3">
                <table className="table table-sm table-striped table-bordered align-middle mb-0 inspection-report-packing-table inspection-report-table-dark">
                  <thead>
                    <tr>
                      <th>Attribute</th>
                      <th>PIS</th>
                      <th>Checked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemMasterSummary.rows.map((row) => (
                      <tr key={row.attribute}>
                        <td>{row.attribute}</td>
                        <td>{row.pis}</td>
                        <td>{row.checked}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="inspection-report-checks-line mb-3">
                <span>
                  <strong>Packed Size Check:</strong> {itemMasterSummary.checks.packedSize}
                </span>
                <span>
                  <strong>Finishing Check:</strong> {itemMasterSummary.checks.finishing}
                </span>
                <span>
                  <strong>Branding Check:</strong> {itemMasterSummary.checks.branding}
                </span>
              </div>

              <div className="inspection-report-barcode-stack">
                <div className="inspection-report-barcode-value">
                  <strong>Barcode Value:</strong> {itemMasterSummary.barcodeValue}
                </div>
                {itemMasterSummary.barcodeValue !== "Not Set" && (
                  <div className="qc-barcode-wrapper">
                    <Barcode value={itemMasterSummary.barcodeValue} />
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
};

export default InspectionReport;
