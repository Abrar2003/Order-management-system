const PPT_MIME_TYPES = [
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12",
];

const PDF_IMAGE_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
const PDF_IMAGE_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];
const PDF_IMAGE_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"];

export const ITEM_FILE_OPTIONS = Object.freeze([
  {
    value: "product_image",
    label: "Product Image",
    buttonLabel: "Item image",
    field: "image",
    previewMode: "image",
    accept: ".jpg,.jpeg,.png,image/jpeg,image/png",
    extensions: [".jpg", ".jpeg", ".png"],
    mimeTypes: ["image/jpeg", "image/png"],
    invalidMessage:
      "Only JPG, JPEG, or PNG files are allowed for product images.",
  },
  {
    value: "cad_file",
    label: "CAD File",
    buttonLabel: "CAD file",
    field: "cad_file",
    previewMode: "pdf",
    accept: ".pdf,application/pdf",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    invalidMessage: "Only PDF files are allowed for CAD files.",
  },
  {
    value: "pis_file",
    label: "PIS",
    buttonLabel: "PIS",
    field: "pis_file",
    previewMode: "pdf",
    accept: [
      ".xlsx",
      ".xls",
      ".csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
      "application/csv",
      "text/plain",
    ].join(","),
    extensions: [".xlsx", ".xls", ".csv"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/excel",
      "application/x-excel",
      "application/x-msexcel",
      "application/xls",
      "application/x-xls",
      "text/csv",
      "application/csv",
      "text/plain",
    ],
    invalidMessage: "Only XLSX, XLS, or CSV files are allowed for PIS uploads.",
  },
  {
    value: "assembly_file",
    label: "Assembly Instructions",
    buttonLabel: "Assembly",
    field: "assembly_file",
    previewMode: "pdf",
    accept: ".pdf,application/pdf",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    invalidMessage: "Only PDF files are allowed for Assembly.",
  },
  {
    value: "mounting_file",
    label: "Mounting File",
    buttonLabel: "Mounting file",
    field: "mounting_file",
    previewMode: "pdf",
    accept: ".pdf,application/pdf",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    invalidMessage: "Only PDF files are allowed for Mounting files.",
    requiresMountingFileNeeded: true,
  },
  {
    value: "packeging_ppt",
    label: "Packaging PPT",
    buttonLabel: "Packaging PPT",
    field: "packeging_ppt",
    previewMode: "office",
    accept: [
      ".ppt",
      ".pptx",
      ".pptm",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-powerpoint.presentation.macroenabled.12",
    ].join(","),
    extensions: [".ppt", ".pptx", ".pptm"],
    mimeTypes: PPT_MIME_TYPES,
    invalidMessage: "Only PPT, PPTX, or PPTM files are allowed for Packaging PPT.",
  },
  {
    value: "shipping_marks",
    label: "Shipping Marks",
    buttonLabel: "Shipping Marks",
    field: "shipping_marks",
    isGroup: true,
    previewMode: "pdf",
    accept: PDF_IMAGE_ACCEPT,
    extensions: PDF_IMAGE_EXTENSIONS,
    mimeTypes: PDF_IMAGE_MIME_TYPES,
    invalidMessage: "Only PDF, JPG, JPEG, or PNG files are allowed for Shipping Marks.",
  },
]);

export const SHIPPING_MARKS_SUB_OPTIONS = Object.freeze([
  {
    value: "shipping_marks",
    label: "Shipping Mark",
    buttonLabel: "Shipping Mark",
    field: "shipping_marks.files",
    legacyFields: [
      "shipping_marks.shipping_marks_1",
      "shipping_marks.shipping_marks_2",
    ],
    supportsMultiple: true,
    previewMode: "pdf",
    accept: PDF_IMAGE_ACCEPT,
    extensions: PDF_IMAGE_EXTENSIONS,
    mimeTypes: PDF_IMAGE_MIME_TYPES,
    invalidMessage: "Only PDF, JPG, JPEG, or PNG files are allowed for Shipping marks.",
  },
  {
    value: "ean",
    label: "EAN",
    buttonLabel: "EAN",
    field: "shipping_marks.ean",
    previewMode: "pdf",
    accept: PDF_IMAGE_ACCEPT,
    extensions: PDF_IMAGE_EXTENSIONS,
    mimeTypes: PDF_IMAGE_MIME_TYPES,
    invalidMessage: "Only PDF, JPG, JPEG, or PNG files are allowed for EAN.",
  },
  {
    value: "flat_carton",
    label: "Flat Carton",
    buttonLabel: "Flat Carton",
    field: "shipping_marks.flat_carton",
    legacyFields: [
      "shipping_marks.flat_carton_1",
      "shipping_marks.flat_carton_2",
    ],
    supportsMultiple: true,
    previewMode: "pdf",
    accept: PDF_IMAGE_ACCEPT,
    extensions: PDF_IMAGE_EXTENSIONS,
    mimeTypes: PDF_IMAGE_MIME_TYPES,
    invalidMessage: "Only PDF, JPG, JPEG, or PNG files are allowed for Flat carton.",
  },
  {
    value: "three_d_carton",
    label: "3D Carton",
    buttonLabel: "3D Carton",
    field: "shipping_marks.three_d_carton",
    previewMode: "pdf",
    accept: PDF_IMAGE_ACCEPT,
    extensions: PDF_IMAGE_EXTENSIONS,
    mimeTypes: PDF_IMAGE_MIME_TYPES,
    invalidMessage: "Only PDF, JPG, JPEG, or PNG files are allowed for 3D carton.",
  },
]);

