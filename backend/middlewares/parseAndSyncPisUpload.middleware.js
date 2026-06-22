const mongoose = require("mongoose");
const Item = require("../models/item.model");
const { appendItemUpdateHistory } = require("../helpers/itemUpdateHistory");
const {
  PisImportError,
  parsePisUpload,
} = require("../helpers/pisExcelParser");
const { applyDataAccessMatch } = require("../services/userDataAccess.service");

const ITEM_DATA_ACCESS_FIELDS = {
  brandFields: ["brand", "brand_name", "brands"],
  vendorFields: ["vendors"],
};

const toPlainValue = (value) => {
  if (typeof value?.toObject === "function") {
    return value.toObject({ depopulate: true });
  }
  if (Array.isArray(value)) return value.map(toPlainValue);
  if (value && typeof value === "object") {
    return Object.keys(value).reduce((result, key) => {
      if (key !== "_id") result[key] = toPlainValue(value[key]);
      return result;
    }, {});
  }
  return value;
};

const valuesEqual = (left, right) =>
  JSON.stringify(toPlainValue(left)) === JSON.stringify(toPlainValue(right));

const setWhenChanged = (item, field, value, updatedFields) => {
  if (valuesEqual(item[field], value)) return;
  item[field] = value;
  updatedFields.push(field);
};

const buildImportResult = (parsed, updatedFields) => ({
  item_code: parsed.articleNumber,
  sheet_name: parsed.sheetName,
  updated_fields: updatedFields,
  parsed: {
    master_barcode: parsed.masterBarcode,
    pcs_barcode: parsed.pcsBarcode,
    item_sizes_count: parsed.itemSizes.length,
    box_sizes_count: parsed.boxSizes.length,
    box_mode: parsed.boxMode,
  },
});

const createParseAndSyncPisUpload = ({
  ItemModel = Item,
  parseUpload = parsePisUpload,
  appendHistory = appendItemUpdateHistory,
} = {}) => async (req, res, next) => {
  try {
    if (!req.file) {
      throw new PisImportError(400, "PIS Excel file is required");
    }

    const parsed = await parseUpload(req.file);
    const requestedItemId = String(req.params?.itemId || req.params?.id || "").trim();
    let item;

    if (requestedItemId) {
      if (!mongoose.Types.ObjectId.isValid(requestedItemId)) {
        throw new PisImportError(400, "Invalid item id");
      }
      item = await ItemModel.findOne(
        applyDataAccessMatch(
          { _id: requestedItemId },
          req.user,
          ITEM_DATA_ACCESS_FIELDS,
        ),
      );
      if (!item) throw new PisImportError(404, "Item not found");

      const itemCode = String(item.code ?? "").trim();
      if (itemCode !== parsed.articleNumber) {
        throw new PisImportError(
          409,
          `PIS article number ${parsed.articleNumber} does not match item ${itemCode}`,
        );
      }
    } else {
      item = await ItemModel.findOne(
        applyDataAccessMatch(
          { code: parsed.articleNumber },
          req.user,
          ITEM_DATA_ACCESS_FIELDS,
        ),
      );
      if (!item) throw new PisImportError(404, "No item matches the PIS article number");
    }

    const beforeSnapshot =
      typeof item.toObject === "function" ? item.toObject() : toPlainValue(item);
    const updatedFields = [];

    if (parsed.masterBarcode) {
      setWhenChanged(item, "pis_master_barcode", parsed.masterBarcode, updatedFields);
      setWhenChanged(item, "pis_barcode", parsed.masterBarcode, updatedFields);
    }
    if (parsed.pcsBarcode) {
      setWhenChanged(item, "pis_inner_barcode", parsed.pcsBarcode, updatedFields);
    }
    if (parsed.itemSizes.length > 0) {
      setWhenChanged(item, "pis_item_sizes", parsed.itemSizes, updatedFields);
    }
    if (parsed.boxSizes.length > 0) {
      setWhenChanged(item, "pis_box_sizes", parsed.boxSizes, updatedFields);
      setWhenChanged(item, "pis_box_mode", parsed.boxMode, updatedFields);
    }

    if (updatedFields.length > 0) {
      appendHistory(item, {
        before: beforeSnapshot,
        after: typeof item.toObject === "function" ? item.toObject() : toPlainValue(item),
        reqUser: req.user,
        action: "pis_file_import",
        source: "pis_upload",
        route: req.originalUrl || req.url || "",
        metadata: {
          item_code: parsed.articleNumber,
          sheet_name: parsed.sheetName,
          changed_fields: updatedFields,
        },
      });
    }

    await item.save();
    req.pisImportResult = buildImportResult(parsed, updatedFields);
    req.pisImportedItemId = item._id;
    next();
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    if (statusCode >= 500) {
      console.error("PIS Excel import failed:", {
        itemId: req.params?.itemId || req.params?.id || "",
        message: error?.message || String(error),
      });
    }
    return res.status(statusCode).json({
      success: false,
      message:
        statusCode >= 500
          ? "Failed to parse and synchronize the PIS workbook"
          : error.message,
    });
  }
};

const parseAndSyncPisUpload = createParseAndSyncPisUpload();

module.exports = {
  buildImportResult,
  createParseAndSyncPisUpload,
  parseAndSyncPisUpload,
};
