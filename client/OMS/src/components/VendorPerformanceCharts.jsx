import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const MAX_CHART_ROWS = 12;
const monthFormatter = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const STATUS_COLORS = {
  Delayed: "#dc3545",
  Early: "#198754",
  "On time": "#0d6efd",
  "Inspection pending": "#fd7e14",
  "Inspection overdue": "#dc3545",
  Unknown: "#6c757d",
};
const monthlyColor = (index, total) => `hsl(${Math.round(index * 360 / Math.max(1, total))} 65% 44%)`;

const finiteNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const chartRows = (rows, keys) => rows
  .filter((row) => keys.some((key) => finiteNumber(row?.[key]) !== null))
  .slice()
  .sort((left, right) => Math.max(...keys.map((key) => Math.abs(finiteNumber(right?.[key]) || 0))) - Math.max(...keys.map((key) => Math.abs(finiteNumber(left?.[key]) || 0))))
  .slice(0, MAX_CHART_ROWS);
const tenureClaimAverages = (rows) => {
  const totals = new Map();
  rows.forEach((row) => (row.tenures || []).forEach((tenure) => {
    const from_date = String(tenure?.from_date || "");
    const to_date = String(tenure?.to_date || "");
    if (!from_date || !to_date) return;
    const key = String(tenure?.tenure_id || `${row?.brand || ""}:${from_date}:${to_date}`);
    const total = totals.get(key) || { brand: row?.brand || "", from_date, to_date, item_count: 0, delivered_quantity: 0, rejected_quantity: 0 };
    total.item_count += 1;
    total.delivered_quantity += finiteNumber(tenure?.delivered_quantity) || 0;
    total.rejected_quantity += finiteNumber(tenure?.rejected_quantity) || 0;
    totals.set(key, total);
  }));
  return [...totals.values()]
    .map((total) => ({ ...total, label: [total.brand, `${total.from_date} to ${total.to_date}`].filter(Boolean).join(" · "), average_claim_percentage: total.delivered_quantity > 0 ? Number((total.rejected_quantity / total.delivered_quantity * 100).toFixed(2)) : 0 }))
    .sort((left, right) => left.from_date.localeCompare(right.from_date) || left.to_date.localeCompare(right.to_date) || left.brand.localeCompare(right.brand));
};
const poLabel = (row) => [row?.po, row?.brand].filter(Boolean).join(" · ") || "PO";
const poStatus = (row) => row?.is_overdue_inspection_pending
  ? "Inspection overdue"
  : row?.is_inspection_pending ? "Inspection pending" : row?.status || "Unknown";
const counts = (rows, getLabel) => Object.entries(rows.reduce((result, row) => {
  const label = getLabel(row);
  result[label] = (result[label] || 0) + 1;
  return result;
}, {})).map(([label, count]) => ({ label, count }));
const stuffingStatusCounts = (rows) => rows.reduce((result, row) => {
  const packed = row?.packed_status || "Unknown";
  const etd = row?.etd_status || "Unknown";
  (result[packed] ||= { packed: 0, etd: 0 }).packed += 1;
  (result[etd] ||= { packed: 0, etd: 0 }).etd += 1;
  return result;
}, {});
const monthlyDelayChartData = (rows, dateKey, delayKey) => {
  const byMonth = new Map();
  rows
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.[dateKey] || "")) && finiteNumber(row?.[delayKey]) !== null)
    .slice()
    .sort((left, right) => String(left[dateKey]).localeCompare(String(right[dateKey])) || poLabel(left).localeCompare(poLabel(right)))
    .forEach((row) => {
      const month = String(row[dateKey]).slice(0, 7);
      byMonth.set(month, [...(byMonth.get(month) || []), { po: poLabel(row), difference_days: finiteNumber(row[delayKey]) }]);
    });
  const groups = [...byMonth.entries()];
  return {
    slots: Math.max(0, ...groups.map(([, rowsForMonth]) => rowsForMonth.length)),
    data: groups.map(([month, rowsForMonth], monthIndex) => rowsForMonth.reduce((result, row, index) => ({
      ...result,
      [`po_${index}`]: row.difference_days,
      [`po_${index}_label`]: row.po,
    }), {
      month,
      label: monthFormatter.format(new Date(`${month}-01T00:00:00Z`)),
      color: monthlyColor(monthIndex, groups.length),
      average_delay: rowsForMonth.reduce((sum, row) => sum + row.difference_days, 0) / rowsForMonth.length,
    })),
  };
};

const ChartCard = ({ title, children }) => (
  <div className="card border-0 bg-light h-100">
    <div className="card-body">
      <h3 className="h6 mb-3">{title}</h3>
      {children}
    </div>
  </div>
);

