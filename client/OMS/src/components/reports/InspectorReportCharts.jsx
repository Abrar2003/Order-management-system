import { memo, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDateDDMMYYYY, toISODateString } from "../../utils/date";
import { formatCbm } from "../../utils/cbm";

const DEFAULT_CHART_STEP = "weekly";
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const CHART_MARGIN = Object.freeze({ top: 8, right: 16, left: 8, bottom: 8 });
const AXIS_TICK = Object.freeze({ fontSize: 12 });
const LINE_ACTIVE_DOT = Object.freeze({ r: 4 });
const CHART_LABEL_DATA_KEY = "label";
const CHART_CBM_DATA_KEY = "cbm";
const monthYearFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const parseIsoDateUtc = (value) => {
  const isoValue = toISODateString(value);
  if (!isoValue) return null;

  const [year, month, day] = isoValue.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIsoDateUtc = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const addUtcDays = (date, days) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + Number(days || 0));
  return nextDate;
};

const addUtcMonths = (date, months) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + Number(months || 0),
    1,
  ));
};

const endOfUtcMonth = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    0,
  ));
};

const formatShortDateLabel = (value) => {
  const formatted = formatDateDDMMYYYY(value, "");
  if (!formatted) return "";
  return formatted.slice(0, 5);
};

const createDailyCbmMap = (dailyRows = []) => {
  const dateMap = new Map();

  for (const row of Array.isArray(dailyRows) ? dailyRows : []) {
    const isoDate = toISODateString(row?.date);
    if (!isoDate) continue;
    dateMap.set(isoDate, Number(row?.inspected_cbm || 0));
  }

  return dateMap;
};

const buildDailyChartData = ({ dailyRows = [], fromDate = "", toDate = "" } = {}) => {
  const startDate = parseIsoDateUtc(fromDate);
  const endDate = parseIsoDateUtc(toDate);
  if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) {
    return [];
  }

  const cbmByDate = createDailyCbmMap(dailyRows);
  const pointCount = Math.floor((endDate.getTime() - startDate.getTime()) / DAY_IN_MS) + 1;
  const points = new Array(pointCount);
  let cursor = new Date(startDate);

  for (let index = 0; index < pointCount; index += 1) {
    const isoDate = toIsoDateUtc(cursor);
    points[index] = {
      key: isoDate,
      label: formatShortDateLabel(isoDate) || isoDate,
      tooltipLabel: formatDateDDMMYYYY(isoDate),
      cbm: Number(cbmByDate.get(isoDate) || 0),
    };
    cursor = addUtcDays(cursor, 1);
  }

  return points;
};

const buildWeeklyChartData = ({ dailyRows = [], fromDate = "", toDate = "" } = {}) => {
  const startDate = parseIsoDateUtc(fromDate);
  const endDate = parseIsoDateUtc(toDate);
  if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) {
    return [];
  }

  const cbmByDate = createDailyCbmMap(dailyRows);
  const points = [];
  let weekIndex = 0;

  for (
    let bucketStart = new Date(startDate);
    bucketStart.getTime() <= endDate.getTime();
    bucketStart = addUtcDays(bucketStart, 7)
  ) {
    const bucketEnd = addUtcDays(bucketStart, 6);
    const effectiveEnd = bucketEnd && bucketEnd.getTime() < endDate.getTime()
      ? bucketEnd
      : endDate;

    let totalCbm = 0;
    for (
      let cursor = new Date(bucketStart);
      cursor.getTime() <= effectiveEnd.getTime();
      cursor = addUtcDays(cursor, 1)
    ) {
      totalCbm += Number(cbmByDate.get(toIsoDateUtc(cursor)) || 0);
    }

    const bucketStartIso = toIsoDateUtc(bucketStart);
    const effectiveEndIso = toIsoDateUtc(effectiveEnd);
    points.push({
      key: `${bucketStartIso}-${effectiveEndIso}`,
      label: formatShortDateLabel(bucketStartIso) || `W${weekIndex + 1}`,
      tooltipLabel: `${formatDateDDMMYYYY(bucketStartIso)} - ${formatDateDDMMYYYY(effectiveEndIso)}`,
      cbm: Number(totalCbm.toFixed(3)),
    });
    weekIndex += 1;
  }

  return points;
};

