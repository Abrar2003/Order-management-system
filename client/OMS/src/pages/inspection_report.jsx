import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Barcode from "react-barcode";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { formatDateDDMMYYYY } from "../utils/date";
import { formatPositiveCbm } from "../utils/cbm";
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

const hasCompletePositiveLbh = (value = {}) => {
  const length = Number(value?.L || 0);
  const breadth = Number(value?.B || 0);
  const height = Number(value?.H || 0);
  return (
    Number.isFinite(length)
    && Number.isFinite(breadth)
    && Number.isFinite(height)
    && length > 0
    && breadth > 0
    && height > 0
  );
};

const toDisplayValue = (value, fallback = "N/A") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

const getBrandKey = (value) => String(value || "").trim().toLowerCase();

const toBrandLogoDataUrl = (logoObj) => {
  const raw = logoObj?.data?.data || logoObj?.data;
  if (!Array.isArray(raw) || raw.length === 0) return "";

  let binary = "";
  raw.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return `data:image/webp;base64,${window.btoa(binary)}`;
};

const toDisplayNumber = (value, fallback = "Not Set") => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toComparableValue = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const LBH_REGEX = /^(-?\d+(?:\.\d+)?)\s*x\s*(-?\d+(?:\.\d+)?)\s*x\s*(-?\d+(?:\.\d+)?)$/i;

const parseLbhString = (value) => {
  const normalized = String(value ?? "").trim();
  const match = normalized.match(LBH_REGEX);
  if (!match) return null;

  const length = Number(match[1]);
  const breadth = Number(match[2]);
  const height = Number(match[3]);
  if (!Number.isFinite(length) || !Number.isFinite(breadth) || !Number.isFinite(height)) {
    return null;
  }

  return { L: length, B: breadth, H: height };
};

const formatDifferenceNumber = (value) => {
  const numeric = Math.abs(Number(value));
  if (!Number.isFinite(numeric)) return "0";
  if (Number.isInteger(numeric)) return String(numeric);
  return numeric.toFixed(2).replace(/\.?0+$/, "");
};

