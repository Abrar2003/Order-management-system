import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import ProductAnalyticsTable from "../components/ProductAnalyticsTable";
import ReportInfoBanner from "../components/ReportInfoBanner";
import VendorPerformanceCharts, { VendorPerformanceMonthlyDelayChart } from "../components/VendorPerformanceCharts";
import { formatDateDDMMYYYY } from "../utils/date";
import { exportElementToPdf } from "../services/pdfExport.service";
import "../App.css";

const SECTION_OPTIONS = [
  ["po_delay", "PO-wise delay"],
  ["product_analytics", "Product analytics"],
  ["product_complaints", "Product claims"],
  ["shipping_delay", "Stuffing delay"],
];

const emptySections = () => Object.fromEntries(
  SECTION_OPTIONS.map(([key]) => [key, { rows: [] }]),
);

const formatDays = (value) => {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "-";
  const days = Number(value);
  if (days === 0) return "On time";
  return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ${days > 0 ? "delayed" : "early"}`;
};

const formatPercent = (value) => Number.isFinite(Number(value))
  ? `${Number(value).toFixed(2)}%`
  : "-";
const formatAverageDays = (value) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)} days` : "-";

const SummaryCards = ({ cards = [] }) => <div className="row g-2 p-3 pb-0 vendor-performance-summary">
  {cards.map((card) => <div key={card.label} className="col-sm-6 col-lg-3"><div className="border rounded bg-light h-100 p-3"><div className="small text-secondary">{card.label}</div><div className="fs-5 fw-semibold">{card.value}</div></div></div>)}
</div>;

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
  const [brandOptions, setBrandOptions] = useState([]);
  const [brandFilters, setBrandFilters] = useState([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sections, setSections] = useState(emptySections);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSections, setExportSections] = useState(["po_delay"]);
  const [exportFormat, setExportFormat] = useState("xlsx");
  const [exporting, setExporting] = useState(false);
  const [activeSection, setActiveSection] = useState("po_delay");
  const [stuffingComparison, setStuffingComparison] = useState("packed");

  const loadReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.get("/reports/vendor-performance", {
        params: vendor ? {
          vendor,
          brands: brandFilters.join(",") || undefined,
          from_date: fromDate || undefined,
          to_date: toDate || undefined,
        } : {},
      });
      setVendorOptions(Array.isArray(response?.data?.filters?.vendor_options)
        ? response.data.filters.vendor_options
        : []);
      setBrandOptions(Array.isArray(response?.data?.filters?.brand_options)
        ? response.data.filters.brand_options
        : []);
      setSections(response?.data?.sections || emptySections());
    } catch (loadError) {
      setSections(emptySections());
      setError(loadError?.response?.data?.message || "Failed to load vendor performance report.");
    } finally {
      setLoading(false);
    }
  }, [vendor, brandFilters, fromDate, toDate]);

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
    const previousSection = activeSection;
    try {
      setExporting(true);
      setError("");
      for (const section of exportSections) {
        const label = SECTION_OPTIONS.find(([key]) => key === section)?.[1] || section;
        const filenameBase = `vendor-${vendor.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${section.replace(/_/g, "-")}`;
        if (exportFormat === "pdf") {
          setActiveSection(section);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          await exportElementToPdf({
            element: sectionRefs.current[section],
            reportKey: "vendor-performance-report",
            filename: `${filenameBase}.pdf`,
            repeatHeader: { title: label, subtitle: `Vendor: ${vendor}` },
            extraCss: `
              .pdf-report .vendor-performance-summary {
                display: grid !important;
                grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 3mm !important;
                margin: 0 !important;
                padding: 4mm !important;
              }
              .pdf-report .vendor-performance-summary > [class*="col-"] {
                width: auto !important;
                max-width: none !important;
                padding: 0 !important;
              }
              .pdf-report .vendor-performance-summary .border { padding: 3mm !important; }
              .pdf-report .vendor-performance-summary .small { font-size: 10px !important; line-height: 1.25; }
              .pdf-report .vendor-performance-summary .fs-5 { font-size: 16px !important; line-height: 1.2; }
              .pdf-report .vendor-performance-po-table {
                width: 100% !important;
                table-layout: fixed !important;
              }
              .pdf-report .vendor-performance-po-table th,
              .pdf-report .vendor-performance-po-table td {
                padding: 3mm !important;
                font-size: 16px !important;
                text-align: left !important;
                white-space: nowrap !important;
              }
              .pdf-report .vendor-performance-po-table th:nth-child(1) { width: 12%; }
              .pdf-report .vendor-performance-po-table th:nth-child(2) { width: 15%; }
              .pdf-report .vendor-performance-po-table th:nth-child(3),
              .pdf-report .vendor-performance-po-table th:nth-child(4) { width: 16%; }
              .pdf-report .vendor-performance-po-table th:nth-child(5) { width: 18%; }
              .pdf-report .vendor-performance-po-table th:nth-child(6) { width: 11%; }
              .pdf-report .vendor-performance-po-table th:nth-child(7),
              .pdf-report .vendor-performance-po-table th:nth-child(8) { width: 6%; }
            `,
          });
        } else {
          const response = await api.get("/reports/vendor-performance/export", {
            params: { vendor, section, brands: brandFilters.join(",") || undefined, format: "xlsx" },
            responseType: "blob",
          });
          downloadResponse(response, `${filenameBase}.xlsx`);
        }
      }
      setExportOpen(false);
    } catch (exportError) {
      setError(exportError?.response?.data?.message || "Failed to export the selected report table.");
    } finally {
      setActiveSection(previousSection);
      setExporting(false);
    }
  };

  const poRows = sections?.po_delay?.rows || [];
  const productRows = sections?.product_analytics?.rows || [];
  const claimRows = sections?.product_complaints?.rows || [];
  const shippingRows = sections?.shipping_delay?.rows || [];
  const poSummary = sections?.po_delay?.summary?.brands || [];
  const combinedPoSummary = sections?.po_delay?.summary?.combined || {};
  const claimSummary = sections?.product_complaints?.summary || {};
  const shippingSummary = sections?.shipping_delay?.summary || {};
  const stuffingStatusKey = stuffingComparison === "packed" ? "packed_status" : "etd_status";
  const stuffingComparisonLabel = stuffingComparison === "packed" ? "final packed" : "ETD";

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
          howItWorks="Select a vendor and optionally an inclusive ETD range. All data is filtered on the server using the logged-in user's brand and vendor access."
        />

        <div className="card om-card mb-3">
          <div className="card-body row g-2 align-items-end">
            <div className="col-md-4">
              <label className="form-label" htmlFor="vendor-performance-vendor">Vendor</label>
              <select
                id="vendor-performance-vendor"
                className="form-select"
                value={vendor}
                onChange={(event) => {
                  setVendor(event.target.value);
                  setBrandFilters([]);
                }}
              >
                <option value="">Select a vendor</option>
                {vendorOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="col-md-3 dropdown">
              <label className="form-label" htmlFor="vendor-performance-brands">Brands</label>
              <button
                id="vendor-performance-brands"
                type="button"
                className="form-select text-start packed-goods-filter-trigger"
                data-bs-toggle="dropdown"
                data-bs-auto-close="outside"
                disabled={!vendor}
              >
                <span className="text-truncate d-block">
                  {brandFilters.length ? brandFilters.join(", ") : "All Brands"}
                </span>
              </button>
              <ul className="dropdown-menu packed-goods-filter-menu shadow w-100">
                {brandOptions.map((option) => (
                  <li key={option}>
                    <label className="packed-goods-filter-option">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={brandFilters.includes(option)}
                        onChange={() => setBrandFilters((current) => current.includes(option)
                          ? current.filter((brand) => brand !== option)
                          : [...current, option])}
                      />
                      <span className="packed-goods-filter-option-label">{option}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            <div className="col-md-2">
              <label className="form-label" htmlFor="vendor-performance-from-date">ETD from</label>
              <input
                id="vendor-performance-from-date"
                type="date"
                className="form-control"
                value={fromDate}
                max={toDate || undefined}
                disabled={!vendor}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </div>
            <div className="col-md-2">
              <label className="form-label" htmlFor="vendor-performance-to-date">ETD to</label>
              <input
                id="vendor-performance-to-date"
                type="date"
                className="form-control"
                value={toDate}
                min={fromDate || undefined}
                disabled={!vendor}
                onChange={(event) => setToDate(event.target.value)}
              />
            </div>
            <div className="col-md-1">
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
            <nav className="nav nav-tabs" aria-label="Vendor report sections">
              {SECTION_OPTIONS.map(([key, label]) => <button key={key} type="button" className={`nav-link ${activeSection === key ? "active" : ""}`} aria-current={activeSection === key ? "page" : undefined} disabled={exporting} onClick={() => setActiveSection(key)}>{label}</button>)}
            </nav>

            {activeSection === "po_delay" && <section className="card om-card" ref={(node) => { sectionRefs.current.po_delay = node; }}>
              <div className="card-header fw-semibold">1. PO-wise delay — complete packed date vs ETD</div>
              <SummaryCards cards={[{ label: "All selected brands POs", value: combinedPoSummary.po_count || 0 }, { label: "All selected brands packed delayed by ETD", value: combinedPoSummary.delayed_po_count || 0 }, { label: "All selected brands early POs", value: combinedPoSummary.early_po_count || 0 }, { label: "All selected brands average delay", value: formatAverageDays(combinedPoSummary.average_delay_days) }, ...poSummary.flatMap((row) => [{ label: `${row.brand} POs`, value: row.po_count }, { label: `${row.brand} packed delayed by ETD`, value: row.delayed_po_count }, { label: `${row.brand} early POs`, value: row.early_po_count }, { label: `${row.brand} average delay`, value: formatAverageDays(row.average_delay_days) }])]} />
              <VendorPerformanceMonthlyDelayChart rows={poRows} />
              <VendorPerformanceCharts section="po_delay" rows={poRows} />
              <div className="table-responsive">
                <table className="table table-striped align-middle mb-0 vendor-performance-po-table">
                  <thead><tr><th>PO</th><th>Brand</th><th>Complete packed</th><th>Effective ETD</th><th>Difference</th><th>Status</th><th>Items</th><th>Qty</th></tr></thead>
                  <tbody>{poRows.length ? poRows.map((row) => <tr key={`${row.po}-${row.brand}`} className={row.is_overdue_inspection_pending ? "table-danger" : row.is_inspection_pending ? "table-success" : ""}>
                    <td className="fw-semibold">{row.po}</td><td>{row.brand}</td><td>{row.is_inspection_pending ? "Inspection pending" : formatDateDDMMYYYY(row.packed_date)}</td><td>{formatDateDDMMYYYY(row.etd)}</td><td>{formatDays(row.difference_days)}</td><td><span className={`badge ${row.is_overdue_inspection_pending ? "text-bg-danger" : row.is_inspection_pending ? "text-bg-success" : statusClass(row.status)}`}>{row.status}</span></td><td>{row.item_count}</td><td>{row.total_quantity}</td>
                  </tr>) : <tr><td colSpan="8" className="text-center text-secondary py-3">No completely packed POs with an ETD.</td></tr>}</tbody>
                </table>
              </div>
            </section>}

            {activeSection === "product_analytics" && <section className="card om-card" ref={(node) => { sectionRefs.current.product_analytics = node; }}>
              <div className="card-header fw-semibold">2. Product analytics</div>
              <ProductAnalyticsTable rows={productRows} />
            </section>}

            {activeSection === "product_complaints" && <section className="card om-card" ref={(node) => { sectionRefs.current.product_complaints = node; }}>
              <div className="card-header fw-semibold">3. Product claims</div>
              <SummaryCards cards={[{ label: "Total items", value: claimSummary.total_item_count || 0 }, { label: "Items with claims", value: `${claimSummary.claimed_item_count || 0} (${formatPercent(claimSummary.claimed_item_percentage)})` }, { label: "Average claim", value: formatPercent(claimSummary.average_claim_percentage) }]} />
              <VendorPerformanceCharts section="product_complaints" rows={claimRows} />
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
            </section>}

            {activeSection === "shipping_delay" && <section className="card om-card" ref={(node) => { sectionRefs.current.shipping_delay = node; }}>
              <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
                <span className="fw-semibold">4. Stuffing delay — stuffing date vs {stuffingComparisonLabel}</span>
                <div className="btn-group btn-group-sm" role="group" aria-label="Stuffing delay comparison">
                  <button type="button" className={`btn ${stuffingComparison === "packed" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setStuffingComparison("packed")}>Final packed</button>
                  <button type="button" className={`btn ${stuffingComparison === "etd" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setStuffingComparison("etd")}>ETD</button>
                </div>
              </div>
              <SummaryCards cards={[
                { label: "Total stuffed POs", value: shippingSummary.po_count || 0 },
                { label: "Stuffed delayed by ETD", value: shippingSummary.delayed_by_etd_po_count || 0 },
                { label: "Stuffed early by ETD", value: shippingSummary.early_by_etd_po_count || 0 },
                { label: "Average stuffing time after Packed", value: formatAverageDays(shippingSummary.average_stuffing_time_days) },
              ]} />
              <VendorPerformanceMonthlyDelayChart rows={shippingRows} dateKey="final_packed_date" delayKey="packed_difference_days" title="Monthly stuffing delay: final packed vs stuffing" />
              <VendorPerformanceCharts section="shipping_delay" rows={shippingRows} />
              <div className="table-responsive">
                <table className="table table-striped align-middle mb-0">
                  <thead><tr><th>PO</th><th>Brand</th><th>Complete stuffing</th><th>Final packed</th><th className={stuffingComparison === "packed" ? "table-primary" : ""}>Stuffing vs packed</th><th>Effective ETD</th><th className={stuffingComparison === "etd" ? "table-primary" : ""}>Stuffing vs ETD</th><th>Status</th><th>Items</th><th>Qty</th></tr></thead>
                  <tbody>{shippingRows.length ? shippingRows.map((row) => <tr key={`${row.po}-${row.brand}`}>
                    <td className="fw-semibold">{row.po}</td><td>{row.brand}</td><td>{formatDateDDMMYYYY(row.stuffing_date)}</td><td>{formatDateDDMMYYYY(row.final_packed_date)}</td><td className={stuffingComparison === "packed" ? "table-primary" : ""}>{formatDays(row.packed_difference_days)}</td><td>{formatDateDDMMYYYY(row.effective_etd)}</td><td className={stuffingComparison === "etd" ? "table-primary" : ""}>{formatDays(row.etd_difference_days)}</td><td><span className={`badge ${statusClass(row[stuffingStatusKey])}`}>{row[stuffingStatusKey]}</span></td><td>{row.item_count}</td><td>{row.total_quantity}</td>
                  </tr>) : <tr><td colSpan="10" className="text-center text-secondary py-3">No fully stuffed POs with a final packed date or ETD.</td></tr>}</tbody>
                </table>
              </div>
            </section>}
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
