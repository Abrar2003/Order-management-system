/*
 * QC import replay script
 *
 * Usage:
 *   node backend/script.js
 *   node backend/script.js "backend/data/qc_reports.xlsx"
 *
 * What this does:
 * 1) Reads Excel rows.
 * 2) Finds matching Order records by PO + Item (+ Vendor preference).
 * 3) Aligns/realigns QC using controller rules (alignQC).
 * 4) Replays each row as a visit update using controller rules (updateQC).
 * 5) De-duplicates visits against existing Inspection records and duplicates in file.
 */

const dns = require("dns");
const path = require("path");
const mongoose = require("mongoose");
const XLSX = require("xlsx");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const QC = require("../models/qc.model");
const Order = require("../models/order.model");
const Inspection = require("../models/inspection.model");
const User = require("../models/user.model");
const qcController = require("../controllers/qc.controller");

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const ADMIN_CREATED_BY = "699044abd0005a59180304db";
const FALLBACK_QC_USER = "699067156dc68aedb5899de4";

const STATIC_QC_NAME_TO_USER_ID = new Map([
  ["Ashwini Khandelwal", "6993feed473290fa1cf76b50"],
  ["Dev Sharma", "6993fec9473290fa1cf76b49"],
  ["Dashrath Suthar", "6993ff07473290fa1cf76b57"],
  ["Harbhajan Suthar", "6993ff2d473290fa1cf76b5e"],
  ["Old QC", "6993ff98473290fa1cf76b6c"],
  ["Aman Dutt", "6993ff47473290fa1cf76b65"],
]);

const HEADER_ALIASES = {
  date: ["Date"],
  vendor: ["Vendor", "Vendor "],
  po_number: ["PO Number", "PO"],
  item_code: ["Item Code", "Item code"],
  item_name: ["Item name", "Item Name", "Description"],
  brand_name: ["Brand Name", "Brand"],
  qty_requested: ["Qty Requested"],
  qty_offered: ["Qty Offered"],
  qty_inspected: ["Qty Inspected"],
  qty_passed: ["Qty Passed"],
  qc_name: ["QC Name"],
  cbm: ["CBM", "CBM "],
  remarks: ["Remarks"],
};

const toStr = (value) =>
  value === null || value === undefined ? "" : String(value).trim();

const normalizeSpaces = (value) => toStr(value).replace(/\s+/g, " ").trim();

const normalizeKeyToken = (value) => normalizeSpaces(value).toLowerCase();

const toNum = (value, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const pickCell = (row, aliases = []) => {
  for (const alias of aliases) {
    if (hasOwn(row, alias)) return row[alias];
    const exactTrimmed = Object.keys(row).find((k) => k.trim() === alias.trim());
    if (exactTrimmed) return row[exactTrimmed];
  }
  return undefined;
};

const normalizeCode = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) return String(value);
    return String(value);
  }
  const asString = normalizeSpaces(value);
  if (!asString) return "";
  if (/^\d+\.0+$/.test(asString)) return asString.replace(/\.0+$/, "");
  return asString;
};

const excelSerialToDate = (serial) => {
  const epoch = new Date(Date.UTC(1899, 11, 30));
  return new Date(epoch.getTime() + Number(serial) * 86400000);
};

