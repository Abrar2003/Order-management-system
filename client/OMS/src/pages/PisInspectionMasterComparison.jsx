import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import ReportInfoBanner from "../components/ReportInfoBanner";
import { formatDateDDMMYYYY } from "../utils/date";
import {
  fetchPisInspectionMasterComparison,
  fetchPisInspectionMasterComparisonRecords,
} from "../services/pisInspectionMasterComparison.service";
import "../App.css";

const EMPTY_LABEL = "Not Set";
const DEFAULT_RECORD_LIMIT = 10;

const normalizeText = (value) => String(value || "").trim();

const formatValue = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") {
    return EMPTY_LABEL;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed) && String(value).trim() !== "") {
    return parsed.toFixed(3).replace(/\.?0+$/, "");
  }
  return String(value);
};

const formatList = (values = []) =>
  (Array.isArray(values) ? values : [])
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(", ") || EMPTY_LABEL;

const getCellClassName = (status = "") => {
  if (status === "mismatch") return "pimc-cell pimc-cell-mismatch";
  if (status === "missing") return "pimc-cell pimc-cell-missing";
  return "pimc-cell";
};

const getOrdinalLabel = (index) => {
  if (index === 0) return "1st";
  if (index === 1) return "2nd";
  if (index === 2) return "3rd";
  return `${index + 1}th`;
};

const SourceCell = ({ row, sourceKey }) => {
  const status = row?.cell_status?.[sourceKey] || "";
  return (
    <td className={getCellClassName(status)}>
      <span>{formatValue(row?.[sourceKey])}</span>
      {status === "mismatch" && <span className="pimc-cell-status">Mismatch</span>}
      {status === "missing" && <span className="pimc-cell-status">Missing</span>}
    </td>
  );
};

const InspectionCard = ({ inspection, index }) => (
  <div className="pimc-inspection-card">
    <div className="d-flex justify-content-between gap-2">
      <div>
        <div className="small text-secondary">{getOrdinalLabel(index)} Latest Inspected PO</div>
        <div className="fw-semibold">{inspection?.order_id || EMPTY_LABEL}</div>
      </div>
      <span className="badge text-bg-light">{formatDateDDMMYYYY(inspection?.inspection_date, EMPTY_LABEL)}</span>
    </div>
    <div className="pimc-card-grid mt-2">
      <span>Vendor</span>
      <strong>{inspection?.vendor || EMPTY_LABEL}</strong>
      <span>Brand</span>
      <strong>{inspection?.brand || EMPTY_LABEL}</strong>
      <span>Checked / Passed / Pending</span>
      <strong>
        {formatValue(inspection?.checked)} / {formatValue(inspection?.passed)} / {formatValue(inspection?.pending_after)}
      </strong>
    </div>
  </div>
);