const buildMonthlyChartData = ({ dailyRows = [], fromDate = "", toDate = "" } = {}) => {
  const startDate = parseIsoDateUtc(fromDate);
  const endDate = parseIsoDateUtc(toDate);
  if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) {
    return [];
  }

  const cbmByDate = createDailyCbmMap(dailyRows);
  const points = [];

  for (
    let monthCursor = new Date(Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth(),
      1,
    ));
    monthCursor.getTime() <= endDate.getTime();
    monthCursor = addUtcMonths(monthCursor, 1)
  ) {
    const monthStart = monthCursor.getTime() < startDate.getTime()
      ? startDate
      : monthCursor;
    const monthEndCandidate = endOfUtcMonth(monthCursor);
    const monthEnd = monthEndCandidate && monthEndCandidate.getTime() < endDate.getTime()
      ? monthEndCandidate
      : endDate;

    let totalCbm = 0;
    for (
      let cursor = new Date(monthStart);
      cursor.getTime() <= monthEnd.getTime();
      cursor = addUtcDays(cursor, 1)
    ) {
      totalCbm += Number(cbmByDate.get(toIsoDateUtc(cursor)) || 0);
    }

    const monthStartIso = toIsoDateUtc(monthStart);
    const monthEndIso = toIsoDateUtc(monthEnd);
    points.push({
      key: `${monthStartIso}-${monthEndIso}`,
      label: monthYearFormatter.format(monthCursor),
      tooltipLabel: `${formatDateDDMMYYYY(monthStartIso)} - ${formatDateDDMMYYYY(monthEndIso)}`,
      cbm: Number(totalCbm.toFixed(3)),
    });
  }

  return points;
};

const buildInspectorChartData = ({
  dailyRows = [],
  fromDate = "",
  toDate = "",
  chartStep = DEFAULT_CHART_STEP,
} = {}) => {
  if (chartStep === "daily") {
    return buildDailyChartData({ dailyRows, fromDate, toDate });
  }

  if (chartStep === "monthly") {
    return buildMonthlyChartData({ dailyRows, fromDate, toDate });
  }

  return buildWeeklyChartData({ dailyRows, fromDate, toDate });
};

const getChartAxisMax = (chartData = []) => {
  const maxCbm = Math.max(
    0,
    ...chartData.map((point) => Number(point?.cbm || 0)),
  );

  return Math.max(0.05, Math.ceil(maxCbm / 0.05) * 0.05);
};

const formatChartAxisTick = (value) => Number(value).toFixed(2);

const InspectorCbmTooltip = ({ active, payload }) => {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="inspector-report-chart-tooltip">
      <div className="fw-semibold">{point.tooltipLabel || point.label}</div>
      <div>CBM: {formatCbm(point.cbm)}</div>
    </div>
  );
};

const InspectorReportChartsComponent = ({
  dailyRows,
  fromDate,
  toDate,
  chartStep,
}) => {
  const chartData = useMemo(() => buildInspectorChartData({
    dailyRows,
    fromDate,
    toDate,
    chartStep,
  }), [chartStep, dailyRows, fromDate, toDate]);
  const chartAxisMax = useMemo(
    () => getChartAxisMax(chartData),
    [chartData],
  );
  const chartAxisDomain = useMemo(() => [0, chartAxisMax], [chartAxisMax]);

  if (chartData.length === 0) {
    return (
      <div className="inspector-report-chart-wrap d-flex align-items-center justify-content-center text-secondary">
        No chart data available.
      </div>
    );
  }

  return (
    <div className="d-grid gap-3">
      <div className="inspector-report-chart-wrap">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey={CHART_LABEL_DATA_KEY}
              minTickGap={20}
              tick={AXIS_TICK}
            />
            <YAxis
              domain={chartAxisDomain}
              tick={AXIS_TICK}
              tickFormatter={formatChartAxisTick}
              width={56}
            />
            <Tooltip content={InspectorCbmTooltip} />
            <Line
              type="linear"
              dataKey={CHART_CBM_DATA_KEY}
              name="CBM"
              stroke="var(--bs-primary)"
              strokeWidth={2}
              dot={false}
              activeDot={LINE_ACTIVE_DOT}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="inspector-report-chart-wrap">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey={CHART_LABEL_DATA_KEY}
              minTickGap={20}
              tick={AXIS_TICK}
            />
            <YAxis
              domain={chartAxisDomain}
              tick={AXIS_TICK}
              tickFormatter={formatChartAxisTick}
              width={56}
            />
            <Tooltip content={InspectorCbmTooltip} />
            <Bar
              dataKey={CHART_CBM_DATA_KEY}
              name="CBM"
              fill="var(--bs-primary)"
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const InspectorReportCharts = memo(InspectorReportChartsComponent);

export default InspectorReportCharts;
