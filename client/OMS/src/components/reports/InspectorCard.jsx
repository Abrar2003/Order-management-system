import { memo, useMemo } from "react";
import { formatDateDDMMYYYY } from "../../utils/date";
import { formatCbm } from "../../utils/cbm";
import InspectorReportCharts from "./InspectorReportCharts";

const InspectorCardComponent = ({
  entry,
  fromDate,
  toDate,
  chartStep,
}) => {
  const inspectorId = entry?.inspector?._id || entry?.inspector?.name || "inspector";
  const dailyRows = useMemo(
    () => (Array.isArray(entry?.daily) ? entry.daily : []),
    [entry?.daily],
  );
  const weeklyRows = useMemo(
    () => (Array.isArray(entry?.weekly) ? entry.weekly : []),
    [entry?.weekly],
  );
  const inspectorName = entry?.inspector?.name || "Unassigned";

  return (
    <div className="card om-card">
      <div className="card-body p-0">
        <div className="px-3 py-2 border-bottom d-flex flex-wrap gap-2">
          <span className="fw-semibold">Inspector: {inspectorName}</span>
          <span className="om-summary-chip">
            Orders Touched: {entry?.orders_touched ?? 0}
          </span>
          <span className="om-summary-chip">
            Requested: {entry?.total_requested ?? 0}
          </span>
          <span className="om-summary-chip">
            Checked: {entry?.total_checked ?? 0}
          </span>
          <span className="om-summary-chip">
            Passed: {entry?.total_passed ?? 0}
          </span>
          <span className="om-summary-chip">
            Inspections: {entry?.total_inspections ?? 0}
          </span>
          <span className="om-summary-chip">
            CBM: {formatCbm(entry?.total_inspected_cbm)}
          </span>
        </div>

        <div className="row g-0">
          <div className="col-12 col-xxl-6 border-end-lg">
            <div className="table-responsive">
              <table className="table table-sm table-striped align-middle mb-0">
                <thead>
                  <tr>
                    <th colSpan="5" className="bg-body-tertiary">
                      Daily
                    </th>
                  </tr>
                  <tr>
                    <th>Date</th>
                    <th>Requested</th>
                    <th>Passed</th>
                    <th>Inspections</th>
                    <th>CBM</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyRows.length === 0 && (
                    <tr>
                      <td colSpan="5" className="text-center py-3">
                        No daily data.
                      </td>
                    </tr>
                  )}
                  {dailyRows.map((row) => (
                    <tr key={`${inspectorId}-day-${row.date}`}>
                      <td>{formatDateDDMMYYYY(row.date)}</td>
                      <td>{row.requested_quantity ?? 0}</td>
                      <td>{row.passed_quantity ?? 0}</td>
                      <td>{row.inspections_count ?? 0}</td>
                      <td>{formatCbm(row.inspected_cbm)}</td>
                    </tr>
                  ))}
                </tbody>
                {dailyRows.length > 0 && (
                  <tfoot>
                    <tr className="table-secondary">
                      <th>Total</th>
                      <th>{entry?.total_requested ?? 0}</th>
                      <th>{entry?.total_passed ?? 0}</th>
                      <th>{entry?.total_inspections ?? 0}</th>
                      <th>{formatCbm(entry?.total_inspected_cbm)}</th>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div className="col-12 col-xxl-6">
            <div className="table-responsive">
              <table className="table table-sm table-striped align-middle mb-0">
                <thead>
                  <tr>
                    <th colSpan="6" className="bg-body-tertiary">
                      Weekly
                    </th>
                  </tr>
                  <tr>
                    <th>Week Start</th>
                    <th>Week End</th>
                    <th>Requested</th>
                    <th>Passed</th>
                    <th>Inspections</th>
                    <th>CBM</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyRows.length === 0 && (
                    <tr>
                      <td colSpan="6" className="text-center py-3">
                        No weekly data.
                      </td>
                    </tr>
                  )}
                  {weeklyRows.map((row) => (
                    <tr key={`${inspectorId}-week-${row.week_start}`}>
                      <td>{formatDateDDMMYYYY(row.week_start)}</td>
                      <td>{formatDateDDMMYYYY(row.week_end)}</td>
                      <td>{row.requested_quantity ?? 0}</td>
                      <td>{row.passed_quantity ?? 0}</td>
                      <td>{row.inspections_count ?? 0}</td>
                      <td>{formatCbm(row.inspected_cbm)}</td>
                    </tr>
                  ))}
                </tbody>
                {weeklyRows.length > 0 && (
                  <tfoot>
                    <tr className="table-secondary">
                      <th colSpan="2">Total</th>
                      <th>{entry?.total_requested ?? 0}</th>
                      <th>{entry?.total_passed ?? 0}</th>
                      <th>{entry?.total_inspections ?? 0}</th>
                      <th>{formatCbm(entry?.total_inspected_cbm)}</th>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>

        <div className="border-top px-3 py-3">
          <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
            <span className="fw-semibold">CBM Trend</span>
            <span className="om-summary-chip">
              Step: {chartStep}
            </span>
            <span className="om-summary-chip">
              Charts: Line + Bar
            </span>
          </div>

          <InspectorReportCharts
            dailyRows={dailyRows}
            fromDate={fromDate}
            toDate={toDate}
            chartStep={chartStep}
          />
        </div>
      </div>
    </div>
  );
};

const InspectorCard = memo(InspectorCardComponent);

export default InspectorCard;
