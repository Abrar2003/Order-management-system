import { useState } from "react";
import { exportOrders } from "../services/orders.service";
import "../App.css";

const normalizeFilterChoice = (value) => {
  const cleaned = String(value || "").trim();
  if (!cleaned || cleaned.toLowerCase() === "all") return "all";
  return cleaned;
};

const buildInitialForm = (defaultFilters = {}) => ({
  brand: normalizeFilterChoice(defaultFilters?.brand),
  vendor: normalizeFilterChoice(defaultFilters?.vendor),
  status: normalizeFilterChoice(defaultFilters?.status),
  order_date_from: "",
  order_date_to: "",
  etd_from: "",
  etd_to: "",
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

const OrderExportModal = ({
  onClose,
  filterOptions = {},
  statusOptions = [],
  defaultFilters = {},
}) => {
  const [form, setForm] = useState(() => buildInitialForm(defaultFilters));
  const [error, setError] = useState("");
  const [exportingFormat, setExportingFormat] = useState("");

  const brands = Array.isArray(filterOptions?.brands) ? filterOptions.brands : [];
  const vendors = Array.isArray(filterOptions?.vendors) ? filterOptions.vendors : [];
  const statuses = Array.isArray(statusOptions) ? statusOptions : [];
  const isExporting = exportingFormat === "xlsx" || exportingFormat === "csv";

  const validateDateRanges = () => {
    if (
      form.order_date_from
      && form.order_date_to
      && form.order_date_from > form.order_date_to
    ) {
      return "Order date 'from' cannot be after 'to'.";
    }

    if (form.etd_from && form.etd_to && form.etd_from > form.etd_to) {
      return "ETD 'from' cannot be after 'to'.";
    }

    return "";
  };

  const handleExport = async (format = "xlsx") => {
    const validationError = validateDateRanges();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setError("");
      setExportingFormat(format);

      const response = await exportOrders(
        {
          brand: form.brand,
          vendor: form.vendor,
          status: form.status,
          order_date_from: form.order_date_from || undefined,
          order_date_to: form.order_date_to || undefined,
          etd_from: form.etd_from || undefined,
          etd_to: form.etd_to || undefined,
          tz_offset_minutes: new Date().getTimezoneOffset(),
        },
        format,
      );

      const resolvedFormat = format === "csv" ? "csv" : "xlsx";
      const disposition = String(response?.headers?.["content-disposition"] || "");
      const fallbackName = `orders-${new Date().toISOString().slice(0, 10)}.${resolvedFormat}`;
      const fileName = parseFileNameFromDisposition(disposition, fallbackName);

      const blob = new Blob(
        [response.data],
        {
          type:
            response?.headers?.["content-type"]
            || (resolvedFormat === "csv"
              ? "text/csv; charset=utf-8"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
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
          || `Failed to export orders as ${String(format).toUpperCase()}.`,
      );
    } finally {
      setExportingFormat("");
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-lg" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Export Orders</h5>
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
              <div className="col-md-4">
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

              <div className="col-md-4">
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

              <div className="col-md-4">
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  value={form.status}
                  disabled={isExporting}
                  onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                >
                  <option value="all">All Statuses</option>
                  {statuses.map((statusValue) => (
                    <option key={statusValue} value={statusValue}>
                      {statusValue}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label">Order Date From</label>
                <input
                  type="date"
                  className="form-control"
                  value={form.order_date_from}
                  disabled={isExporting}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, order_date_from: e.target.value }))
                  }
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Order Date To</label>
                <input
                  type="date"
                  className="form-control"
                  value={form.order_date_to}
                  disabled={isExporting}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, order_date_to: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label">ETD From</label>
                <input
                  type="date"
                  className="form-control"
                  value={form.etd_from}
                  disabled={isExporting}
                  onChange={(e) => setForm((prev) => ({ ...prev, etd_from: e.target.value }))}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">ETD To</label>
                <input
                  type="date"
                  className="form-control"
                  value={form.etd_to}
                  disabled={isExporting}
                  onChange={(e) => setForm((prev) => ({ ...prev, etd_to: e.target.value }))}
                />
              </div>
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
              className="btn btn-outline-primary"
              disabled={isExporting}
              onClick={() => handleExport("xlsx")}
            >
              {exportingFormat === "xlsx" ? "Exporting..." : "Export XLSX"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={isExporting}
              onClick={() => handleExport("csv")}
            >
              {exportingFormat === "csv" ? "Exporting..." : "Export CSV"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderExportModal;
