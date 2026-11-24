import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/axios";
import { formatCbm } from "../utils/cbm";
import { getWeeklyContainerArrivals } from "../utils/container";
import { formatDateDDMMYYYY, getTodayISODate } from "../utils/date";
import HomeCalendar from "./HomeCalendar";

const containerPath = (container) => `/containers?container=${encodeURIComponent(container)}`;

const HomeContainerArrivals = () => {
  const navigate = useNavigate();
  const [containers, setContainers] = useState(null);
  const [error, setError] = useState("");
  const loading = containers === null && !error;
  const today = getTodayISODate();
  const week = useMemo(() => getWeeklyContainerArrivals(containers || [], today), [containers, today]);

  useEffect(() => {
    const controller = new AbortController();

    const loadContainers = async () => {
      try {
        const response = await api.get("/orders/containers", { signal: controller.signal });
        setContainers(Array.isArray(response?.data?.data) ? response.data.data : []);
      } catch {
        if (!controller.signal.aborted) setError("Failed to load container ETAs.");
      }
    };

    loadContainers();
    return () => controller.abort();
  }, []);

  const events = useMemo(
    () => (containers || [])
      .filter(({ shipping_ETA }) => shipping_ETA)
      .map((row) => ({
        id: row.container,
        title: row.container,
        start: row.shipping_ETA,
        allDay: true,
        url: containerPath(row.container),
        extendedProps: row,
      })),
    [containers],
  );

  return (
    <>
      <div className="card om-card mt-3">
        <div className="card-body p-0">
          <div className="m-3">
            <h3 className="h5 mb-1" id="home-container-arrivals">This Week&apos;s Arriving Containers</h3>
            <p className="text-muted small mb-0">
              {formatDateDDMMYYYY(week.start)} – {formatDateDDMMYYYY(week.end)}
            </p>
          </div>
          <div className="table-responsive home-table-wrap">
            <table className="table table-striped table-hover align-middle om-table mb-0" aria-labelledby="home-container-arrivals">
              <thead className="table-primary">
                <tr>
                  <th>Container</th>
                  <th>Brand</th>
                  <th>Vendor</th>
                  <th>Shipping Date</th>
                  <th>ETD</th>
                  <th>ETA</th>
                  <th>Total CBM</th>
                </tr>
              </thead>
              <tbody>
                {week.rows.map((row) => (
                  <tr key={row.container}>
                    <td><Link to={containerPath(row.container)}>{row.container}</Link></td>
                    <td>{row.brand}</td>
                    <td>{row.vendor}</td>
                    <td>{formatDateDDMMYYYY(row.shipping_date)}</td>
                    <td>{formatDateDDMMYYYY(row.shipping_ETD)}</td>
                    <td>{formatDateDDMMYYYY(row.shipping_ETA)}</td>
                    <td>{formatCbm(row.total_cbm)}</td>
                  </tr>
                ))}
                {week.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-4">
                      {loading ? "Loading containers…" : error || "No containers have an ETA this week."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card om-card mt-3">
        <div className="card-body">
          <h3 className="h5 mb-3">Container ETA Calendar</h3>
          <HomeCalendar
            events={events}
            firstDay={1}
            now={today}
            eventClick={({ event, jsEvent }) => {
              if (jsEvent.metaKey || jsEvent.ctrlKey || jsEvent.shiftKey || jsEvent.altKey) return;
              jsEvent.preventDefault();
              navigate(event.url);
            }}
            eventDidMount={({ event, el }) => {
              const details = event.extendedProps;
              el.title = [
                `Container: ${details.container}`,
                `ETA: ${formatDateDDMMYYYY(details.shipping_ETA)}`,
                `Brand: ${details.brand}`,
                `Vendor: ${details.vendor}`,
              ].join("\n");
            }}
          >
            {error && <div className="alert alert-warning py-2 small mb-3">{error}</div>}
            {loading && <div className="small text-muted mb-2">Loading container ETAs…</div>}
          </HomeCalendar>
        </div>
      </div>
    </>
  );
};

export default HomeContainerArrivals;
