import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getEtdCalendarOrders } from "../services/orders.service";
import { formatDateDDMMYYYY } from "../utils/date";

const STATUS_COLORS = Object.freeze({
  Pending: { backgroundColor: "#6c757d", borderColor: "#6c757d" },
  "Under Inspection": { backgroundColor: "#b7791f", borderColor: "#b7791f" },
  "Inspection Done": { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  "Partial Shipped": { backgroundColor: "#7c3aed", borderColor: "#7c3aed" },
  Shipped: { backgroundColor: "#198754", borderColor: "#198754" },
});

const toDateOnly = (value = "") => String(value).slice(0, 10);

const POEtdCalendar = ({ brand = "" }) => {
  const navigate = useNavigate();
  const [range, setRange] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!range || !brand) {
      setOrders([]);
      setError("");
      setLoading(false);
      return undefined;
    }
    let active = true;

    const loadOrders = async () => {
      try {
        setLoading(true);
        setError("");
        setOrders([]);
        const response = await getEtdCalendarOrders({ brand, ...range });
        if (active) {
          setOrders(Array.isArray(response?.data) ? response.data : []);
        }
      } catch (requestError) {
        if (active) {
          setOrders([]);
          setError("Failed to load PO ETDs.");
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadOrders();
    return () => {
      active = false;
    };
  }, [brand, range]);

  const events = useMemo(
    () =>
      orders.map((order) => {
        const colors = STATUS_COLORS[order?.status] || STATUS_COLORS.Pending;
        return {
          id: order?.id,
          title: [order?.order_id, order?.vendor].filter(Boolean).join(" • "),
          start: order?.etd,
          allDay: true,
          ...colors,
          extendedProps: order,
        };
      }),
    [orders],
  );

  return (
    <div className="home-po-etd-calendar">
      <div className="home-po-etd-calendar-legend" aria-label="PO status colors">
        {Object.entries(STATUS_COLORS).map(([status, colors]) => (
          <span key={status} className="home-po-etd-calendar-legend-item">
            <span
              className="home-po-etd-calendar-legend-swatch"
              style={{ backgroundColor: colors.backgroundColor }}
            />
            {status}
          </span>
        ))}
      </div>
      {error && <div className="alert alert-warning py-2 small mb-3">{error}</div>}
      {loading && <div className="small text-muted mb-2">Loading PO ETDs...</div>}
      <FullCalendar
        plugins={[dayGridPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{ left: "prev,next today", center: "title", right: "" }}
        buttonText={{ today: "Today" }}
        events={events}
        height="auto"
        fixedWeekCount={false}
        dayMaxEventRows={3}
        eventClick={({ event }) => {
          const orderId = String(event.extendedProps?.order_id || "").trim();
          if (orderId) navigate(`/orders?order_id=${encodeURIComponent(orderId)}`);
        }}
        eventDidMount={({ event, el }) => {
          const details = event.extendedProps;
          el.title = [
            `PO: ${details?.order_id || "N/A"}`,
            `Vendor: ${details?.vendor || "N/A"}`,
            `ETD: ${formatDateDDMMYYYY(details?.etd, "N/A")}`,
            `Status: ${details?.status || "N/A"}`,
            details?.brand ? `Brand: ${details.brand}` : "",
            details?.country ? `Country: ${details.country}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        }}
        datesSet={({ startStr, endStr }) =>
          setRange((previous) => {
            const next = { start: toDateOnly(startStr), end: toDateOnly(endStr) };
            return previous?.start === next.start && previous?.end === next.end
              ? previous
              : next;
          })
        }
      />
    </div>
  );
};

export default POEtdCalendar;
