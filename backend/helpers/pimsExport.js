const XLSX = require("xlsx");

const PIMS_HEADERS = [
  "Article number", "Article name", "Season", "Color", "Material", "Finish",
  "Maintenance", "Length", "Width", "Height", "Thickness of tabletop",
  "Height up until bottom of tabletop", "Distance between legs", "KD",
  "Package size colli 1", "Package size colli 2", "Package size colli 3",
  "Weight colli 1", "Weight colli 2", "Weight colli 3",
];

const text = (value) => String(value ?? "").trim();
const joinValues = (values) => [...new Set(values.flatMap((value) =>
  text(value).split(",").map(text).filter((entry) => entry && !/^(n\/a|-)$/i.test(entry)),
))].join(", ");

const specValue = (field) => {
  if (!field) return "";
  if (field.value_type === "boolean") return field.value_boolean ?? "";
  if (field.value_type === "number") return field.value_number ?? "";
  if (field.value_type === "array") return (field.value_array || []).join(", ");
  return text(field.value_text || field.raw_value);
};

const dimensions = (entry) => entry && [entry.L, entry.B, entry.H].every(
  (value) => value !== undefined && value !== null && value !== "",
) ? [entry.L, entry.B, entry.H].join(" x ") : "";

const buildPimsRow = (row) => {
  const specs = row.product_specs || {};
  const fields = specs.fields || [];
  const value = (key) => specValue(fields.find((field) => field.key === key));
  const matchingValues = (pattern) => fields.filter((field) => pattern.test(field.key))
    .map(specValue).filter((entry) => typeof entry !== "boolean");
  const itemSizes = row.pd_item_sizes?.length ? row.pd_item_sizes : specs.item_sizes || [];
  const article = itemSizes.find((entry) => ["item", "article"].includes(entry.remark));
  const boxes = row.pd_box_sizes?.length ? row.pd_box_sizes : specs.box_sizes || [];
  const numberedBoxes = [1, 2, 3].map((number) => {
    const numbered = boxes.find((entry) => entry.remark === `box${number}`);
    // Preserve numbered slots even when an earlier colli has no data.
    return numbered || (boxes.some((entry) => /^box[123]$/.test(entry.remark))
      ? undefined : boxes[number - 1]);
  });
  const dining = text(value("sub_product_type") || row.sub_product_type).toLowerCase() === "dining table";
  const finish = value("finish") || joinValues([
    ...matchingValues(/^(treated|lacquer_type|.*_coating_type|.*_coating_other)$/)
      .filter((entry) => entry !== "Other"),
    ...fields.filter((field) => /(^|_)(wire_brush|sandblasting|sandblasted|sealer)$/.test(field.key)
      && specValue(field) === true).map((field) => field.label),
  ]);
  return [
    text(value("item_number") || row.code),
    value("article_name") || row.name || value("description") || row.description || "",
    value("season"),
    joinValues(matchingValues(/(^color(_\d+)?$|_color_name$)/)),
    joinValues(matchingValues(/(^material(_\d+|_top|_leg|_frame)?$|_(wood|stone|metal)_type$)/)),
    finish,
    value("maintenance_text"),
    article?.L ?? "", article?.B ?? "", article?.H ?? "",
    value("table_top_thickness"),
    dining ? value("height_to_underside") : "",
    dining ? value("distances_between_legs") || dimensions(
      (specs.item_sizes || []).find((entry) => entry.remark === "leg_distance"),
    ) : "",
    row.kd === true || value("assembly_needed") === true ? "Yes" : "No",
    ...numberedBoxes.map(dimensions),
    ...numberedBoxes.map((entry) => entry?.gross_weight ?? ""),
  ];
};

const buildPimsWorkbook = (rows) => {
  const data = rows.filter((row) => text(row.product_type?.key).toLowerCase() === "table")
    .map(buildPimsRow);
  const sheet = XLSX.utils.aoa_to_sheet([PIMS_HEADERS, ...data]);
  sheet["!cols"] = PIMS_HEADERS.map((header) => ({ wch: Math.max(18, header.length + 2) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "PIMS");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
};

module.exports = { PIMS_HEADERS, buildPimsRow, buildPimsWorkbook };
