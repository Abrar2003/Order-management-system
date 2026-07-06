const DEFAULT_TZ = "Asia/Kolkata";
const DEFAULT_START = "21:00";
const DEFAULT_END = "07:00";

const normalizeText = (value) => String(value ?? "").trim();

const parseTimeToMinutes = (value = "", fallback = DEFAULT_START) => {
  const normalized = normalizeText(value || fallback);
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return parseTimeToMinutes(fallback, DEFAULT_START);
  const hours = Math.max(0, Math.min(23, Number(match[1])));
  const minutes = Math.max(0, Math.min(59, Number(match[2])));
  return hours * 60 + minutes;
};

const getZonedMinutes = (date = new Date(), timeZone = DEFAULT_TZ) => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
};

const isWithinProcessingWindow = ({
  now = new Date(),
  timeZone = process.env.QC_IMAGE_PROCESSING_TZ || DEFAULT_TZ,
  start = process.env.QC_IMAGE_WINDOW_START || DEFAULT_START,
  end = process.env.QC_IMAGE_WINDOW_END || DEFAULT_END,
} = {}) => {
  const current = getZonedMinutes(now, timeZone);
  const startMinutes = parseTimeToMinutes(start, DEFAULT_START);
  const endMinutes = parseTimeToMinutes(end, DEFAULT_END);

  if (startMinutes === endMinutes) return true;
  if (startMinutes < endMinutes) {
    return current >= startMinutes && current < endMinutes;
  }

  return current >= startMinutes || current < endMinutes;
};

module.exports = {
  DEFAULT_END,
  DEFAULT_START,
  DEFAULT_TZ,
  getZonedMinutes,
  isWithinProcessingWindow,
  parseTimeToMinutes,
};