const HorizontalBars = ({ data, series, valueSuffix = "", height = 300, tooltipContent }) => (
  <div style={{ height }} role="img" aria-label="Vendor performance chart">
    <ResponsiveContainer>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(value) => `${value}${valueSuffix}`} />
        <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11 }} />
        <Tooltip content={tooltipContent} formatter={(value, name) => [`${value}${valueSuffix}`, name]} />
        {series.map((entry) => (
          <Bar key={entry.key} dataKey={entry.key} name={entry.name} fill={entry.color} isAnimationActive={false}>
            {entry.colorFor ? data.map((row) => <Cell key={row.label} fill={entry.colorFor(row)} />) : null}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  </div>
);

const TenureClaimTooltip = ({ active, payload }) => {
  const row = active ? payload?.[0]?.payload : null;
  return row ? <div className="bg-white border rounded shadow-sm p-2 small"><div className="fw-semibold">{row.label}</div><div className="text-danger">Average claim: {row.average_claim_percentage.toFixed(2)}%</div><div>Total items: {row.item_count}</div></div> : null;
};

const MonthlyDelayTooltip = ({ active, payload }) => {
  const row = active ? payload?.[0]?.payload : null;
  const poRows = (payload || []).filter((entry) => entry.dataKey?.startsWith("po_") && finiteNumber(entry?.value) !== null);
  return row ? <div className="bg-white border rounded shadow-sm p-2 small"><div className="fw-semibold">{row.label}</div><div>Average delay: {row.average_delay.toFixed(1)} days</div>{poRows.map((entry) => <div key={entry.dataKey}>{row[`${entry.dataKey}_label`]}: {entry.value} days {entry.value > 0 ? "delayed" : entry.value < 0 ? "early" : "on time"}</div>)}</div> : null;
};

export const VendorPerformanceMonthlyDelayChart = ({ rows = [], dateKey = "etd", delayKey = "difference_days", title = "Monthly PO delay: ETD vs final packed" }) => {
  const chart = useMemo(() => monthlyDelayChartData(rows, dateKey, delayKey), [rows, dateKey, delayKey]);
  if (chart.data.length === 0) return null;
  return <div className="p-3 pb-0"><ChartCard title={title}><div style={{ height: 440 }} role="img" aria-label={title}>
    <ResponsiveContainer>
      <ComposedChart data={chart.data} margin={{ top: 24, right: 24, left: 8, bottom: 12 }} barCategoryGap={0} barGap={0}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" interval={0} height={42} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} label={{ value: "Days", angle: -90, position: "insideLeft" }} />
        <Tooltip content={<MonthlyDelayTooltip />} />
        <Legend verticalAlign="top" height={24} />
        {Array.from({ length: chart.slots }, (_, index) => <Bar key={index} dataKey={`po_${index}`} name="PO delay" legendType="none" fill="#0d6efd" isAnimationActive={false}>{chart.data.map((row) => <Cell key={row.month} fill={row.color} />)}</Bar>)}
        <Line type="linear" dataKey="average_delay" name="Average delay" stroke="#212529" strokeWidth={2.5} dot={{ r: 4, fill: "#212529" }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  </div></ChartCard></div>;
};

const VendorPerformanceCharts = ({ section, rows = [] }) => {
  const charts = useMemo(() => {
    if (section === "po_delay") {
      return {
        delays: chartRows(rows, ["difference_days"]).map((row) => ({ label: poLabel(row), difference_days: finiteNumber(row.difference_days) })),
        statuses: counts(rows, poStatus),
      };
    }
    if (section === "product_complaints") {
      return {
        claims: tenureClaimAverages(rows),
      };
    }
    if (section === "shipping_delay") {
      const statusCounts = stuffingStatusCounts(rows);
      return {
        delays: chartRows(rows, ["packed_difference_days"]).map((row) => ({
          label: poLabel(row),
          packed_difference_days: finiteNumber(row.packed_difference_days),
        })),
        statuses: ["Early", "On time", "Delayed", "Unknown"].map((label) => ({
          label,
          packed: statusCounts[label]?.packed || 0,
          etd: statusCounts[label]?.etd || 0,
        })).filter((row) => row.packed || row.etd),
      };
    }
    return {};
  }, [rows, section]);

  if (section === "po_delay" && (charts.delays.length || charts.statuses.length)) return <div className="row g-3 p-3 pb-0">
    {charts.delays.length > 0 && <div className="col-xl-7"><ChartCard title="ETD vs final packed"><HorizontalBars data={charts.delays} valueSuffix=" days" series={[{ key: "difference_days", name: "ETD vs final packed", color: "#0d6efd", colorFor: (row) => row.difference_days > 0 ? "#dc3545" : row.difference_days < 0 ? "#198754" : "#0d6efd" }]} /></ChartCard></div>}
    {charts.statuses.length > 0 && <div className="col-xl-5"><ChartCard title="PO status breakdown"><HorizontalBars data={charts.statuses} series={[{ key: "count", name: "POs", color: "#0d6efd", colorFor: (row) => STATUS_COLORS[row.label] || STATUS_COLORS.Unknown }]} /></ChartCard></div>}
  </div>;

  if (section === "product_complaints" && charts.claims.length > 0) return <div className="p-3 pb-0"><ChartCard title="Average claim rate by tenure"><HorizontalBars data={charts.claims} valueSuffix="%" height={Math.max(280, charts.claims.length * 34)} tooltipContent={<TenureClaimTooltip />} series={[{ key: "average_claim_percentage", name: "Average claim", color: "#dc3545" }]} /></ChartCard></div>;

  if (section === "shipping_delay" && (charts.delays.length || charts.statuses.length)) return <div className="row g-3 p-3 pb-0">
    {charts.delays.length > 0 && <div className="col-xl-7"><ChartCard title="Final packed vs stuffing"><HorizontalBars data={charts.delays} valueSuffix=" days" series={[{ key: "packed_difference_days", name: "Stuffing vs final packed", color: "#6f42c1" }]} /></ChartCard></div>}
    {charts.statuses.length > 0 && <div className="col-xl-5"><ChartCard title="Stuffing status breakdown"><HorizontalBars data={charts.statuses} series={[{ key: "packed", name: "vs final packed", color: "#6f42c1" }, { key: "etd", name: "vs ETD", color: "#fd7e14" }]} /></ChartCard></div>}
  </div>;

  return null;
};

export default VendorPerformanceCharts;
