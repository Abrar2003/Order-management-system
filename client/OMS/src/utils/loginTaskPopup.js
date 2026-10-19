import { APP_DATE_TIMEZONE } from "./date.js";

export const TASK_POPUP_LOGIN_KEY = "oms:task-popup:login";

const reminderTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_DATE_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const getTaskPopupSlot = (now = new Date()) => {
  const parts = Object.fromEntries(
    reminderTime.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (minutes < 10 * 60 || minutes >= 18 * 60) return null;
  // Catch up each scheduled reminder once, until the next slot or 6 pm IST.
  return `${parts.year}-${parts.month}-${parts.day}:${minutes < 15 * 60 + 30 ? "morning" : "afternoon"}`;
};

export const getRemainingTasks = (tasks = []) =>
  (Array.isArray(tasks) ? tasks : []).filter((task) => Number(task?.pending_count) > 0);
