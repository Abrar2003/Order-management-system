export const STAGE_LABELS = {
  awaiting_master_1: "Awaiting Master 1", master_1: "Master 1", master_2: "Master 2",
  final_master: "Final Master", finalized: "Final Master · Locked",
};
export const NEXT_STAGE_LABELS = { awaiting_master_1: "Master 1", master_1: "Master 2", master_2: "Final Master" };
export const BOX_MODES = { individual: "Individual boxes", carton: "Inner + Master", individual_master: "Individual + Master" };
export const MASTER_FIELDS = ["master_item_sizes", "master_box_sizes", "master_box_mode", "master_country_of_origin", "master_barcode", "master_master_barcode", "master_inner_barcode"];
const clone = (value) => JSON.parse(JSON.stringify(value));
export const masterForm = (item) => ({ ...Object.fromEntries(MASTER_FIELDS.map((field) => [field,
  clone(item[field] ?? (field.endsWith("sizes") ? [] : field.endsWith("mode") ? "individual" : "")),
])), master_box_mode: item.master_box_mode || "individual", master_master_barcode: item.master_master_barcode || item.master_barcode || "", master_barcode: item.master_master_barcode || item.master_barcode || "" });
export const blankSize = (group, type = "individual") => ({
  L: "", B: "", H: "", remark: group === "box" && type !== "individual" ? type : "",
  [group === "item" ? "net_weight" : "gross_weight"]: "",
  ...(group === "box" ? { box_type: type, item_count_in_inner: "", box_count_in_master: "" } : {}),
});
export const formFromInspection = (form, inspection) => ({
  ...form, master_item_sizes: clone(inspection.item_sizes), master_box_sizes: clone(inspection.box_sizes),
  master_box_mode: inspection.box_mode, master_master_barcode: inspection.master_barcode,
  master_barcode: inspection.master_barcode, master_inner_barcode: inspection.inner_barcode,
});
export const changeBoxMode = (form, mode) => {
  const entries = form.master_box_sizes;
  const find = (type, index) => entries.find((entry) => entry.box_type === type) || entries[index] || blankSize("box", type);
  const boxes = mode === "carton" ? ["inner", "master"].map((type, index) => ({ ...find(type, index), remark: type, box_type: type }))
    : mode === "individual_master" ? [{ ...find("master", 0), remark: "master", box_type: "master" }]
      : entries.map((entry) => ({ ...entry, box_type: "individual", item_count_in_inner: 0, box_count_in_master: 0 }));
  return { ...form, master_box_mode: mode, master_box_sizes: boxes };
};
