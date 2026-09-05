const normalizeText = (value) => String(value || "").trim();

const truncateText = (value, maxLength = 120) => {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
};

export const getNotificationCard = (notification = {}) => {
  const card = notification?.card || {};
  const metadata = notification?.metadata || {};
  const category = normalizeText(card.category || notification.category || "system");
  const priority = normalizeText(card.priority || notification.priority || "normal");
  const body =
    normalizeText(card.body) ||
    normalizeText(notification.message) ||
    normalizeText(notification.title);
  const comment =
    normalizeText(card.comment) ||
    normalizeText(metadata.comment_text) ||
    normalizeText(metadata.comment) ||
    (category === "comment" ? normalizeText(notification.message) : "");

  return {
    heading: normalizeText(card.heading) || normalizeText(notification.title) || "Notification",
    body,
    comment: truncateText(comment, 140),
    deepLink: normalizeText(card.deepLink || notification.deep_link),
    priority,
    category,
  };
};
