import { useState } from "react";
import { exportUpcomingEtdReport } from "../services/orders.service";
import "../App.css";

const buildInitialForm = (defaultFilters = {}) => ({
  brand: String(defaultFilters?.brand || "").trim() === "all" ? "all" : String(defaultFilters?.brand || "").trim(),
  vendor: String(defaultFilters?.vendor || "").trim() === "all" ? "all" : String(defaultFilters?.vendor || "").trim(),
  to_date: defaultFilters?.to_date || "",
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

const UpcomingEtdExportModal = ({
  onClose,
  filterOptions = {},
  defaultFilters = {},
}) => {
  const [form, setForm] = useState(() => buildInitialForm(defaultFilters));
  const [error, setError] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const brands = Array.isArray(filterOptions?.brands) ? filterOptions.brands : [];
  const vendors = Array.isArray(filterOptions?.vendors) ? filterOptions.vendors : [];

  const handleExport = async () => {
    try {
      setError("");
      setIsExporting(true);

      const response = await exportUpcomingEtdReport({
        brand: form.brand,
        vendor: form.vendor,
        to_date: form.to_date || undefined,
        tz_offset_minutes: new Date().getTimezoneOffset(),
      });

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
          || "Failed to export upcoming ETD report as XLSX.",
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
              <div className="col-md-6">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={form.brand}
                  disabled={isExporting}
                  onChange={(e) => setForm((prev) => ({ ...prev, brand: e.target.value }))}
                >
                  <option value="all">All Brands</option>
                  {brands.map((brandValue) => (
                    <option key={brandValue} value={brandValue}>
                      {brandValue}
                    </option>
                  ))}
                </select>
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
              {isExporting ? "Exporting..." : "Export XLSX"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UpcomingEtdExportModal;
