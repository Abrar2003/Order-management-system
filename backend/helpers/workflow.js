const path = require("path");

const WORKFLOW_TASK_STATUSES = Object.freeze([
  "assigned",
  "complete",
  "approved",
  "uploaded",
]);

const WORKFLOW_LEGACY_TASK_STATUSES = Object.freeze([
  "pending",
  "in_progress",
  "submitted",
  "review",
  "rework",
  "completed",
  "cancelled",
  "blocked",
]);

const WORKFLOW_ALL_TASK_STATUSES = Object.freeze([
  ...WORKFLOW_TASK_STATUSES,
  ...WORKFLOW_LEGACY_TASK_STATUSES,
]);

const WORKFLOW_BATCH_STATUSES = Object.freeze([
  "draft",
  "tasks_created",
  "in_progress",
  "completed",
  "cancelled",
  "failed",
]);

const WORKFLOW_ASSIGNMENT_MODES = Object.freeze(["manual", "auto"]);
const WORKFLOW_TASK_ASSIGNMENT_STATUSES = Object.freeze([
  "active",
  "removed",
  "completed",
]);
const WORKFLOW_TASK_COMMENT_TYPES = Object.freeze([
  "general",
  "complete",
  "approval",
  "upload",
  "review",
  "rework",
  "system",
]);
const WORKFLOW_TASK_PRIORITIES = Object.freeze([
  "low",
  "normal",
  "high",
  "urgent",
]);
const WORKFLOW_TASK_TYPE_CATEGORIES = Object.freeze([
  "image",
  "pis",
  "cad",
  "three_d",
  "carton",
  "sticker",
  "other",
]);
const WORKFLOW_AUTO_CREATE_MODES = Object.freeze([
  "per_file",
  "per_direct_subfolder",
  "once_per_batch",
  "manual",
]);

const WORKFLOW_ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  assigned: ["complete"],
  complete: ["approved"],
  approved: ["uploaded"],
  uploaded: [],
});

const MAX_WORKFLOW_MANIFEST_ENTRIES = 10000;
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const CAD_EXTENSIONS = new Set(["dwg", "dxf"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const EXCEL_EXTENSIONS = new Set(["xls", "xlsx", "xlsm", "csv"]);
const THREE_D_EXTENSIONS = new Set([
  "3ds",
  "blend",
  "fbx",
  "glb",
  "gltf",
  "max",
  "obj",
  "stl",
]);

const normalizeText = (value) => String(value ?? "").trim();

const collapseWhitespace = (value) => normalizeText(value).replace(/\s+/g, " ");

const normalizeKey = (value) =>
  collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeNameKey = (value) => normalizeKey(value);

const normalizeFolderSegment = (value) => {
  const normalized = collapseWhitespace(value);
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("Folder path contains an invalid segment");
  }
  return normalized;
};

const sanitizeManifestPath = (value, { allowEmpty = false } = {}) => {
  const normalizedValue = normalizeText(value).replace(/\\/g, "/");
  if (!normalizedValue) {
    if (allowEmpty) return "";
    throw new Error("Path is required");
  }

  if (
    normalizedValue.startsWith("/") ||
    /^[a-z]:/i.test(normalizedValue) ||
    normalizedValue.includes("\0")
  ) {
    throw new Error("Absolute paths are not allowed in the file manifest");
  }

  const segments = normalizedValue
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(normalizeFolderSegment);

  if (segments.length === 0) {
    if (allowEmpty) return "";
    throw new Error("Path is required");
  }

  return segments.join("/");
};

const normalizeFolderKey = (value) =>
  sanitizeManifestPath(value || "", { allowEmpty: false })
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeSourceFolderName = (value) => sanitizeManifestPath(value || "", { allowEmpty: false });

const normalizeSourceFolderKey = (value) => normalizeFolderKey(value);

const normalizeExtension = (value, fallbackName = "") => {
  const rawValue = normalizeText(value).replace(/^\./, "").toLowerCase();
  if (rawValue) return rawValue;
  const parsed = path.posix.extname(normalizeText(fallbackName));
  return parsed ? parsed.slice(1).toLowerCase() : "";
};

const classifyFileType = (extension = "", mimeType = "") => {
  const normalizedExtension = normalizeExtension(extension);
  const normalizedMimeType = normalizeText(mimeType).toLowerCase();

  if (IMAGE_EXTENSIONS.has(normalizedExtension) || normalizedMimeType.startsWith("image/")) {
    return "image";
  }
  if (CAD_EXTENSIONS.has(normalizedExtension)) {
    return "cad";
  }
  if (PDF_EXTENSIONS.has(normalizedExtension) || normalizedMimeType === "application/pdf") {
    return "pdf";
  }
  if (
    EXCEL_EXTENSIONS.has(normalizedExtension) ||
    normalizedMimeType.includes("spreadsheet") ||
    normalizedMimeType.includes("excel") ||
    normalizedMimeType === "text/csv"
  ) {
    return "excel";
  }
  if (THREE_D_EXTENSIONS.has(normalizedExtension)) {
    return "three_d";
  }
  return "other";
};

const toNonNegativeInteger = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
};