const toYmd = (dateValue) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const parseExcelDateToYmd = (value) => {
  if (value === null || value === undefined || value === "") return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toYmd(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return toYmd(excelSerialToDate(value));
  }

  const raw = normalizeSpaces(value);
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const ddmmyyyy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (ddmmyyyy) {
    const dd = Number(ddmmyyyy[1]);
    const mm = Number(ddmmyyyy[2]) - 1;
    const yyyy = Number(ddmmyyyy[3]);
    return toYmd(new Date(Date.UTC(yyyy, mm, dd)));
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return toYmd(parsed);
  return "";
};

const makeRowKey = (row) =>
  `${row.poNumber}||${normalizeSpaces(row.vendor)}||${row.itemCode}`;

const makeInspectionSignature = ({
  qcId,
  inspectionDate,
  inspectorId,
  vendorOffered,
  checked,
  passed,
}) =>
  [
    String(qcId),
    String(inspectionDate || ""),
    String(inspectorId || ""),
    Number(vendorOffered || 0),
    Number(checked || 0),
    Number(passed || 0),
  ].join("|");

const createMockRes = () => {
  let statusCode = 200;
  let payload;
  return {
    get statusCode() {
      return statusCode;
    },
    get payload() {
      return payload;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };
};

const runController = async (handler, req) => {
  const res = createMockRes();
  await handler(req, res);
  return { statusCode: res.statusCode, body: res.payload };
};

const clampNonNegative = (value) => {
  const n = toNum(value, 0);
  return n < 0 ? 0 : n;
};

const deriveOrderStatusFromQc = (clientDemand, passedQty) => {
  const demand = toNum(clientDemand, 0);
  const passed = toNum(passedQty, 0);
  return demand > 0 && passed >= demand ? "Inspection Done" : "Under Inspection";
};

const normalizeParsedRow = (rawRow, index) => {
  const parsed = {
    rowIndex: index + 2,
    date: parseExcelDateToYmd(pickCell(rawRow, HEADER_ALIASES.date)),
    vendor: normalizeSpaces(pickCell(rawRow, HEADER_ALIASES.vendor)),
    poNumber: normalizeCode(pickCell(rawRow, HEADER_ALIASES.po_number)),
    itemCode: normalizeCode(pickCell(rawRow, HEADER_ALIASES.item_code)),
    itemName: normalizeSpaces(pickCell(rawRow, HEADER_ALIASES.item_name)),
    brandName: normalizeSpaces(pickCell(rawRow, HEADER_ALIASES.brand_name)),
    qtyRequested: clampNonNegative(pickCell(rawRow, HEADER_ALIASES.qty_requested)),
    qtyOffered: clampNonNegative(pickCell(rawRow, HEADER_ALIASES.qty_offered)),
    qtyInspected: clampNonNegative(pickCell(rawRow, HEADER_ALIASES.qty_inspected)),
    qtyPassed: clampNonNegative(pickCell(rawRow, HEADER_ALIASES.qty_passed)),
    qcName: normalizeSpaces(pickCell(rawRow, HEADER_ALIASES.qc_name)),
    cbmRaw: pickCell(rawRow, HEADER_ALIASES.cbm),
    remarks: normalizeSpaces(pickCell(rawRow, HEADER_ALIASES.remarks)),
  };

  parsed.rowKey = makeRowKey(parsed);
  return parsed;
};

const normalizeNameKey = (name) => normalizeSpaces(name).toLowerCase();

const resolveOrderForGroup = async (sample) => {
  const orderId = sample.poNumber;
  const itemCode = sample.itemCode;
  const vendorKey = normalizeKeyToken(sample.vendor);

  let candidates = await Order.find({
    order_id: orderId,
    "item.item_code": itemCode,
  }).lean();

  if (!candidates.length) {
    const byOrder = await Order.find({ order_id: orderId }).lean();
    candidates = byOrder.filter(
      (o) => normalizeCode(o?.item?.item_code) === normalizeCode(itemCode),
    );
  }

  if (!candidates.length) {
    return { order: null, reason: "order_not_found" };
  }

  const vendorMatched = candidates.filter(
    (o) => normalizeKeyToken(o.vendor) === vendorKey,
  );

  if (vendorMatched.length === 1) {
    return { order: vendorMatched[0], reason: null };
  }

  if (vendorMatched.length > 1) {
    return { order: vendorMatched[0], reason: "multiple_vendor_matches" };
  }

  if (candidates.length === 1) {
    return { order: candidates[0], reason: "vendor_mismatch_fallback" };
  }

  return { order: candidates[0], reason: "ambiguous_order_match" };
};

const buildInspectorResolver = async () => {
  const qcUsers = await User.find({
    $or: [{ role: "QC" }, { isQC: true }],
  })
    .select("_id name role isQC")
    .lean();

  const dynamicNameMap = new Map();
  for (const user of qcUsers) {
    const key = normalizeNameKey(user.name);
    if (key && !dynamicNameMap.has(key)) {
      dynamicNameMap.set(key, String(user._id));
    }
  }

  const staticNameMap = new Map();
  for (const [name, id] of STATIC_QC_NAME_TO_USER_ID.entries()) {
    if (mongoose.Types.ObjectId.isValid(id)) {
      staticNameMap.set(normalizeNameKey(name), id);
    }
  }

  const fallbackByEnv = mongoose.Types.ObjectId.isValid(FALLBACK_QC_USER)
    ? FALLBACK_QC_USER
    : null;
  const fallbackByUsers = qcUsers[0]?._id ? String(qcUsers[0]._id) : null;
  const fallback = fallbackByEnv || fallbackByUsers || ADMIN_CREATED_BY;

  return (name) => {
    const key = normalizeNameKey(name);
    if (key && staticNameMap.has(key)) return staticNameMap.get(key);
    if (key && dynamicNameMap.has(key)) return dynamicNameMap.get(key);
    return fallback;
  };
};

const loadWorkbookRows = (filePath) => {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  return rawRows.map((row, index) => normalizeParsedRow(row, index));
};

const groupRows = (parsedRows) => {
  const groups = new Map();
  for (const row of parsedRows) {
    if (!row.poNumber || !row.itemCode || !row.vendor) continue;
    if (!row.date) continue;
    if (!groups.has(row.rowKey)) groups.set(row.rowKey, []);
    groups.get(row.rowKey).push(row);
  }
  for (const rows of groups.values()) {
    rows.sort((a, b) => {
      if (a.date === b.date) return a.rowIndex - b.rowIndex;
      return a.date.localeCompare(b.date);
    });
  }
  return groups;
};

const todayYmd = () => toYmd(new Date());

async function main() {
  const inputPath =
    process.argv[2] || path.join(__dirname, "data", "qc_reports.xlsx");
  const excelPath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);

  if (!process.env.MONGO_URI) {
    throw new Error("Missing MONGO_URI in backend/.env");
  }

  const adminUser = {
    _id: new mongoose.Types.ObjectId(ADMIN_CREATED_BY),
    role: "admin",
  };

  console.log("Reading workbook:", excelPath);
  const parsedRows = loadWorkbookRows(excelPath);
  console.log("Rows loaded:", parsedRows.length);

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const resolveInspectorId = await buildInspectorResolver();
  const groups = groupRows(parsedRows);
  console.log("Distinct PO+Vendor+Item groups:", groups.size);

  const summary = {
    groupsTotal: groups.size,
    groupsMatched: 0,
    groupsUnmatched: 0,
    groupsWithWarnings: 0,
    qcAligned: 0,
    qcAlignFailed: 0,
    rowVisitApplied: 0,
    rowVisitSkippedAsDuplicate: 0,
    rowVisitFailed: 0,
    rowMetadataOnlyApplied: 0,
    rowMetadataOnlyFailed: 0,
    unmatchedSamples: [],
    alignErrors: [],
    visitErrors: [],
  };

  const groupContexts = [];

  for (const [groupKey, rows] of groups.entries()) {
    const sample = rows[0];
    const orderResolution = await resolveOrderForGroup(sample);

    if (!orderResolution.order) {
      summary.groupsUnmatched += 1;
      if (summary.unmatchedSamples.length < 20) {
        summary.unmatchedSamples.push({
          groupKey,
          reason: orderResolution.reason,
          po: sample.poNumber,
          vendor: sample.vendor,
          itemCode: sample.itemCode,
        });
      }
      continue;
    }

    summary.groupsMatched += 1;
    if (orderResolution.reason) summary.groupsWithWarnings += 1;

    const order = orderResolution.order;
    const firstRow = rows[0];
    const itemCodeForQc = normalizeCode(order?.item?.item_code || firstRow.itemCode);
    const existingQc = await QC.findOne({
      order: order._id,
      "item.item_code": itemCodeForQc,
    })
      .select("quantities.pending quantities.client_demand quantities.qc_passed")
      .lean();

    const maxRequested = rows.reduce(
      (max, r) => Math.max(max, clampNonNegative(r.qtyRequested)),
      0,
    );
    const clientDemand = clampNonNegative(order.quantity);
    const existingPendingRaw = existingQc
      ? Number(
          existingQc?.quantities?.pending ??
            ((existingQc?.quantities?.client_demand || 0) -
              (existingQc?.quantities?.qc_passed || 0)),
        )
      : null;
    const existingPending = Number.isFinite(existingPendingRaw)
      ? Math.max(0, existingPendingRaw)
      : null;
    const requestedCap = existingQc ? existingPending : clientDemand;
    const alignedRequestedRaw = maxRequested > 0 ? maxRequested : requestedCap;
    const alignedRequested = Math.min(alignedRequestedRaw, requestedCap);
    const alignDate = firstRow.date || todayYmd();

    const alignPayload = {
      order: String(order._id),
      item: {
        item_code: itemCodeForQc,
        description:
          normalizeSpaces(order?.item?.description) ||
          firstRow.itemName ||
          "N/A",
      },
      inspector: resolveInspectorId(firstRow.qcName),
      request_date: alignDate,
      quantities: {
        client_demand: clientDemand,
        quantity_requested: alignedRequested,
      },
      remarks: firstRow.remarks || undefined,
    };

    const alignResp = await runController(qcController.alignQC, {
      body: alignPayload,
      params: {},
      query: {},
      user: adminUser,
    });

    if (alignResp.statusCode >= 400) {
      summary.qcAlignFailed += 1;
      if (summary.alignErrors.length < 30) {
        summary.alignErrors.push({
          groupKey,
          status: alignResp.statusCode,
          message: alignResp.body?.message || "alignQC failed",
          po: sample.poNumber,
          itemCode: sample.itemCode,
        });
      }
      continue;
    }

    summary.qcAligned += 1;

    const qcDoc = await QC.findOne({
      order: order._id,
      "item.item_code": alignPayload.item.item_code,
    })
      .select("_id inspector")
      .lean();

    if (!qcDoc?._id) {
      summary.qcAlignFailed += 1;
      if (summary.alignErrors.length < 30) {
        summary.alignErrors.push({
          groupKey,
          status: 500,
          message: "QC record not found after alignQC",
          po: sample.poNumber,
          itemCode: sample.itemCode,
        });
      }
      continue;
    }

    groupContexts.push({
      groupKey,
      order,
      qcId: String(qcDoc._id),
      rows,
    });
  }

  const qcIds = [...new Set(groupContexts.map((g) => g.qcId))];
  const existingInspections = await Inspection.find(
    { qc: { $in: qcIds } },
    {
      qc: 1,
      inspection_date: 1,
      inspector: 1,
      vendor_offered: 1,
      checked: 1,
      passed: 1,
    },
  ).lean();

  const existingSignatures = new Set(
    existingInspections.map((inspection) =>
      makeInspectionSignature({
        qcId: inspection.qc,
        inspectionDate: inspection.inspection_date,
        inspectorId: inspection.inspector,
        vendorOffered: inspection.vendor_offered,
        checked: inspection.checked,
        passed: inspection.passed,
      }),
    ),
  );
  const workbookSignatures = new Set();

  for (const ctx of groupContexts) {
    for (const row of ctx.rows) {
      const inspectorId = resolveInspectorId(row.qcName);
      const offered = clampNonNegative(row.qtyOffered);
      const checked = clampNonNegative(row.qtyInspected);
      const passed = clampNonNegative(row.qtyPassed);
      const hasVisitUpdate = offered > 0 || checked > 0 || passed > 0;

      const signature = hasVisitUpdate
        ? makeInspectionSignature({
            qcId: ctx.qcId,
            inspectionDate: row.date,
            inspectorId,
            vendorOffered: offered,
            checked,
            passed,
          })
        : null;

      if (signature && (existingSignatures.has(signature) || workbookSignatures.has(signature))) {
        summary.rowVisitSkippedAsDuplicate += 1;
        continue;
      }

      const payload = {
        inspector: inspectorId,
        last_inspected_date: row.date,
      };

      if (offered > 0) payload.vendor_provision = offered;
      if (checked > 0) payload.qc_checked = checked;
      if (passed > 0) payload.qc_passed = passed;
      if (row.remarks) payload.remarks = row.remarks;

      const parsedCbm = toNum(row.cbmRaw, Number.NaN);
      if (Number.isFinite(parsedCbm) && parsedCbm >= 0) {
        payload.CBM = String(parsedCbm);
      }

      const updateResp = await runController(qcController.updateQC, {
        body: payload,
        params: { id: ctx.qcId },
        query: {},
        user: adminUser,
      });

      if (updateResp.statusCode >= 400) {
        if (hasVisitUpdate) summary.rowVisitFailed += 1;
        else summary.rowMetadataOnlyFailed += 1;

        if (summary.visitErrors.length < 50) {
          summary.visitErrors.push({
            groupKey: ctx.groupKey,
            rowIndex: row.rowIndex,
            status: updateResp.statusCode,
            message: updateResp.body?.message || "updateQC failed",
            date: row.date,
            offered,
            checked,
            passed,
          });
        }
        continue;
      }

      if (hasVisitUpdate) {
        summary.rowVisitApplied += 1;
        if (signature) {
          existingSignatures.add(signature);
          workbookSignatures.add(signature);
        }
      } else {
        summary.rowMetadataOnlyApplied += 1;
      }
    }
  }

  // Final reconciliation pass:
  // keep order status in sync with QC totals using the same logic as controllers.
  if (qcIds.length > 0) {
    const qcSnapshots = await QC.find({ _id: { $in: qcIds } })
      .select("_id order quantities.client_demand quantities.qc_passed")
      .lean();
    const orderIds = [
      ...new Set(
        qcSnapshots.map((qc) => String(qc?.order || "")).filter(Boolean),
      ),
    ];
    const orderDocs = await Order.find({ _id: { $in: orderIds } })
      .select("_id status qc_record")
      .lean();
    const orderMap = new Map(orderDocs.map((order) => [String(order._id), order]));

    const orderBulkUpdates = [];
    for (const qc of qcSnapshots) {
      const orderId = String(qc?.order || "");
      if (!orderId) continue;

      const order = orderMap.get(orderId);
      if (!order) continue;

      const update = {};
      if (!order.qc_record || String(order.qc_record) !== String(qc._id)) {
        update.qc_record = qc._id;
      }

      if (order.status !== "Shipped" && order.status !== "Cancelled") {
        const desiredStatus = deriveOrderStatusFromQc(
          qc?.quantities?.client_demand,
          qc?.quantities?.qc_passed,
        );
        if (order.status !== desiredStatus) {
          update.status = desiredStatus;
        }
      }

      if (Object.keys(update).length > 0) {
        orderBulkUpdates.push({
          updateOne: {
            filter: { _id: orderId },
            update: { $set: update },
          },
        });
      }
    }

    if (orderBulkUpdates.length > 0) {
      const orderBulkResult = await Order.bulkWrite(orderBulkUpdates, {
        ordered: false,
      });
      console.log(
        "Order reconciliation updates:",
        orderBulkResult.modifiedCount || 0,
      );
    } else {
      console.log("Order reconciliation updates: 0");
    }
  }

  console.log("\nImport summary");
  console.log("-------------");
  console.log("Groups total:", summary.groupsTotal);
  console.log("Groups matched:", summary.groupsMatched);
  console.log("Groups unmatched:", summary.groupsUnmatched);
  console.log("Groups with match warnings:", summary.groupsWithWarnings);
  console.log("QC aligned:", summary.qcAligned);
  console.log("QC align failed:", summary.qcAlignFailed);
  console.log("Visit rows applied:", summary.rowVisitApplied);
  console.log("Visit rows skipped (duplicate):", summary.rowVisitSkippedAsDuplicate);
  console.log("Visit rows failed:", summary.rowVisitFailed);
  console.log("Metadata-only rows applied:", summary.rowMetadataOnlyApplied);
  console.log("Metadata-only rows failed:", summary.rowMetadataOnlyFailed);

  if (summary.unmatchedSamples.length) {
    console.log("\nUnmatched samples (up to 20):");
    console.table(summary.unmatchedSamples);
  }

  if (summary.alignErrors.length) {
    console.log("\nAlign errors (up to 30):");
    console.table(summary.alignErrors);
  }

  if (summary.visitErrors.length) {
    console.log("\nVisit errors (up to 50):");
    console.table(summary.visitErrors);
  }

  await mongoose.disconnect();
  console.log("\nDone");
}

main().catch(async (error) => {
  console.error("FAILED:", error);
  try {
    await mongoose.disconnect();
  } catch (_) {
    // ignore disconnect errors
  }
  process.exit(1);
});