export const ITEM_FILE_UPLOAD_OPTIONS = Object.freeze([
  ...ITEM_FILE_OPTIONS.filter((option) => option.value !== "shipping_marks"),
  ...SHIPPING_MARKS_SUB_OPTIONS,
]);

export const ITEM_FILE_NAV_OPTIONS = ITEM_FILE_UPLOAD_OPTIONS;

export const ITEM_FILE_OPTIONS_BY_VALUE = Object.freeze(
  [...ITEM_FILE_OPTIONS, ...SHIPPING_MARKS_SUB_OPTIONS].reduce((accumulator, option) => {
    accumulator[option.value] = option;
    return accumulator;
  }, {}),
);

export const DEFAULT_ITEM_FILE_TYPE = ITEM_FILE_OPTIONS[0]?.value || "product_image";

export const getItemFileOption = (value) => {
  const normalizedValue = String(value || "").trim().toLowerCase();
  const option = ITEM_FILE_OPTIONS_BY_VALUE[normalizedValue] || null;
  if (option) return option;
  return SHIPPING_MARKS_SUB_OPTIONS.find(opt => opt.value.toLowerCase() === normalizedValue) || null;
};

export const isItemFileOptionAvailableForItem = (option, item = {}) => {
  const resolvedOption =
    typeof option === "string" ? getItemFileOption(option) : option;
  if (!resolvedOption) return false;
  if (!resolvedOption.requiresMountingFileNeeded) return true;
  return item?.mounting_file_needed === true;
};

export const hasStoredItemFile = (file = {}) =>
  Array.isArray(file)
    ? file.some((entry) => hasStoredItemFile(entry))
    : Boolean(
        String(
          file?.key || file?.url || file?.link || file?.public_id || "",
        ).trim(),
      );

export const getStoredItemFileUrl = (file = {}) =>
  Array.isArray(file)
    ? getStoredItemFileUrl(file.find((entry) => hasStoredItemFile(entry)) || {})
    : String(file?.url || file?.link || "").trim();

export const getNestedItemFileValue = (item = {}, field = "") => {
  const normalizedField = String(field || "").trim();
  if (!item || !normalizedField) return null;
  return normalizedField.split(".").reduce(
    (current, segment) => (current && current[segment] !== undefined ? current[segment] : null),
    item,
  );
};

export const getItemFileValues = (item = {}, option = {}) => {
  const resolvedOption =
    typeof option === "string" ? getItemFileOption(option) : option;
  if (!resolvedOption) return [];

  return [
    resolvedOption.field,
    ...(Array.isArray(resolvedOption.legacyFields) ? resolvedOption.legacyFields : []),
  ].flatMap((field) => {
    const value = getNestedItemFileValue(item, field);
    return Array.isArray(value) ? value : [value];
  }).filter((file) => hasStoredItemFile(file));
};

export const getPrimaryStoredItemFile = (item = {}, option = {}) =>
  getItemFileValues(item, option)[0] || null;

export const buildItemFilesPagePath = (fileType = DEFAULT_ITEM_FILE_TYPE) => {
  const resolvedType = getItemFileOption(fileType)?.value || DEFAULT_ITEM_FILE_TYPE;
  return `/item-files?file_type=${encodeURIComponent(resolvedType)}`;
};

export const buildOfficePreviewUrl = (fileUrl = "") => {
  const normalizedUrl = String(fileUrl || "").trim();
  if (!normalizedUrl) return "";
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(normalizedUrl)}`;
};

export const isPisSpreadsheetUploadType = (value = "") =>
  String(value || "").trim().toLowerCase() === "pis_file";

export const buildItemFileUploadRequest = ({
  itemId = "",
  fileType = "",
  file = null,
  files = [],
} = {}) => {
  const normalizedItemId = String(itemId || "").trim();
  const normalizedFileType = String(fileType || "").trim().toLowerCase();
  const selectedFiles = Array.isArray(files) && files.length > 0 ? files : [file].filter(Boolean);
  const formData = new FormData();

  selectedFiles.forEach((selectedFile) => {
    formData.append(selectedFiles.length > 1 ? "files" : "file", selectedFile);
  });

  if (isPisSpreadsheetUploadType(normalizedFileType)) {
    return {
      path: `/items/${encodeURIComponent(normalizedItemId)}/pis-upload`,
      formData,
    };
  }

  formData.append("file_type", normalizedFileType);

  return {
    path: `/items/${encodeURIComponent(normalizedItemId)}/files`,
    formData,
  };
};

export const getFilePreviewSource = ({
  fileUrl = "",
  previewMode = "pdf",
} = {}) => {
  const normalizedUrl = String(fileUrl || "").trim();
  if (!normalizedUrl) return "";

  if (previewMode === "office") {
    return buildOfficePreviewUrl(normalizedUrl);
  }

  return normalizedUrl;
};

export const shouldOpenFilePreviewExternally = (previewMode = "pdf") => {
  const normalizedMode = String(previewMode || "").trim().toLowerCase();
  if (normalizedMode === "image") return false;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(hover: none)").matches ||
    window.matchMedia("(max-width: 1024px)").matches
  );
};