const buildSourceFileMetadata = (entry = {}, { sourceFolderName = "" } = {}) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("Each file manifest entry must be an object");
  }

  const fallbackName = normalizeText(entry.name)
    || path.posix.basename(normalizeText(entry.relative_path).replace(/\\/g, "/"));
  const name = path.posix.basename(fallbackName);
  if (!name) {
    throw new Error("File manifest entry name is required");
  }

  const relativePathInput = normalizeText(entry.relative_path) || name;
  const relativePath = sanitizeManifestPath(relativePathInput);
  const derivedFolderPath = path.posix.dirname(relativePath);
  const folderPathInput = normalizeText(entry.folder_path) || derivedFolderPath || sourceFolderName;
  const folderPath = sanitizeManifestPath(folderPathInput);
  const extension = normalizeExtension(entry.extension, name);
  const mimeType = normalizeText(entry.mime_type).toLowerCase();
  const sizeBytes = toNonNegativeInteger(entry.size_bytes, 0);
  const fileType = classifyFileType(extension, mimeType);

  return {
    name,
    relative_path: relativePath,
    folder_path: folderPath,
    extension,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    file_type: fileType,
  };
};

const isTempManifestFile = (filename = "") => {
  const name = String(filename || "").trim();
  if (!name) return true;
  if (name.startsWith(".~lock.")) return true;
  if (name.startsWith("~$")) return true;
  if (name.endsWith("#")) return true;
  if (name.startsWith(".")) return true;
  return false;
};

const normalizeFileManifest = (entries = [], { sourceFolderName = "" } = {}) => {
  if (!Array.isArray(entries)) {
    throw new Error("file_manifest must be an array");
  }
  
  const validEntries = entries.filter((entry) => !isTempManifestFile(entry?.name));

  if (validEntries.length === 0 && entries.length > 0) {
    throw new Error("file_manifest contains only ignored/temporary files");
  }
  if (validEntries.length === 0) {
    throw new Error("file_manifest must contain at least one file entry");
  }
  if (validEntries.length > MAX_WORKFLOW_MANIFEST_ENTRIES) {
    throw new Error(
      `file_manifest cannot exceed ${MAX_WORKFLOW_MANIFEST_ENTRIES} entries`,
    );
  }

  return validEntries.map((entry) => buildSourceFileMetadata(entry, { sourceFolderName }));
};

const stripRootFolderPrefix = (filePath = "", sourceFolderName = "") => {
  const normalizedPath = sanitizeManifestPath(filePath || "", { allowEmpty: true });
  const normalizedRoot = sanitizeManifestPath(sourceFolderName || "", { allowEmpty: true });
  if (!normalizedPath || !normalizedRoot) return normalizedPath;

  const pathSegments = normalizedPath.split("/");
  const rootSegments = normalizedRoot.split("/");
  const normalizedPathSegments = pathSegments.map((segment) => segment.toLowerCase());
  const normalizedRootSegments = rootSegments.map((segment) => segment.toLowerCase());

  const matchesRoot = normalizedRootSegments.every(
    (segment, index) => normalizedPathSegments[index] === segment,
  );

  return matchesRoot ? pathSegments.slice(rootSegments.length).join("/") : normalizedPath;
};

const getDirectSubfolderName = (entry = {}, sourceFolderName = "") => {
  const targetPath = entry.folder_path || entry.relative_path || "";
  const normalizedRelative = stripRootFolderPrefix(targetPath, sourceFolderName);
  const segments = normalizedRelative.split("/").filter(Boolean);
  return segments.length > 0 ? segments[0] : "";
};

const summarizeManifestCounts = (entries = []) => {
  const counts = {
    total_files: 0,
    image_files: 0,
    cad_files: 0,
    pdf_files: 0,
    excel_files: 0,
    three_d_files: 0,
    other_files: 0,
  };

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    counts.total_files += 1;
    switch (entry?.file_type) {
      case "image":
        counts.image_files += 1;
        break;
      case "cad":
        counts.cad_files += 1;
        break;
      case "pdf":
        counts.pdf_files += 1;
        break;
      case "excel":
        counts.excel_files += 1;
        break;
      case "three_d":
        counts.three_d_files += 1;
        break;
      default:
        counts.other_files += 1;
        break;
    }
  });

  return counts;
};

