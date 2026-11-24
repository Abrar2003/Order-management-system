import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";

const HomeCalendar = ({ children, ...calendarProps }) => (
  <div className="home-calendar">
    {children}
    <FullCalendar
      plugins={[dayGridPlugin]}
      initialView="dayGridMonth"
      headerToolbar={{ left: "prev,next today", center: "title", right: "" }}
      buttonText={{ today: "Today" }}
      height="auto"
      fixedWeekCount={false}
      dayMaxEventRows={3}
      {...calendarProps}
    />
  </div>
);

export default HomeCalendar;
