export const ITEM_DISCUSSION_TOPICS = [
  { key: "autocad", label: "AutoCAD" },
  { key: "shipping_marks", label: "Shipping Marks" },
  { key: "finish", label: "Finish" },
];
export const DISCUSSION_FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.mp4,.mov,.mkv,.xls,.xlsx";
export const DISCUSSION_MAX_TEXT = 5000;
export const getDiscussionFileError = (files) => {
  if (files.length > 10) return "Attach up to 10 files per message.";
  if (files.reduce((size, file) => size + file.size, 0) > 100 * 1024 * 1024) return "Keep attachments under 100 MB total per message.";
  for (const file of files) {
    const extension = `.${file.name.split(".").pop().toLowerCase()}`;
    if (!DISCUSSION_FILE_ACCEPT.split(",").includes(extension)) return "Use PDF, photos, videos, XLS, or XLSX files.";
    if (file.size < 1 || file.size > 50 * 1024 * 1024) return `${file.name} must be between 1 byte and 50 MB.`;
  }
  return "";
};
export const mergeDiscussionReplies = (older, newer) => {
  const byId = new Map([...older, ...newer].map((message) => [message._id, message]));
  return [...byId.values()].sort((a, b) => a._id.localeCompare(b._id));
};
