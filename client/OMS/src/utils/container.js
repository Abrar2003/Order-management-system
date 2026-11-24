export const CONTAINER_NUMBER_REGEX = /^[A-Za-z]{4}-\d{6}-\d{1}$/;

export const CONTAINER_FORMAT_ERROR_MESSAGE =
  "Container number must be in the format 'AAAA-111111-2' (4 letters, hyphen, 6 digits, hyphen, 1 digit).";

export const isValidContainerNumber = (value) => {
  const normalized = String(value || "").trim();
  return CONTAINER_NUMBER_REGEX.test(normalized);
};

export const getWeeklyContainerArrivals = (containers, today) => {
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const start = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 6);
  const end = day.toISOString().slice(0, 10);

  const rows = containers
    .filter(({ shipping_ETA }) => shipping_ETA >= start && shipping_ETA <= end)
    .sort((a, b) =>
      a.shipping_ETA.localeCompare(b.shipping_ETA) || a.container.localeCompare(b.container),
    );

  return { start, end, rows };
};
