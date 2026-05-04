const normalizeText = (value) => String(value ?? "").trim();

export const WORKFLOW_IMAGE_EXTENSIONS = Object.freeze([
  "jpg",
  "jpeg",
  "png",
  "webp",
]);

export const WORKFLOW_CAD_EXTENSIONS = Object.freeze(["dwg", "dxf"]);
export const WORKFLOW_PDF_EXTENSIONS = Object.freeze(["pdf"]);
export const WORKFLOW_EXCEL_EXTENSIONS = Object.freeze([
  "xls",
  "xlsx",
  "xlsm",
  "csv",
]);
export const WORKFLOW_THREE_D_EXTENSIONS = Object.freeze([
  "3ds",
  "blend",
  "fbx",
  "glb",
  "gltf",
  "max",
  "obj",
  "stl",
]);

const IMAGE_EXTENSION_SET = new Set(WORKFLOW_IMAGE_EXTENSIONS);
const CAD_EXTENSION_SET = new Set(WORKFLOW_CAD_EXTENSIONS);
const PDF_EXTENSION_SET = new Set(WORKFLOW_PDF_EXTENSIONS);
const EXCEL_EXTENSION_SET = new Set(WORKFLOW_EXCEL_EXTENSIONS);
const THREE_D_EXTENSION_SET = new Set(WORKFLOW_THREE_D_EXTENSIONS);

const toLowerSet = (values = []) =>
  new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeText(value).replace(/^\./, "").toLowerCase())
      .filter(Boolean),
  );

const matchesPatternList = (value, patterns = []) => {
  const normalizedValue = normalizeText(value).toLowerCase();
  if (!Array.isArray(patterns) || patterns.length === 0) return true;
  return patterns.some((pattern) =>
    normalizedValue.includes(normalizeText(pattern).toLowerCase()),
  );
};

const normalizeRelativePath = (value = "") =>
  normalizeText(value).replace(/\\/g, "/").replace(/^\/+/, "");

export const getExtension = (filename = "") => {
  const normalized = normalizeText(filename);
  const index = normalized.lastIndexOf(".");
  if (index < 0) return "";
  return normalized.slice(index + 1).toLowerCase();
};

export const classifyFileType = (extension = "", mimeType = "") => {
  const normalizedExtension = getExtension(extension).replace(/^\./, "") || normalizeText(extension).replace(/^\./, "").toLowerCase();
  const normalizedMimeType = normalizeText(mimeType).toLowerCase();

  if (
    IMAGE_EXTENSION_SET.has(normalizedExtension)
    || normalizedMimeType.startsWith("image/")
  ) {
    return "image";
  }
  if (CAD_EXTENSION_SET.has(normalizedExtension)) {
    return "cad";
  }
  if (
    PDF_EXTENSION_SET.has(normalizedExtension)
    || normalizedMimeType === "application/pdf"
  ) {
    return "pdf";
  }
  if (
    EXCEL_EXTENSION_SET.has(normalizedExtension)
    || normalizedMimeType.includes("spreadsheet")
    || normalizedMimeType.includes("excel")
    || normalizedMimeType === "text/csv"
  ) {
    return "excel";
  }
  if (THREE_D_EXTENSION_SET.has(normalizedExtension)) {
    return "three_d";
  }
  return "other";
};

export const getFolderPath = (webkitRelativePath = "") => {
  const normalizedPath = normalizeRelativePath(webkitRelativePath);
  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return segments[0] || "";
  }
  return segments.slice(0, -1).join("/");
};

export const getRootFolder = (files = []) => {
  const firstFile = Array.from(files || []).find(
    (file) => normalizeRelativePath(file?.webkitRelativePath || file?.name),
  );
  if (!firstFile) return "";
  const relativePath = normalizeRelativePath(
    firstFile.webkitRelativePath || firstFile.name,
  );
  return relativePath.split("/").filter(Boolean)[0] || "";
};

export const getDirectSubfolder = (rootFolder = "", relativePath = "") => {
  const normalizedRoot = normalizeText(rootFolder);
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  if (!normalizedRelativePath) return "";

  const pathSegments = normalizedRelativePath.split("/").filter(Boolean);
  if (!pathSegments.length) return "";

  const startIndex =
    normalizedRoot
    && normalizeText(pathSegments[0]).toLowerCase() === normalizedRoot.toLowerCase()
      ? 1
      : 0;

  return pathSegments[startIndex] || "";
};

export const buildFileManifest = (files = []) =>
  Array.from(files || [])
    .map((file) => {
      const relativePath = normalizeRelativePath(
        file?.webkitRelativePath || file?.name,
      );
      const extension = getExtension(file?.name);
      return {
        name: normalizeText(file?.name),
        relative_path: relativePath,
        folder_path: getFolderPath(relativePath),
        extension,
        mime_type: normalizeText(file?.type).toLowerCase(),
        size_bytes: Number(file?.size || 0),
        file_type: classifyFileType(extension, file?.type),
      };
    })
    .filter((entry) => entry.name && entry.relative_path);