const InspectionReport = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const reportRef = useRef(null);

  const [qc, setQc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [brandLogoSrc, setBrandLogoSrc] = useState("");

  const backTarget = useMemo(() => {
    const fromQcDetails = String(location.state?.fromQcDetails || "").trim();
    if (fromQcDetails.startsWith("/qc/")) {
      return fromQcDetails;
    }
    return `/qc/${encodeURIComponent(id)}`;
  }, [id, location.state]);

  const orderInfo = useMemo(() => {
    const orderQuantity = Number(qc?.order?.quantity ?? qc?.quantities?.client_demand ?? 0);
    return {
      orderId: toDisplayValue(qc?.order?.order_id),
      brand: toDisplayValue(qc?.order?.brand),
      vendor: toDisplayValue(qc?.order?.vendor),
      requestDate: formatDateDDMMYYYY(qc?.request_date),
      requestType: toDisplayValue(qc?.request_type, "N/A"),
      orderQuantity: Number.isFinite(orderQuantity) ? String(orderQuantity) : "0",
      status: toDisplayValue(qc?.order?.status),
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

  const inspectionRemarkRows = useMemo(
    () =>
      inspectionRows.filter((row) => {
        const remark = String(row?.remarks || "").trim();
        return remark && remark.toLowerCase() !== "none";
      }),
    [inspectionRows],
  );

  const labelRanges = useMemo(() => {
    const ranges = [];
    const seen = new Set();
    const inspectionRecords = Array.isArray(qc?.inspection_record) ? qc.inspection_record : [];

    inspectionRecords.forEach((record) => {
      const recordRanges = Array.isArray(record?.label_ranges) ? record.label_ranges : [];
      recordRanges.forEach((range) => {
        const start = Number(range?.start);
        const end = Number(range?.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        const normalizedStart = Math.min(start, end);
        const normalizedEnd = Math.max(start, end);
        const key = `${normalizedStart}-${normalizedEnd}`;
        if (seen.has(key)) return;
        seen.add(key);
        ranges.push({ start: normalizedStart, end: normalizedEnd });
      });
    });

    return ranges.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return a.end - b.end;
    });
  }, [qc?.inspection_record]);

  const itemMasterSummary = useMemo(() => {
    const itemMaster = qc?.item_master || {};
    const pisItemLbh = formatLbhValue(itemMaster?.pis_item_LBH || itemMaster?.item_LBH);
    const checkedItemLbh = formatLbhValue(
      itemMaster?.inspected_item_LBH || itemMaster?.item_LBH,
    );
    const pisPackedSize = formatLbhValue(
      itemMaster?.pis_box_LBH || itemMaster?.pis_item_LBH || itemMaster?.box_LBH || itemMaster?.item_LBH,
    );
    const inspectedTopLbh =
      itemMaster?.inspected_box_top_LBH
      || itemMaster?.inspected_top_LBH
      || {};
    const inspectedBottomLbh =
      itemMaster?.inspected_box_bottom_LBH
      || itemMaster?.inspected_bottom_LBH
      || {};
    const checkedTopSize = formatLbhValue(inspectedTopLbh);
    const checkedBottomSize = formatLbhValue(inspectedBottomLbh);
    const showTopSize = checkedTopSize !== "Not Set";
    const showBottomSize = checkedBottomSize !== "Not Set";
    const checkedPackedSize = hasCompletePositiveLbh(inspectedTopLbh)
      && hasCompletePositiveLbh(inspectedBottomLbh)
      ? `Top: ${formatLbhValue(inspectedTopLbh)} | Bottom: ${formatLbhValue(inspectedBottomLbh)}`
      : formatLbhValue(
          itemMaster?.inspected_box_LBH
          || itemMaster?.inspected_item_LBH
          || itemMaster?.box_LBH
          || itemMaster?.item_LBH,
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
    const calculatedInspectedCbmRaw =
      itemMaster?.cbm?.calculated_inspected_total ??
      itemMaster?.cbm?.calculated_total ??
      itemMaster?.cbm?.qc_total ??
      qc?.cbm?.total ??
      "0";
    const calculatedPisCbmRaw =
      itemMaster?.cbm?.calculated_pis_total ??
      "0";
    const pisCbmTopRaw =
      itemMaster?.cbm?.top ??
      "0";
    const pisCbmBottomRaw =
      itemMaster?.cbm?.bottom ??
      "0";
    const checkedCbmTopRaw =
      itemMaster?.cbm?.inspected_top ??
      itemMaster?.cbm?.qc_top ??
      qc?.cbm?.top ??
      "0";
    const checkedCbmBottomRaw =
      itemMaster?.cbm?.inspected_bottom ??
      itemMaster?.cbm?.qc_bottom ??
      qc?.cbm?.bottom ??
      "0";
    const calculatedInspectedCbm = formatPositiveCbm(calculatedInspectedCbmRaw, "Not Set");
    const calculatedPisCbm = formatPositiveCbm(calculatedPisCbmRaw, "Not Set");
    const pisCbmTop = formatPositiveCbm(pisCbmTopRaw, "Not Set");
    const pisCbmBottom = formatPositiveCbm(pisCbmBottomRaw, "Not Set");
    const checkedCbmTop = formatPositiveCbm(checkedCbmTopRaw, "Not Set");
    const checkedCbmBottom = formatPositiveCbm(checkedCbmBottomRaw, "Not Set");
    const showCbmTop = pisCbmTop !== "Not Set" || checkedCbmTop !== "Not Set";
    const showCbmBottom = pisCbmBottom !== "Not Set" || checkedCbmBottom !== "Not Set";
    const inspectedTotalCbm = formatPositiveCbm(itemMaster?.cbm?.inspected_total, "Not Set");
    const baseTotalCbm = formatPositiveCbm(itemMaster?.cbm?.total, "Not Set");
    const checkedCbmTotal = calculatedInspectedCbm !== "Not Set"
      ? calculatedInspectedCbm
      : (inspectedTotalCbm !== "Not Set" ? inspectedTotalCbm : baseTotalCbm);
    const barcodeValue =
      Number(qc?.barcode || 0) > 0 ? String(qc.barcode).trim() : "Not Set";

    const rows = [
      { attribute: "Item Size (L x B x H)", pis: pisItemLbh, checked: checkedItemLbh },
      { attribute: "Packed Size (L x B x H)", pis: pisPackedSize, checked: checkedPackedSize },
      ...(showTopSize ? [{ attribute: "Top Size (L x B x H)", pis: "Not Set", checked: checkedTopSize }] : []),
      ...(showBottomSize ? [{ attribute: "Bottom Size (L x B x H)", pis: "Not Set", checked: checkedBottomSize }] : []),
      { attribute: "Net Weight", pis: pisNetWeight, checked: checkedNetWeight },
      { attribute: "Gross Weight", pis: pisGrossWeight, checked: checkedGrossWeight },
      ...(showCbmTop ? [{ attribute: "CBM Top", pis: pisCbmTop, checked: checkedCbmTop }] : []),
      ...(showCbmBottom ? [{ attribute: "CBM Bottom", pis: pisCbmBottom, checked: checkedCbmBottom }] : []),
      { attribute: "CBM", pis: calculatedPisCbm, checked: checkedCbmTotal },
      { attribute: "Barcode", pis: "N/A", checked: barcodeValue },
    ];

    return {
      barcodeValue,
      rows,
    };
  }, [qc]);

  const differenceLogs = useMemo(() => {
    const rows = Array.isArray(itemMasterSummary?.rows) ? itemMasterSummary.rows : [];
    const logs = [];
    const dimensionNames = {
      L: "length",
      B: "breadth",
      H: "height",
    };

    rows.forEach((row) => {
      const attribute = String(row?.attribute || "").trim();
      const pisValue = String(row?.pis ?? "").trim();
      const checkedValue = String(row?.checked ?? "").trim();
      const normalizedPis = toComparableValue(pisValue);
      const normalizedChecked = toComparableValue(checkedValue);

      if (!attribute || !pisValue || !checkedValue) return;
      if (normalizedPis === normalizedChecked) return;

      const isMissingPis = normalizedPis === "not set" || normalizedPis === "n/a";
      const isMissingChecked = normalizedChecked === "not set" || normalizedChecked === "n/a";

      if (isMissingPis && !isMissingChecked) {
        logs.push(`For ${attribute}, inspected value is ${checkedValue} while PIS value is not set.`);
        return;
      }
      if (!isMissingPis && isMissingChecked) {
        logs.push(`For ${attribute}, PIS value is ${pisValue} while inspected value is not set.`);
        return;
      }
      if (isMissingPis && isMissingChecked) return;

      const parsedPisLbh = parseLbhString(pisValue);
      const parsedCheckedLbh = parseLbhString(checkedValue);
      if (parsedPisLbh && parsedCheckedLbh) {
        let hasDimensionDifference = false;
        (["L", "B", "H"]).forEach((axis) => {
          const pisAxisValue = Number(parsedPisLbh[axis]);
          const checkedAxisValue = Number(parsedCheckedLbh[axis]);
          const delta = checkedAxisValue - pisAxisValue;
          if (!Number.isFinite(delta) || Math.abs(delta) < 0.0001) return;
          hasDimensionDifference = true;
          const direction = delta > 0 ? "greater" : "smaller";
          logs.push(
            `For ${attribute}, inspected ${dimensionNames[axis]} is ${formatDifferenceNumber(delta)} cm ${direction} than PIS size.`,
          );
        });

        if (hasDimensionDifference) return;
      }

      const pisNumeric = Number(pisValue);
      const checkedNumeric = Number(checkedValue);
      if (Number.isFinite(pisNumeric) && Number.isFinite(checkedNumeric)) {
        const delta = checkedNumeric - pisNumeric;
        if (Math.abs(delta) >= 0.0001) {
          const direction = delta > 0 ? "greater" : "smaller";
          logs.push(
            `For ${attribute}, inspected value is ${formatDifferenceNumber(delta)} ${direction} than PIS value.`,
          );
        }
        return;
      }

      logs.push(`For ${attribute}, inspected value is ${checkedValue} while PIS value is ${pisValue}.`);
    });

    return logs;
  }, [itemMasterSummary?.rows]);

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

  useEffect(() => {
    const brandName = String(qc?.order?.brand || "").trim();
    if (!brandName) {
      setBrandLogoSrc("");
      return;
    }

    let isMounted = true;

    const fetchBrandDetails = async () => {
      try {
        const response = await api.get("/brands/");
        if (!isMounted) return;

        const brands = Array.isArray(response?.data?.data) ? response.data.data : [];
        const matchedBrand = brands.find(
          (brand) => getBrandKey(brand?.name) === getBrandKey(brandName),
        );
        setBrandLogoSrc(toBrandLogoDataUrl(matchedBrand?.logo));
      } catch (error) {
        if (isMounted) {
          setBrandLogoSrc("");
        }
      }
    };

    fetchBrandDetails();

    return () => {
      isMounted = false;
    };
  }, [qc?.order?.brand]);

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
                <div className="d-flex justify-center align-center text-center mb-4">
                     <h3 className="h3 m-auto">QC Report</h3>
                </div>
             
              <div className="inspection-report-summary-block">
                <div className="inspection-report-summary-column inspection-report-summary-primary">
                  <div className="inspection-report-summary-line">
                    <span><strong>Brand:</strong> {orderInfo.brand}</span>
                    <span><strong>Vendor:</strong> {orderInfo.vendor}</span>
                  </div>
                  <div className="inspection-report-summary-line">
                    <span><strong>Order ID:</strong> {orderInfo.orderId}</span>
                    <span><strong>Item Code:</strong> {orderInfo.itemCode}</span>
                    <span><strong>Description:</strong> {orderInfo.itemDescription}</span>
                  </div>
                  <div className="inspection-report-summary-line">
                    <span><strong>Request Date:</strong> {orderInfo.requestDate}</span>
                  </div>
                  <div className="inspection-report-summary-line">
                    <span><strong>Request Type:</strong> {orderInfo.requestType}</span>
                    <span><strong>Order Quantity:</strong> {orderInfo.orderQuantity}</span>
                    <span><strong>Status:</strong> {orderInfo.status}</span>
                  </div>
                </div>
                <div className="inspection-report-summary-column inspection-report-summary-media">
                  <div className="inspection-report-brand-panel">
                    {brandLogoSrc ? (
                      <img
                        src={brandLogoSrc}
                        alt={`${orderInfo.brand} logo`}
                        className="inspection-report-brand-logo"
                      />
                    ) : (
                      <div className="inspection-report-media-empty">
                        Brand logo not available
                      </div>
                    )}
                  </div>
                </div>
                <div className="inspection-report-summary-column inspection-report-summary-media">
                  <div className="inspection-report-image-skeleton">
                    <span>Product Image not available yet</span>
                  </div>
                </div>
              </div>
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
                <table className="table table-sm table-striped table-bordered align-middle mb-0 inspection-report-packing-table">
                  <thead>
                    <tr>
                      <th>Attribute</th>
                      <th>PIS</th>
                      <th>Inspected</th>
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

              {itemMasterSummary.barcodeValue !== "Not Set" && (
                <div className="qc-barcode-wrapper">
                  <Barcode value={itemMasterSummary.barcodeValue} />
                </div>
              )} 
            </section>
            <section>
              <h3 className="h6 mb-3">Difference Logs (PIS vs Inspected)</h3>
              {differenceLogs.length > 0 ? (
                <ul className="inspection-report-diff-logs">
                  {differenceLogs.map((log, index) => (
                    <li key={`diff-log-${index}`}>{log}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-secondary small">No differences found between PIS and inspected values.</div>
              )}
            </section>

            <section>
              <h3 className="h6 mb-3">Label Ranges And Remarks</h3>
              <div className="inspection-report-notes-block">
                <div className="mb-3">
                  <div className="fw-semibold mb-2">Label Ranges</div>
                  {labelRanges.length > 0 ? (
                    <div className="inspection-report-label-list">
                      {labelRanges.map((range, index) => (
                        <span
                          key={`label-range-${range.start}-${range.end}-${index}`}
                          className="inspection-report-label-chip"
                        >
                          {range.start} - {range.end}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-secondary small">No label ranges added.</div>
                  )}
                </div>

                <div>
                  <div className="fw-semibold mb-2">Inspection Remarks</div>
                  {inspectionRemarkRows.length > 0 ? (
                    <div className="table-responsive">
                      <table className="table table-sm table-striped align-middle mb-0">
                        <thead>
                          <tr>
                            <th>Inspection Date</th>
                            <th>Inspector</th>
                            <th>Remark</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inspectionRemarkRows.map((row) => (
                            <tr key={`remark-${row.key}`}>
                              <td>{formatDateDDMMYYYY(row.inspectionDate)}</td>
                              <td>{row.inspectorName}</td>
                              <td>{row.remarks}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-secondary small">No inspection remarks found.</div>
                  )}
                </div>
              </div>
            </section>

          </div>
        </div>
      </div>
    </>
  );
};

export default InspectionReport;
