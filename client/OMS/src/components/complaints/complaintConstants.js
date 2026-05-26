export const COMPLAINT_STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "under_process", label: "Under Process" },
  { value: "resolved", label: "Resolved" },
];

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

export const getComplaintStatusLabel = (value) =>
  COMPLAINT_STATUS_OPTIONS.find((option) => option.value === value)?.label || "Open";

export const getComplaintStatusBadgeClass = (value) => {
  if (value === "resolved") return "text-bg-success";
  if (value === "under_process") return "text-bg-warning";
  return "text-bg-primary";
};

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
