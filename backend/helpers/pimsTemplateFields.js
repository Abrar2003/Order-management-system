const PIMS_FIELDS = [
  { key: "article_name", label: "Article Name", input_type: "text", value_type: "string" },
  { key: "season", label: "Season", input_type: "text", value_type: "string" },
  { key: "finish", label: "Finish", input_type: "text", value_type: "string" },
  { key: "maintenance_text", label: "Maintenance Text", input_type: "textarea", value_type: "string" },
  {
    key: "height_to_underside", label: "Height to Underside of Tabletop",
    input_type: "number", value_type: "number", unit: "cm",
    validation: { min: 0, visible_when: { sub_product_type: ["Dining Table"] } },
  },
].map((field, index) => ({ ...field, order: index + 1, required: false, is_active: true }));

const addPimsTemplateFields = (template) => {
  if (template.key !== "table") return template;
  template.groups ||= [];
  const keys = new Set((template.groups || []).flatMap((group) => group.fields || []).map((field) => field.key));
  const missing = PIMS_FIELDS.filter((field) => !keys.has(field.key));
  if (!missing.length) return template;
  const group = template.groups.find((entry) => entry.key === "pims");
  if (group) group.fields.push(...missing);
  else template.groups.push({ key: "pims", label: "PIMS", order: 100, is_active: true, fields: missing });
  return template;
};

module.exports = { PIMS_FIELDS, addPimsTemplateFields };