const ComparisonSection = ({ section, inspections }) => {
  const rows = Array.isArray(section?.rows) ? section.rows : [];

  return (
    <div className="card om-card pimc-section">
      <div className="card-header bg-white">
        <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
          <h3 className="h6 mb-0">{section?.title || "Comparison"}</h3>
          <span className="small text-secondary">
            {rows.filter((row) => row?.mismatch).length} mismatched row{rows.filter((row) => row?.mismatch).length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <div className="card-body p-0">
        <div className="table-responsive pimc-table-wrap">
          <table className="table table-sm table-bordered align-middle mb-0 pimc-table">
            <thead className="table-primary">
              <tr>
                <th>Remark</th>
                <th>Field</th>
                <th>PIS</th>
                {[0, 1, 2].map((inspectionIndex) => (
                  <th key={inspectionIndex}>
                    {getOrdinalLabel(inspectionIndex)} Latest Inspected PO
                    <div className="small fw-normal">
                      {inspections?.[inspectionIndex]?.order_id || EMPTY_LABEL}
                    </div>
                  </th>
                ))}
                <th>Master</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const previousRemark = rows[rowIndex - 1]?.remark_key;
                const showRemark = rowIndex === 0 || previousRemark !== row?.remark_key;
                return (
                  <tr
                    key={`${section?.key}-${row?.remark_key}-${row?.field}-${rowIndex}`}
                    className={row?.mismatch ? "pimc-row-mismatch" : ""}
                  >
                    <td className={showRemark ? "fw-semibold pimc-remark-cell" : "pimc-remark-cell-muted"}>
                      {showRemark ? (row?.remark || EMPTY_LABEL) : ""}
                    </td>
                    <td>{row?.label || row?.field || EMPTY_LABEL}</td>
                    <SourceCell row={row} sourceKey="pis" />
                    <SourceCell row={row} sourceKey="inspection_1" />
                    <SourceCell row={row} sourceKey="inspection_2" />
                    <SourceCell row={row} sourceKey="inspection_3" />
                    <SourceCell row={row} sourceKey="master" />
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-secondary py-4">
                    No comparable size rows found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const PisInspectionMasterComparison = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialItemCode = normalizeText(searchParams.get("item_code"));
  const [itemCode, setItemCode] = useState(initialItemCode);
  const [searchedCode, setSearchedCode] = useState(initialItemCode);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(Boolean(initialItemCode));
  const [records, setRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [recordsError, setRecordsError] = useState("");
  const [error, setError] = useState("");

  const inspections = useMemo(
    () => (Array.isArray(comparison?.inspections) ? comparison.inspections : []),
    [comparison],
  );
  const sections = useMemo(
    () => (Array.isArray(comparison?.sections) ? comparison.sections : []),
    [comparison],
  );
  const hasRequiredPoInspectionCount =
    comparison?.summary?.has_required_po_inspection_count !== false;

  const loadComparison = useCallback(async (code) => {
    const normalizedCode = normalizeText(code);
    if (!normalizedCode) {
      setComparison(null);
      setError("");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const data = await fetchPisInspectionMasterComparison(normalizedCode);
      setComparison(data);
    } catch (fetchError) {
      setComparison(null);
      setError(
        fetchError?.response?.data?.message ||
          fetchError?.message ||
          "Failed to load comparison.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadComparison(searchedCode);
  }, [loadComparison, searchedCode]);

  const loadDefaultRecords = useCallback(async () => {
    try {
      setRecordsLoading(true);
      setRecordsError("");
      const data = await fetchPisInspectionMasterComparisonRecords({
        limit: DEFAULT_RECORD_LIMIT,
      });
      setRecords(Array.isArray(data?.rows) ? data.rows : []);
    } catch (fetchError) {
      setRecords([]);
      setRecordsError(
        fetchError?.response?.data?.message ||
          fetchError?.message ||
          "Failed to load comparison records.",
      );
    } finally {
      setRecordsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDefaultRecords();
  }, [loadDefaultRecords]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const normalizedCode = normalizeText(itemCode);
    setSearchedCode(normalizedCode);
    const nextParams = new URLSearchParams();
    if (normalizedCode) nextParams.set("item_code", normalizedCode);
    setSearchParams(nextParams, { replace: true });
  };

  const openRecord = (code) => {
    const normalizedCode = normalizeText(code);
    if (!normalizedCode) return;
    setItemCode(normalizedCode);
    setSearchedCode(normalizedCode);
    const nextParams = new URLSearchParams();
    nextParams.set("item_code", normalizedCode);
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <>
      <Navbar />
      <div className="page-shell om-report-page py-3 pimc-page">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <div>
            <h2 className="h4 mb-1">PIS Inspection Master Comparison</h2>
            <div className="text-secondary small">
              Compare PIS, the latest 3 inspected POs, and master size data by remark.
            </div>
          </div>
        </div>

        <ReportInfoBanner
          description="Compares dimension and specification data between the Product Information Sheet (PIS), the latest 3 inspected POs, and the Master item database."
          dataShown="Item metadata, latest 3 inspected PO cards, and detailed comparison tables highlighting mismatched or missing fields."
          howItWorks="Searchable by item code, comparing sizes/remarks across all three sources to find discrepancies. Displays a list of default eligible items with at least 3 inspected POs."
        />

        <div className="card om-card mb-3">
          <div className="card-body">
            <form className="row g-2 align-items-end" onSubmit={handleSubmit}>
              <div className="col-md-8 col-lg-5">
                <label className="form-label">Item Code</label>
                <input
                  className="form-control"
                  value={itemCode}
                  onChange={(event) => setItemCode(event.target.value)}
                  placeholder="Enter item code"
                />
              </div>
              <div className="col-md-4 col-lg-2 d-grid">
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? "Loading..." : "Search"}
                </button>
              </div>
            </form>
          </div>
        </div>

	        {error && <div className="alert alert-danger">{error}</div>}

        <div className="card om-card mb-3">
          <div className="card-header bg-white d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <h3 className="h6 mb-0">Default Records</h3>
              <div className="small text-secondary">
                Showing 10 items with inspection data from at least 3 different POs.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={loadDefaultRecords}
              disabled={recordsLoading}
            >
              Refresh
            </button>
          </div>
          <div className="card-body p-0">
            {recordsError && <div className="alert alert-danger m-3">{recordsError}</div>}
            {recordsLoading ? (
              <div className="text-center py-4">Loading records...</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm table-hover align-middle mb-0 pimc-records-table">
                  <thead className="table-primary">
                    <tr>
                      <th>Item Code</th>
                      <th>Description</th>
                      <th>Brand</th>
                      <th>Vendors</th>
                      <th>Different Inspected POs</th>
                      <th>Latest Inspection</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => (
                      <tr key={record?.code}>
                        <td className="fw-semibold">{record?.code || EMPTY_LABEL}</td>
                        <td>{record?.description || EMPTY_LABEL}</td>
                        <td>{record?.brand || EMPTY_LABEL}</td>
                        <td>{formatList(record?.vendors)}</td>
                        <td>{Number(record?.distinct_po_count || 0)}</td>
                        <td>{formatDateDDMMYYYY(record?.latest_inspection_date, EMPTY_LABEL)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-outline-primary btn-sm"
                            onClick={() => openRecord(record?.code)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                    {records.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center text-secondary py-4">
                          No eligible records found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {!searchedCode && !loading && !error && (
          <div className="card om-card">
            <div className="card-body text-center text-secondary py-5">
              Search by item code to load the comparison.
            </div>
          </div>
        )}

        {loading && (
          <div className="card om-card">
            <div className="card-body text-center py-5">Loading comparison...</div>
          </div>
        )}

        {!loading && comparison && !hasRequiredPoInspectionCount && (
          <div className="card om-card">
            <div className="card-body text-center text-secondary py-5">
              This item has inspection data from{" "}
              {Number(comparison?.summary?.total_distinct_po_inspections || 0)} different PO
              {Number(comparison?.summary?.total_distinct_po_inspections || 0) === 1 ? "" : "s"}.
              At least 3 different inspected POs are required for this comparison.
            </div>
          </div>
        )}

        {!loading && comparison && hasRequiredPoInspectionCount && (
          <>
            <div className="card om-card mb-3">
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-lg-3 col-md-6">
                    <div className="small text-secondary">Item Code</div>
                    <div className="fw-semibold">{comparison?.item?.code || EMPTY_LABEL}</div>
                  </div>
                  <div className="col-lg-3 col-md-6">
                    <div className="small text-secondary">Description</div>
                    <div className="fw-semibold">{comparison?.item?.description || EMPTY_LABEL}</div>
                  </div>
                  <div className="col-lg-3 col-md-6">
                    <div className="small text-secondary">Brand</div>
                    <div className="fw-semibold">{comparison?.item?.brand || EMPTY_LABEL}</div>
                  </div>
                  <div className="col-lg-3 col-md-6">
                    <div className="small text-secondary">Vendors</div>
                    <div className="fw-semibold">{formatList(comparison?.item?.vendors)}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pimc-inspection-grid mb-3">
              {[0, 1, 2].map((inspectionIndex) =>
                inspections[inspectionIndex] ? (
                  <InspectionCard
                    key={inspections[inspectionIndex].inspection_id || inspectionIndex}
                    inspection={inspections[inspectionIndex]}
                    index={inspectionIndex}
                  />
                ) : (
                  <div className="pimc-inspection-card pimc-inspection-card-empty" key={inspectionIndex}>
                    <div className="small text-secondary">
                      {getOrdinalLabel(inspectionIndex)} Latest Inspected PO
                    </div>
                    <div className="fw-semibold">{EMPTY_LABEL}</div>
                  </div>
                )
              )}
            </div>

            {sections.map((section) => (
              <ComparisonSection
                key={section?.key || section?.title}
                section={section}
                inspections={inspections}
              />
            ))}
          </>
        )}
      </div>
    </>
  );
};

export default PisInspectionMasterComparison;
