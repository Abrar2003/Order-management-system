import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import ProductAnalyticsTable from "../components/ProductAnalyticsTable";
import ReportInfoBanner from "../components/ReportInfoBanner";
import { formatDateDDMMYYYY } from "../utils/date";
import { exportElementToPdf } from "../services/pdfExport.service";
import "../App.css";

const SECTION_OPTIONS = [
  ["po_delay", "PO-wise delay"],
  ["product_analytics", "Product analytics"],
  ["product_complaints", "Product claims"],
  ["shipping_delay", "Shipping delay by ETD"],
];

const emptySections = () => Object.fromEntries(
  SECTION_OPTIONS.map(([key]) => [key, { rows: [] }]),
);

const formatDays = (value) => {
  if (!Number.isFinite(Number(value))) return "-";
  const days = Number(value);
  if (days === 0) return "On time";
  return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ${days > 0 ? "delayed" : "early"}`;
};

const formatPercent = (value) => Number.isFinite(Number(value))
  ? `${Number(value).toFixed(2)}%`
  : "-";

const statusClass = (status) => {
  if (status === "Delayed") return "text-bg-danger";
  if (status === "Early") return "text-bg-success";
  return "text-bg-secondary";
};

const downloadResponse = (response, fallbackFilename) => {
  const disposition = String(response?.headers?.["content-disposition"] || "");
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackFilename;
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
};

const VendorPerformanceReport = () => {
  const navigate = useNavigate();
  const sectionRefs = useRef({});
  const [vendor, setVendor] = useState("");
  const [vendorOptions, setVendorOptions] = useState([]);
  const [sections, setSections] = useState(emptySections);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSections, setExportSections] = useState(["po_delay"]);
  const [exportFormat, setExportFormat] = useState("xlsx");
  const [exporting, setExporting] = useState(false);

  const loadReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.get("/reports/vendor-performance", {
        params: vendor ? { vendor } : {},
      });
      setVendorOptions(Array.isArray(response?.data?.filters?.vendor_options)
        ? response.data.filters.vendor_options
        : []);
      setSections(response?.data?.sections || emptySections());
    } catch (loadError) {
      setSections(emptySections());
      setError(loadError?.response?.data?.message || "Failed to load vendor performance report.");
    } finally {
      setLoading(false);
    }
  }, [vendor]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const toggleExportSection = (section) => {
    setExportSections((current) => current.includes(section)
      ? current.filter((entry) => entry !== section)
      : [...current, section]);
  };

  const handleExport = async () => {
    if (!vendor || exportSections.length === 0) return;
    try {
      setExporting(true);
      setError("");
      for (const section of exportSections) {
        const label = SECTION_OPTIONS.find(([key]) => key === section)?.[1] || section;
        const filenameBase = `vendor-${vendor.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${section.replace(/_/g, "-")}`;
        if (exportFormat === "pdf") {
          await exportElementToPdf({
            element: sectionRefs.current[section],
            reportKey: "vendor-performance-report",
            filename: `${filenameBase}.pdf`,
            repeatHeader: { title: label, subtitle: `Vendor: ${vendor}` },
          });
        } else {
          const response = await api.get("/reports/vendor-performance/export", {
            params: { vendor, section, format: "xlsx" },
            responseType: "blob",
          });
          downloadResponse(response, `${filenameBase}.xlsx`);
        }
      }
      setExportOpen(false);
    } catch (exportError) {
      setError(exportError?.response?.data?.message || "Failed to export the selected report table.");
    } finally {
      setExporting(false);
    }
  };

  const poRows = sections?.po_delay?.rows || [];
  const productRows = sections?.product_analytics?.rows || [];
  const claimRows = sections?.product_complaints?.rows || [];
  const shippingRows = sections?.shipping_delay?.rows || [];

  return (
    <>
      <Navbar />
      <main className="page-shell py-3">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigate(-1)}>
            Back
          </button>
          <h2 className="h4 mb-0">Detailed Vendor Performance Report</h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!vendor || loading}
            onClick={() => setExportOpen(true)}
          >
            Export selected tables
          </button>
        </div>

        <ReportInfoBanner
          description="Compares one vendor's packed and shipping dates with the effective ETD, product performance, and claims trends."
          dataShown="PO completion dates, ETD variance, product analytics, and claim tenures with the current-versus-previous trend."
          howItWorks="Select a vendor. All data is filtered on the server using the logged-in user's brand and vendor access."
        />

        <div className="card om-card mb-3">
          <div className="card-body row g-2 align-items-end">
            <div className="col-md-5">
              <label className="form-label" htmlFor="vendor-performance-vendor">Vendor</label>
              <select
                id="vendor-performance-vendor"
                className="form-select"
                value={vendor}
                onChange={(event) => setVendor(event.target.value)}
              >
                <option value="">Select a vendor</option>
                {vendorOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <button type="button" className="btn btn-outline-primary" onClick={loadReport} disabled={loading}>
                {loading ? "Loading..." : "Refresh"}
              </button>
            </div>
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        {!vendor && !loading && <div className="alert alert-info">Select a vendor to generate the report.</div>}

        {vendor && !loading && (
          <div className="d-grid gap-3">
            <section className="card om-card" ref={(node) => { sectionRefs.current.po_delay = node; }}>
              <div className="card-header fw-semibold">1. PO-wise delay — complete packed date vs ETD</div>
              <div className="table-responsive">
                <table className="table table-striped align-middle mb-0">
                  <thead><tr><th>PO</th><th>Brand</th><th>Complete packed</th><th>Effective ETD</th><th>Difference</th><th>Status</th><th>Items</th><th>Qty</th></tr></thead>
                  <tbody>{poRows.length ? poRows.map((row) => <tr key={`${row.po}-${row.brand}`} className={row.is_overdue_inspection_pending ? "table-danger" : row.is_inspection_pending ? "table-success" : ""}>
                    <td className="fw-semibold">{row.po}</td><td>{row.brand}</td><td>{row.is_inspection_pending ? "Inspection pending" : formatDateDDMMYYYY(row.packed_date)}</td><td>{formatDateDDMMYYYY(row.etd)}</td><td>{formatDays(row.difference_days)}</td><td><span className={`badge ${row.is_overdue_inspection_pending ? "text-bg-danger" : row.is_inspection_pending ? "text-bg-success" : statusClass(row.status)}`}>{row.status}</span></td><td>{row.item_count}</td><td>{row.total_quantity}</td>
                  </tr>) : <tr><td colSpan="8" className="text-center text-secondary py-3">No completely packed POs with an ETD.</td></tr>}</tbody>
                </table>
              </div>
            </section>

            <section className="card om-card" ref={(node) => { sectionRefs.current.product_analytics = node; }}>
              <div className="card-header fw-semibold">2. Product analytics</div>
              <ProductAnalyticsTable rows={productRows} />
            </section>

            <section className="card om-card" ref={(node) => { sectionRefs.current.product_complaints = node; }}>
              <div className="card-header fw-semibold">3. Product claims</div>
              <div className="table-responsive">
                <table className="table table-striped align-middle mb-0">
                  <thead><tr><th>Item</th><th>Description</th><th>Brand</th><th>Claim tenures</th><th>Current claim</th><th>Remark</th></tr></thead>
                  <tbody>{claimRows.length ? claimRows.map((row) => <tr key={row.id || row.code}>
                    <td className="fw-semibold">{row.code}</td><td>{row.description || row.name || "-"}</td><td>{row.brand || "-"}</td>
                    <td>{row.tenures?.map((tenure) => <div key={tenure.id} className="small">{formatDateDDMMYYYY(tenure.from_date)} – {formatDateDDMMYYYY(tenure.to_date)}: {formatPercent(tenure.percentage)}</div>)}</td>
                    <td>{formatPercent(row.current_claim_percentage)}</td><td><span className={`badge ${row.remark === "positive" ? "text-bg-success" : row.remark === "negative" ? "text-bg-danger" : "text-bg-secondary"}`}>{row.remark}</span></td>
                  </tr>) : <tr><td colSpan="6" className="text-center text-secondary py-3">No claim tenures found.</td></tr>}</tbody>
                </table>
              </div>
            </section>

            <section className="card om-card" ref={(node) => { sectionRefs.current.shipping_delay = node; }}>
              <div className="card-header fw-semibold">4. Shipping delay by ETD</div>
              <div className="table-responsive">
                <table className="table table-striped align-middle mb-0">
                  <thead><tr><th>PO</th><th>Brand</th><th>Complete shipping</th><th>Effective ETD</th><th>Difference</th><th>Status</th><th>Items</th><th>Qty</th></tr></thead>
                  <tbody>{shippingRows.length ? shippingRows.map((row) => <tr key={`${row.po}-${row.brand}`}>
                    <td className="fw-semibold">{row.po}</td><td>{row.brand}</td><td>{formatDateDDMMYYYY(row.shipping_date)}</td><td>{formatDateDDMMYYYY(row.etd)}</td><td>{formatDays(row.difference_days)}</td><td><span className={`badge ${statusClass(row.status)}`}>{row.status}</span></td><td>{row.item_count}</td><td>{row.total_quantity}</td>
                  </tr>) : <tr><td colSpan="8" className="text-center text-secondary py-3">No completely shipped POs with an ETD.</td></tr>}</tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </main>

      {exportOpen && <div className="modal d-block om-modal-backdrop" role="dialog" aria-modal="true">
        <div className="modal-dialog modal-dialog-centered"><div className="modal-content">
          <div className="modal-header"><h5 className="modal-title">Export vendor report</h5><button type="button" className="btn-close" disabled={exporting} onClick={() => setExportOpen(false)} /></div>
          <div className="modal-body">
            <p className="small text-secondary">Each selected table downloads as a separate file.</p>
            {SECTION_OPTIONS.map(([key, label]) => <label key={key} className="form-check mb-2"><input className="form-check-input" type="checkbox" checked={exportSections.includes(key)} disabled={exporting} onChange={() => toggleExportSection(key)} /><span className="form-check-label">{label}</span></label>)}
            <div className="mt-3 d-flex gap-3">
              {["xlsx", "pdf"].map((format) => <label key={format} className="form-check"><input className="form-check-input" type="radio" name="vendor-performance-export-format" checked={exportFormat === format} disabled={exporting} onChange={() => setExportFormat(format)} /><span className="form-check-label">{format.toUpperCase()}</span></label>)}
            </div>
          </div>
          <div className="modal-footer"><button type="button" className="btn btn-outline-secondary" disabled={exporting} onClick={() => setExportOpen(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled={exporting || exportSections.length === 0} onClick={handleExport}>{exporting ? "Exporting..." : "Export"}</button></div>
        </div></div>
      </div>}
    </>
  );
};

export default VendorPerformanceReport;
