import { resolvePreferredCbm } from "./cbm.js";
import {
  BOX_SIZE_ENTRY_LIMIT,
  calculateMeasuredSizeEntriesCbm,
  resolvePreferredMeasuredSizeCbm,
} from "./measuredSizeForm.js";

const calculateMeasurementCbm = (
  source = {},
  { boxSizes, boxMode, itemSizes } = {},
) => {
  const boxes = Array.isArray(source?.[boxSizes]) ? source[boxSizes] : [];
  const items = Array.isArray(source?.[itemSizes]) ? source[itemSizes] : [];

  return resolvePreferredMeasuredSizeCbm(
    calculateMeasuredSizeEntriesCbm(boxes, boxes.length, {
      mode: source?.[boxMode],
      limit: BOX_SIZE_ENTRY_LIMIT,
    }),
    calculateMeasuredSizeEntriesCbm(items, items.length),
  );
};

export const resolveInspectionRecordCbm = (record = {}, qc = {}) => {
  const itemMaster = qc?.item_master || {};

  return resolvePreferredCbm(
    record?.cbm?.total,
    calculateMeasurementCbm(record, {
      boxSizes: "inspected_box_sizes",
      boxMode: "inspected_box_mode",
      itemSizes: "inspected_item_sizes",
    }),
    calculateMeasurementCbm(itemMaster, {
      boxSizes: "inspected_box_sizes",
      boxMode: "inspected_box_mode",
      itemSizes: "inspected_item_sizes",
    }),
    calculateMeasurementCbm(itemMaster, {
      boxSizes: "pis_box_sizes",
      boxMode: "pis_box_mode",
      itemSizes: "pis_item_sizes",
    }),
    itemMaster?.cbm?.calculated_inspected_total,
    itemMaster?.cbm?.inspected_total,
    itemMaster?.cbm?.calculated_pis_total,
    itemMaster?.cbm?.total,
    qc?.cbm?.total,
  );
};