const buildEmptyTaskCounts = () => ({
  total_tasks: 0,
  assigned_tasks: 0,
  complete_tasks: 0,
  approved_tasks: 0,
  uploaded_tasks: 0,
  reworked_tasks: 0,
});

const buildBatchCounts = (fileCounts = {}, taskCounts = {}) => ({
  ...summarizeManifestCounts([]),
  ...buildEmptyTaskCounts(),
  ...(fileCounts || {}),
  ...(taskCounts || {}),
});

const buildWorkflowBatchNo = (id, date = new Date()) => {
  const dateKey = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
  const idSuffix = String(id || "").slice(-6).toUpperCase();
  return `WFB-${dateKey}-${idSuffix}`;
};

const buildWorkflowManualTaskNo = (id, date = new Date()) => {
  const dateKey = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
  const idSuffix = String(id || "").slice(-6).toUpperCase();
  return `WMT-${dateKey}-${idSuffix}`;
};

const buildWorkflowTaskNo = (batchNo = "", index = 0) =>
  `${normalizeText(batchNo)}-${String(Number(index) + 1).padStart(3, "0")}`;

const isObjectIdLike = (value) =>
  /^[a-f0-9]{24}$/i.test(String(value || "").trim());

const normalizeWorkflowTaskStatus = (value, { fallback = "" } = {}) => {
  const normalized = normalizeText(value).toLowerCase();
  switch (normalized) {
    case "pending":
    case "in_progress":
    case "assigned":
    case "rework":
      return "assigned";
    case "submitted":
    case "review":
    case "complete":
      return "complete";
    case "approved":
      return "approved";
    case "uploaded":
    case "completed":
      return "uploaded";
    case "cancelled":
    case "blocked":
      return fallback;
    default:
      return WORKFLOW_TASK_STATUSES.includes(normalized) ? normalized : fallback || normalized;
  }
};

const WORKFLOW_STATUS_QUERY_ALIASES = Object.freeze({
  assigned: ["assigned", "pending", "in_progress", "rework"],
  complete: ["complete", "submitted", "review"],
  approved: ["approved"],
  uploaded: ["uploaded", "completed"],
});

const getWorkflowStatusFilterValues = (value) => {
  const normalized = normalizeWorkflowTaskStatus(value, { fallback: "" });
  return WORKFLOW_STATUS_QUERY_ALIASES[normalized] || [];
};

const buildWorkflowTaskStatusNormalizationExpression = (fieldPath = "$status") => ({
  $switch: {
    branches: [
      {
        case: {
          $in: [fieldPath, ["assigned", "pending", "in_progress", "rework"]],
        },
        then: "assigned",
      },
      {
        case: {
          $in: [fieldPath, ["complete", "submitted", "review"]],
        },
        then: "complete",
      },
      {
        case: {
          $eq: [fieldPath, "approved"],
        },
        then: "approved",
      },
      {
        case: {
          $in: [fieldPath, ["uploaded", "completed"]],
        },
        then: "uploaded",
      },
    ],
    default: fieldPath,
  },
});

module.exports = {
  CAD_EXTENSIONS,
  EXCEL_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MAX_WORKFLOW_MANIFEST_ENTRIES,
  PDF_EXTENSIONS,
  THREE_D_EXTENSIONS,
  WORKFLOW_ALL_TASK_STATUSES,
  WORKFLOW_ALLOWED_STATUS_TRANSITIONS,
  WORKFLOW_ASSIGNMENT_MODES,
  WORKFLOW_BATCH_STATUSES,
  WORKFLOW_AUTO_CREATE_MODES,
  WORKFLOW_LEGACY_TASK_STATUSES,
  WORKFLOW_TASK_ASSIGNMENT_STATUSES,
  WORKFLOW_TASK_COMMENT_TYPES,
  WORKFLOW_TASK_PRIORITIES,
  WORKFLOW_TASK_STATUSES,
  WORKFLOW_TASK_TYPE_CATEGORIES,
  buildBatchCounts,
  buildWorkflowTaskStatusNormalizationExpression,
  buildEmptyTaskCounts,
  buildSourceFileMetadata,
  buildWorkflowBatchNo,
  buildWorkflowManualTaskNo,
  buildWorkflowTaskNo,
  classifyFileType,
  collapseWhitespace,
  getWorkflowStatusFilterValues,
  getDirectSubfolderName,
  isObjectIdLike,
  normalizeFileManifest,
  normalizeFolderKey,
  normalizeKey,
  normalizeNameKey,
  normalizeSourceFolderKey,
  normalizeSourceFolderName,
  normalizeWorkflowTaskStatus,
  normalizeText,
  sanitizeManifestPath,
  stripRootFolderPrefix,
  summarizeManifestCounts,
};
