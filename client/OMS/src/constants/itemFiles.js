const PPT_MIME_TYPES = [
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12",
];

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
    label: "Assembly",
    buttonLabel: "Assembly",
    field: "assembly_file",
    previewMode: "pdf",
    accept: ".pdf,application/pdf",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    invalidMessage: "Only PDF files are allowed for Assembly.",
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
]);

export const ITEM_FILE_OPTIONS_BY_VALUE = Object.freeze(
  ITEM_FILE_OPTIONS.reduce((accumulator, option) => {
    accumulator[option.value] = option;
    return accumulator;
  }, {}),
);

export const DEFAULT_ITEM_FILE_TYPE = ITEM_FILE_OPTIONS[0]?.value || "product_image";

export const getItemFileOption = (value) => {
  const normalizedValue = String(value || "").trim().toLowerCase();
  return ITEM_FILE_OPTIONS_BY_VALUE[normalizedValue] || null;
};

export const hasStoredItemFile = (file = {}) =>
  Boolean(
    String(
      file?.key || file?.url || file?.link || file?.public_id || "",
    ).trim(),
  );

export const getStoredItemFileUrl = (file = {}) =>
  String(file?.url || file?.link || "").trim();

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
} = {}) => {
  const normalizedItemId = String(itemId || "").trim();
  const normalizedFileType = String(fileType || "").trim().toLowerCase();
  const formData = new FormData();

  formData.append("file", file);

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
