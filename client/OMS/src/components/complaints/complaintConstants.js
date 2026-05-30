export const COMPLAINT_FILE_ACCEPT = [
  ".pdf",
  ".xls",
  ".xlsx",
  ".csv",
  ".png",
  ".jpeg",
  ".jpg",
  ".webp",
  ".mp4",
  ".mkv",
  ".mov",
  ".doc",
  ".docx",
  ".txt",
].join(",");

export const formatComplaintDateTime = (value) => {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "N/A";
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const getFileTypeLabel = (file = {}) => {
  const name = String(file.original_name || file.file_name || "").trim();
  const extension = name.includes(".") ? name.split(".").pop().toUpperCase() : "";
  return extension || String(file.mime_type || "File").split("/").pop().toUpperCase();
};

export const isComplaintImageFile = (file = {}) => {
  const mimeType = String(file.mime_type || "").toLowerCase();
  if (mimeType.startsWith("image/")) return true;

  const name = String(file.original_name || file.file_name || "").toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif"].some((extension) =>
    name.endsWith(extension),
  );
};
