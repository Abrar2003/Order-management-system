import { useState } from "react";
import {
  exportUpcomingEtdReport,
  getUpcomingEtdReport,
} from "../services/orders.service";
import { formatDateDDMMYYYY } from "../utils/date";
import { exportHtmlToPdf } from "../services/pdfExport.service";
import "../App.css";

const normalizeBrands = (value) => {
  if (!value) return ["all"];
  const list = Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((b) => b.trim())
        .filter(Boolean);
  const filtered = list.filter((b) => !["all", "undefined", "null"].includes(b.toLowerCase()));
  return filtered.length > 0 ? filtered : ["all"];
};

const isAllBrands = (values) => !Array.isArray(values) || values.includes("all");

const buildInitialForm = (defaultFilters = {}) => ({
  brand: normalizeBrands(defaultFilters?.brand),
  vendor: String(defaultFilters?.vendor || "").trim() === "all" ? "all" : String(defaultFilters?.vendor || "").trim(),
  to_date: defaultFilters?.to_date || "",
  format: "xlsx",
});

const parseFileNameFromDisposition = (disposition, fallbackName) => {
  const source = String(disposition || "");

  const utf8Match = source.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/['"]/g, ""));
    } catch (_) {
      return utf8Match[1].trim().replace(/['"]/g, "") || fallbackName;
    }
  }

  const basicMatch = source.match(/filename="?([^";]+)"?/i);
  if (basicMatch?.[1]) {
    return basicMatch[1].trim();
  }

  return fallbackName;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const exportDatasetAsPdf = async (dataset) => {
  const filters = dataset?.filters || {};
  const summary = dataset?.summary || {};
  const rows = (Array.isArray(dataset?.vendors) ? dataset.vendors : []).flatMap(
    (vendorEntry) =>
      (Array.isArray(vendorEntry?.rows) ? vendorEntry.rows : []).map((row) => ({
        ...row,
        vendor: vendorEntry?.vendor || "",
      })),
  );
  const metadata = `Window: ${formatDateDDMMYYYY(filters.report_start_date, "-")} - ${formatDateDDMMYYYY(filters.report_end_date, "-")} · POs: ${summary.upcoming_po_count || 0} · Vendors: ${summary.vendors_count || 0} · Pending: ${summary.pending_count || 0} · Inspected: ${summary.inspection_done_count || 0}`;
  const bodyRows = rows.length > 0
    ? rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.vendor)}</td>
          <td>${escapeHtml(row.order_id)}</td>
          <td>${escapeHtml(row.brand)}</td>
          <td>${escapeHtml(formatDateDDMMYYYY(row.order_date, ""))}</td>
          <td>${escapeHtml(formatDateDDMMYYYY(row.effective_etd, ""))}</td>
          <td>${Number(row.days_until_etd || 0)}</td>
          <td>${Number(row.pending_count || 0)}</td>
          <td>${Number(row.inspection_done_count || 0)}</td>
          <td>${Number(row.shipped_count || 0)}</td>
          <td>${escapeHtml(row.last_progress || "Pending")}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="10">No upcoming ETD purchase orders found.</td></tr>`;

  await exportHtmlToPdf({
    reportKey: "upcoming-etd-report",
    filename: `upcoming-etd-report-${new Date().toISOString().slice(0, 10)}.pdf`,
    landscape: true,
    repeatHeader: {
      inTable: true,
      title: "Upcoming ETD Report",
      subtitle: metadata,
    },
    html: `
      <table class="table table-sm upcoming-etd-table">
        <thead>
          <tr>
            <th>Vendor</th><th>PO</th><th>Brand</th><th>Order Date</th>
            <th>ETD</th><th>Days</th><th>Pending</th><th>Inspected</th>
            <th>Shipped</th><th>Last Progress</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    `,
  });
};

const UpcomingEtdExportModal = ({
  onClose,
  filterOptions = {},
  defaultFilters = {},
}) => {
  const [form, setForm] = useState(() => buildInitialForm(defaultFilters));
  const [error, setError] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const handleBrandChange = (event) => {
    const { value, checked } = event.target;
    setForm((prev) => {
      let nextBrands = prev.brand.filter((entry) => entry !== "all");
      if (value === "all") {
        nextBrands = ["all"];
      } else {
        nextBrands = checked
          ? [...nextBrands, value]
          : nextBrands.filter((entry) => entry !== value);
      }
      if (nextBrands.length === 0) {
        nextBrands = ["all"];
      }
      return { ...prev, brand: nextBrands };
    });
  };

  const brands = Array.isArray(filterOptions?.brand_options)
    ? filterOptions.brand_options
    : Array.isArray(filterOptions?.brands)
      ? filterOptions.brands
      : [];
  const vendors = Array.isArray(filterOptions?.vendor_options)
    ? filterOptions.vendor_options
    : Array.isArray(filterOptions?.vendors)
      ? filterOptions.vendors
      : [];

  const handleExport = async () => {
    try {
      setError("");
      setIsExporting(true);

      const params = {
        brand: isAllBrands(form.brand) ? "all" : form.brand.join(","),
        vendor: form.vendor,
        to_date: form.to_date || undefined,
        tz_offset_minutes: new Date().getTimezoneOffset(),
      };

      if (form.format === "pdf") {
        const dataset = await getUpcomingEtdReport(params);
        await exportDatasetAsPdf(dataset);
        onClose?.();
        return;
      }

      const response = await exportUpcomingEtdReport(params);

      const disposition = String(response?.headers?.["content-disposition"] || "");
      const fallbackName = `upcoming-etd-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const fileName = parseFileNameFromDisposition(disposition, fallbackName);

      const blob = new Blob(
        [response.data],
        {
          type:
            response?.headers?.["content-type"]
            || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      );

      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);

      onClose?.();
    } catch (err) {
      setError(
        err?.response?.data?.message
          || `Failed to export upcoming ETD report as ${form.format.toUpperCase()}.`,
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-lg" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Export Upcoming ETD Report</h5>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              disabled={isExporting}
              onClick={onClose}
            />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="row g-3">
              <div className="col-md-6 dropdown">
                <label className="form-label">Brand</label>
                <button
                  type="button"
                  className="form-select text-start"
                  data-bs-toggle="dropdown"
                  data-bs-auto-close="outside"
                  disabled={isExporting}
                >
                  <span className="text-truncate d-block">
                    {isAllBrands(form.brand) ? "All Brands" : form.brand.join(", ")}
                  </span>
                </button>
                <ul className="dropdown-menu packed-goods-filter-menu shadow w-100">
                  <li>
                    <label className="packed-goods-filter-option">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        value="all"
                        checked={isAllBrands(form.brand)}
                        disabled={isExporting}
                        onChange={handleBrandChange}
                      />
                      <span className="packed-goods-filter-option-label">All Brands</span>
                    </label>
                  </li>
                  {brands.map((brandValue) => (
                    <li key={brandValue}>
                      <label className="packed-goods-filter-option">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          value={brandValue}
                          checked={form.brand.includes(brandValue)}
                          disabled={isExporting}
                          onChange={handleBrandChange}
                        />
                        <span className="packed-goods-filter-option-label">{brandValue}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="col-md-6">
                <label className="form-label">Vendor</label>
                <select
                  className="form-select"
                  value={form.vendor}
                  disabled={isExporting}
                  onChange={(e) => setForm((prev) => ({ ...prev, vendor: e.target.value }))}
                >
                  <option value="all">All Vendors</option>
                  {vendors.map((vendorValue) => (
                    <option key={vendorValue} value={vendorValue}>
                      {vendorValue}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="form-label">Until Date</label>
              <input
                type="date"
                className="form-control"
                value={form.to_date}
                disabled={isExporting}
                onChange={(e) => setForm((prev) => ({ ...prev, to_date: e.target.value }))}
              />
            </div>

            <fieldset>
              <legend className="form-label">Export format</legend>
              <div className="upcoming-etd-export-format-grid">
                <label className={`upcoming-etd-export-format${form.format === "xlsx" ? " is-selected" : ""}`}>
                  <input
                    type="radio"
                    name="upcoming-etd-export-format"
                    value="xlsx"
                    checked={form.format === "xlsx"}
                    disabled={isExporting}
                    onChange={(e) => setForm((prev) => ({ ...prev, format: e.target.value }))}
                  />
                  <span>
                    <strong>Excel (.xlsx)</strong>
                    <small>Editable spreadsheet for further analysis.</small>
                  </span>
                </label>
                <label className={`upcoming-etd-export-format${form.format === "pdf" ? " is-selected" : ""}`}>
                  <input
                    type="radio"
                    name="upcoming-etd-export-format"
                    value="pdf"
                    checked={form.format === "pdf"}
                    disabled={isExporting}
                    onChange={(e) => setForm((prev) => ({ ...prev, format: e.target.value }))}
                  />
                  <span>
                    <strong>PDF (.pdf)</strong>
                    <small>Print-ready landscape report with pagination.</small>
                  </span>
                </label>
              </div>
            </fieldset>

            {error && (
              <div className="alert alert-danger mb-0" role="alert">
                {error}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-outline-secondary me-auto"
              disabled={isExporting}
              onClick={() => {
                setError("");
                setForm(buildInitialForm(defaultFilters));
              }}
            >
              Reset
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              disabled={isExporting}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={isExporting}
              onClick={handleExport}
            >
              {isExporting ? "Exporting..." : `Export ${form.format.toUpperCase()}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UpcomingEtdExportModal;
