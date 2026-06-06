const normalizeText = (value) => String(value || "").trim();

const truncateText = (value, maxLength = 120) => {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
};

const normalizeNameList = (value) => {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean).join(", ");
  }
  return normalizeText(value);
};

export const getNotificationCard = (notification = {}) => {
  const card = notification?.card || {};
  const metadata = notification?.metadata || {};
  const category = normalizeText(card.category || notification.category || "system");
  const priority = normalizeText(card.priority || notification.priority || "normal");
  const taskTitle =
    normalizeText(card.taskTitle) ||
    normalizeText(metadata.task_title) ||
    normalizeText(notification.message) ||
    normalizeText(notification.title);
  const comment =
    normalizeText(card.comment) ||
    normalizeText(metadata.comment_text) ||
    normalizeText(metadata.comment) ||
    (category === "comment" ? normalizeText(notification.message) : "");

  return {
    heading: normalizeText(card.heading) || normalizeText(notification.title) || "Notification",
    taskTitle,
    assigneeNames: normalizeNameList(card.assigneeNames),
    assignedByName: normalizeText(card.assignedByName || metadata.assigned_by_name),
    comment: truncateText(comment, 140),
    status: normalizeText(card.status || metadata.status),
    taskType: normalizeText(card.taskType || metadata.task_type_name || metadata.task_type_key),
    dueDateText: normalizeText(card.dueDateText || metadata.due_date_text),
    deepLink: normalizeText(card.deepLink || notification.deep_link),
    priority,
    category,
  };
};

export const getPopupEntryCard = (entry = {}, sectionLabel = "Workflow Task") => {
  const base = getNotificationCard(entry);
  const hasExplicitHeading = Boolean(normalizeText(entry?.card?.heading || entry.title));
  const taskTitle =
    normalizeText(base.taskTitle) ||
    normalizeText(entry.title) ||
    normalizeText(entry.task_no) ||
    normalizeText(entry.message) ||
    "Workflow task";
  const deepLink =
    normalizeText(base.deepLink) ||
    normalizeText(entry.deep_link) ||
    (entry._id ? `/workflow/tasks?task=${entry._id}` : "/workflow/tasks");

  return {
    ...base,
    heading: hasExplicitHeading ? base.heading : sectionLabel,
    taskTitle,
    assigneeNames: normalizeNameList(base.assigneeNames || entry.assigneeNames),
    assignedByName: normalizeText(base.assignedByName || entry.assignedByName || entry.assigned_by?.name),
    status: normalizeText(base.status || entry.status),
    taskType: normalizeText(base.taskType || entry.task_type_name || entry.task_type_key),
    dueDateText: normalizeText(base.dueDateText || entry.due_date_text),
    deepLink,
  };
};

export const hasWorkflowCardDetails = (card = {}) =>
  Boolean(card.taskTitle || card.assigneeNames || card.assignedByName || card.status || card.taskType || card.dueDateText || card.comment);
