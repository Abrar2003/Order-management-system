import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import DailyShipmentTable from "../components/DailyShipmentTable";
import ReportInfoBanner from "../components/ReportInfoBanner";
import { formatDateDDMMYYYY, getTodayISODate } from "../utils/date";
import { buildDailyShipmentPdfHtml, DAILY_SHIPMENT_PDF_CSS } from "../utils/dailyShipmentPdf";
import { exportHtmlToPdf } from "../services/pdfExport.service";
import "../App.css";

const defaultFilters = () => ({ search: "", brand: "all", vendor: "all", stuffing_date: getTodayISODate() });
const LIMIT_OPTIONS = [10, 20, 50, 100];

const DailyShipmentReport = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [draft, setDraft] = useState(defaultFilters);
  const [filters, setFilters] = useState(defaultFilters);
  const [options, setOptions] = useState({ brands: [], vendors: [] });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, totalRecords: 0 });

  useEffect(() => {
    const controller = new AbortController();
    const fetchData = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await api.get("/reports/daily-shipments", {
          params: { ...filters, page, limit }, signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setRows(response.data.data);
        setPagination(response.data.pagination);
        setOptions(response.data.filters);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setError(requestError?.response?.data?.message || "Failed to load daily shipment report");
        setRows([]);
        setPagination({ page: 1, totalPages: 1, totalRecords: 0 });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    fetchData();
    return () => controller.abort();
  }, [filters, page, limit]);

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setFilters({ ...draft, search: draft.search.trim() });
  };
  const clearFilters = () => {
    setPage(1);
    const defaults = defaultFilters();
    setDraft(defaults);
    setFilters(defaults);
  };
  const updateDraft = (field, value) => setDraft((previous) => ({ ...previous, [field]: value }));
  const exportPdf = async () => {
    setExportingPdf(true);
    setError("");
    try {
      const exportRows = [];
      let exportPage = 1;
      let totalPages = 1;
      do {
        const response = await api.get("/reports/daily-shipments", {
          params: { stuffing_date: filters.stuffing_date, page: exportPage, limit: 100 },
        });
        exportRows.push(...response.data.data);
        totalPages = response.data.pagination.totalPages;
        exportPage += 1;
      } while (exportPage <= totalPages);
      await exportHtmlToPdf({
        reportKey: "daily-shipment-report",
        filename: `daily-shipment-report-${filters.stuffing_date}.pdf`,
        html: buildDailyShipmentPdfHtml(exportRows, filters.stuffing_date),
        repeatHeader: {
          title: "Daily Shipment Report",
          subtitle: `Stuffing date: ${formatDateDDMMYYYY(filters.stuffing_date)} | Containers: ${exportRows.length}`,
        },
        extraCss: DAILY_SHIPMENT_PDF_CSS,
      });
    } catch {
      setError("Failed to export daily shipment report PDF. Please try again.");
    } finally {
      setExportingPdf(false);
    }
  };

  return <>
    <Navbar />
    <div className="page-shell py-3">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigate(-1)}>Back</button>
        <h2 className="h4 mb-0">Daily Shipment Report</h2>
        <button type="button" className="btn btn-outline-primary btn-sm" disabled={loading || exportingPdf} onClick={exportPdf} title={`Export all containers for ${formatDateDDMMYYYY(filters.stuffing_date)}, regardless of search, brand or vendor filters`}>
          {exportingPdf ? "Exporting PDF..." : "Export PDF"}
        </button>
      </div>
      <ReportInfoBanner
        description="Shows shipments by container, with expandable PO and item details."
        dataShown="Container number, brand, vendor, stuffed CBM, stuffing date, ETA and ETD. Item rows show PO, item code, order quantity, stuffed quantity and remaining quantity."
        howItWorks="Shows containers stuffed on the selected date, defaulting to today. Stuffed quantity is for this container; remaining quantity accounts for all containers. A fully shipped PO shows one row with the note 'All items are shipped'. PDF export includes all containers for the applied date, regardless of search, brand or vendor filters."
      />
      <div className="card om-card mb-3"><div className="card-body overflow-auto"><form className="row g-2 align-items-end flex-nowrap" style={{ minWidth: "900px" }} onSubmit={applyFilters}>
        <div className="col-3"><label htmlFor="daily-shipment-search" className="form-label">Search</label><input id="daily-shipment-search" className="form-control" value={draft.search} placeholder="Search container, PO or item code" onChange={(event) => updateDraft("search", event.target.value)} /></div>
        <div className="col-2"><label htmlFor="daily-shipment-brand" className="form-label">Brand</label><select id="daily-shipment-brand" className="form-select" value={draft.brand} onChange={(event) => updateDraft("brand", event.target.value)}><option value="all">All Brands</option>{options.brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}</select></div>
        <div className="col-2"><label htmlFor="daily-shipment-vendor" className="form-label">Vendor</label><select id="daily-shipment-vendor" className="form-select" value={draft.vendor} onChange={(event) => updateDraft("vendor", event.target.value)}><option value="all">All Vendors</option>{options.vendors.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}</select></div>
        <div className="col-3"><label htmlFor="daily-shipment-date" className="form-label">Stuffing Date</label><input id="daily-shipment-date" type="date" required className="form-control" value={draft.stuffing_date} onChange={(event) => updateDraft("stuffing_date", event.target.value)} /></div>
        <div className="col-2 d-flex gap-2"><button type="submit" className="btn btn-primary">Apply</button><button type="button" className="btn btn-outline-secondary" onClick={clearFilters}>Clear</button></div>
      </form></div></div>
      <div className="card om-card mb-3"><div className="card-body d-flex flex-wrap gap-2"><span className="om-summary-chip">Containers: {pagination.totalRecords}</span><span className="om-summary-chip">Page: {pagination.page}</span><span className="om-summary-chip">Limit: {limit}</span></div></div>
      {error && <div className="alert alert-danger mb-3" role="alert">{error}</div>}
      <div className="card om-card"><div className="card-body p-0">{loading ? <div className="text-center py-4" role="status">Loading...</div> : <DailyShipmentTable rows={rows} />}</div></div>
      <div className="d-flex justify-content-center align-items-center gap-3 mt-3">
        <button type="button" className="btn btn-outline-secondary btn-sm" disabled={loading || pagination.page <= 1} onClick={() => setPage(pagination.page - 1)}>Prev</button>
        <span className="small fw-semibold">Page {pagination.page} of {pagination.totalPages}</span>
        <button type="button" className="btn btn-outline-secondary btn-sm" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => setPage(pagination.page + 1)}>Next</button>
      </div>
      <div className="d-flex justify-content-end mt-3"><div className="input-group om-limit-control"><label htmlFor="daily-shipment-limit" className="input-group-text">Limit</label><select id="daily-shipment-limit" className="form-select" value={limit} onChange={(event) => { setPage(1); setLimit(Number(event.target.value)); }}>{LIMIT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div></div>
    </div>
  </>;
};

export default DailyShipmentReport;