export const summarizeManifest = (manifest = [], rootFolder = "") => {
  const summary = {
    total_files: 0,
    image_files: 0,
    pdf_files: 0,
    excel_files: 0,
    cad_files: 0,
    three_d_files: 0,
    other_files: 0,
    direct_subfolders_count: 0,
  };

  const directSubfolders = new Set();

  (Array.isArray(manifest) ? manifest : []).forEach((entry) => {
    summary.total_files += 1;
    const fileType = normalizeText(entry?.file_type).toLowerCase();
    const countKey = `${fileType}_files`;
    if (Object.prototype.hasOwnProperty.call(summary, countKey)) {
      summary[countKey] += 1;
    } else {
      summary.other_files += 1;
    }

    const directSubfolder = getDirectSubfolder(
      rootFolder,
      entry?.folder_path || entry?.relative_path,
    );
    if (directSubfolder) {
      directSubfolders.add(directSubfolder);
    }
  });

  summary.direct_subfolders_count = directSubfolders.size;
  return summary;
};

const applyTaskTypeRule = (manifest = [], taskType = null) => {
  const rule = taskType?.file_match_rule || {};
  const extensionSet = toLowerSet(rule.extensions);
  const mimeTypeSet = toLowerSet(rule.mime_types);

  return (Array.isArray(manifest) ? manifest : []).filter((entry) => {
    const extensionMatches =
      extensionSet.size === 0
      || extensionSet.has(normalizeText(entry?.extension).replace(/^\./, "").toLowerCase());
    const mimeMatches =
      mimeTypeSet.size === 0
      || mimeTypeSet.has(normalizeText(entry?.mime_type).toLowerCase());
    const nameMatches = matchesPatternList(entry?.name, rule.name_patterns);
    const folderMatches = matchesPatternList(entry?.folder_path, rule.folder_patterns);
    return extensionMatches && mimeMatches && nameMatches && folderMatches;
  });
};

export const previewPictureCleaningTasks = (manifest = [], taskType = null) =>
  applyTaskTypeRule(manifest, taskType)
    .filter((entry) =>
      IMAGE_EXTENSION_SET.has(normalizeText(entry?.extension).toLowerCase()),
    )
    .map((entry, index) => ({
      id: `picture-cleaning-${index + 1}`,
      title: `Picture Cleaning - ${entry.name}`,
      source_folder_path: entry.folder_path,
      source_files: [entry],
      source_file_count: 1,
    }));

export const previewThreeDTasks = (
  manifest = [],
  rootFolder = "",
  taskType = null,
) => {
  const grouped = new Map();

  applyTaskTypeRule(manifest, taskType).forEach((entry) => {
    const directSubfolder = getDirectSubfolder(rootFolder, entry?.folder_path);
    if (!directSubfolder) return;
    if (!grouped.has(directSubfolder)) {
      grouped.set(directSubfolder, []);
    }
    grouped.get(directSubfolder).push(entry);
  });

  return [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], undefined, { sensitivity: "base" }))
    .map(([folderName, entries], index) => ({
      id: `three-d-${index + 1}`,
      title: `3D Creation - ${folderName}`,
      source_folder_path: entries[0]?.folder_path || `${normalizeText(rootFolder)}/${folderName}`,
      source_files: entries,
      source_file_count: entries.length,
      folder_name: folderName,
      sample_files: entries.slice(0, 5).map((entry) => entry.name),
    }));
};

export const previewOncePerBatchTask = (
  manifest = [],
  taskType = null,
  batchName = "",
  sourceFolderName = "",
) => {
  const filteredEntries = applyTaskTypeRule(manifest, taskType);
  if (!filteredEntries.length) return [];

  const label =
    normalizeText(taskType?.name)
    || normalizeText(taskType?.label)
    || "Workflow Task";
  const suffix = normalizeText(batchName) || normalizeText(sourceFolderName) || "Batch";

  return [
    {
      id: "once-per-batch-1",
      title: `${label} - ${suffix}`,
      source_folder_path: normalizeText(sourceFolderName),
      source_files: filteredEntries,
      source_file_count: filteredEntries.length,
    },
  ];
};

export const buildTaskPreview = ({
  manifest = [],
  rootFolder = "",
  taskType = null,
  batchName = "",
  sourceFolderName = "",
} = {}) => {
  const autoCreateMode = normalizeText(taskType?.auto_create_mode).toLowerCase();

  if (!Array.isArray(manifest) || manifest.length === 0 || !taskType) {
    return [];
  }

  if (
    normalizeText(taskType?.key) === "picture_cleaning"
    || autoCreateMode === "per_file"
  ) {
    return previewPictureCleaningTasks(manifest, taskType);
  }

  if (
    normalizeText(taskType?.key) === "three_d_creation"
    || autoCreateMode === "per_direct_subfolder"
  ) {
    return previewThreeDTasks(manifest, rootFolder, taskType);
  }

  return previewOncePerBatchTask(
    manifest,
    taskType,
    batchName,
    sourceFolderName || rootFolder,
  );
};

export const formatBytes = (bytes = 0) => {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};
