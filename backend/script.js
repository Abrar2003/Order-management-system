/* scripts/import-qc-inspections.js
 *
 * Run:
 *   node scripts/import-qc-inspections.js "./QC REPORTS (1).xlsx"
 *
 * Requirements:
 *   npm i xlsx mongoose dotenv
 *
 * ENV:
 *   MONGO_URI="your atlas uri"
 */

const dns = require("dns");

// Force DNS servers for this Node process (bypasses Windows resolver issues)
dns.setServers(["1.1.1.1", "8.8.8.8"]);

require("dotenv").config();
const mongoose = require("mongoose");
const XLSX = require("xlsx");

// ✅ Adjust these paths to your project
const Order = require("./models/order.model"); // mongoose.model("orders", ...)
const QC = require("./models/qc.model"); // mongoose.model("qc", ...)
const Inspection = require("./models/inspection.model"); // mongoose.model("inspections", ...)
const dateParser = require("./helpers/dateparsser");

// ---- IDs you gave ----
const ADMIN_CREATED_BY = "699044abd0005a59180304db"; // Abrar admin
const FALLBACK_QC_USER = "699067156dc68aedb5899de4"; // Old QC (fallback)

// QC users map (Excel QC Name -> users._id)
// Match Excel QC Name to users.name (trimmed). Add aliases if needed.
const QC_NAME_TO_USER_ID = new Map([
  ["Ashwini Khandelwal", "6993feed473290fa1cf76b50"],
  ["Dev Sharma", "6993fec9473290fa1cf76b49"],
  ["Dashrath Suthar", "6993ff07473290fa1cf76b57"],
  ["Harbhajan Suthar", "6993ff2d473290fa1cf76b5e"],
  ["Old QC", "6993ff98473290fa1cf76b6c"],
  ["Aman Dutt", "6993ff47473290fa1cf76b65"],
]);

// ---------- helpers ----------
const toStr = (v) => (v === null || v === undefined ? "" : String(v)).trim();

const toNum = (v, fallback = 0) => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const excelSerialToDate = (serial) => {
  // Excel's day 1 = 1900-01-01, but JS epoch conversion typically uses 1899-12-30
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  return new Date(excelEpoch.getTime() + Number(serial) * 86400000);
};

const toDDMMYYYY = (value) => {
  if (value === null || value === undefined || value === "") return "";

  let d;

  // Case 1: already a Date
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    d = value;
  }
  // Case 2: Excel serial like "46067" or 46067
  else if (
    typeof value === "number" ||
    /^\d+(\.\d+)?$/.test(String(value).trim())
  ) {
    d = excelSerialToDate(Number(value));
  }
  // Case 3: string formats
  else {
    const s = String(value).trim();

    // DD/MM/YYYY or DD-MM-YYYY
    const m1 = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (m1) {
      const dd = Number(m1[1]);
      const mm = Number(m1[2]) - 1;
      const yyyy = Number(m1[3]);
      d = new Date(Date.UTC(yyyy, mm, dd));
    } else {
      // YYYY-MM-DD etc.
      const parsed = new Date(s);
      d = parsed;
    }
  }

  if (!d || Number.isNaN(d.getTime())) return "";

  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

// const fmtDate = (v) => {
//   // Excel parsed dates usually arrive as JS Date
//   if (v instanceof Date && !Number.isNaN(v.getTime())) {
//     const y = v.getFullYear();
//     const m = String(v.getMonth() + 1).padStart(2, "0");
//     const d = String(v.getDate()).padStart(2, "0");
//     return `${y}-${m}-${d}`;
//   }
//   // If already string like 2026-02-14
//   const s = toStr(v);
//   if (!s) return "";
//   // Try normalize DD/MM/YYYY
//   const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
//   if (m) {
//     const dd = m[1].padStart(2, "0");
//     const mm = m[2].padStart(2, "0");
//     const yyyy = m[3];
//     return `${yyyy}-${mm}-${dd}`;
//   }
//   console.log(s);
//   return s;
// };

// Try multiple header spellings (your file has trailing spaces on some)
const getCell = (row, ...keys) => {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(row, k)) return row[k];
    // sometimes trimmed
    const found = Object.keys(row).find((h) => h.trim() === k.trim());
    if (found) return row[found];
  }
  return undefined;
};

const orderKeyFromRow = (row) => {
  const po = toStr(getCell(row, "PO Number", "PO"));
  const itemCode = toStr(getCell(row, "Item Code", "Item code"));
  const vendor = toStr(getCell(row, "Vendor")).replace(/\s+/g, " ");
return `${po}||${vendor}||${itemCode}`;

};

const inspectionUniqKey = ({
  qcId,
  date,
  vendor_requested,
  vendor_offered,
  checked,
  passed,
}) => {
  return `${qcId}|${date}|${vendor_requested}|${vendor_offered}|${checked}|${passed}`;
};

// ---------- main ----------
async function main() {
  const filePath = process.argv[2] || "./QC REPORTS (1).xlsx";
  if (!process.env.MONGO_URI) throw new Error("Missing MONGO_URI in .env");

  console.log("Reading:", filePath);

  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  console.log("Rows:", rows.length);

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  // 1) Group rows by (PO, Vendor, Item Code)
  const groups = new Map(); // key -> { rows: [...] }
  for (const r of rows) {
    const key = orderKeyFromRow(r);
    if (!groups.has(key)) groups.set(key, { rows: [] });
    groups.get(key).rows.push(r);
  }

  // 2) Resolve Orders + Upsert QC (one per order item)
  const orderCache = new Map(); // key -> orderDoc
  const qcCache = new Map(); // key -> qcDoc
  const unmatched = [];

  for (const [key, g] of groups.entries()) {
    const any = g.rows[0];

    
    const order_id = toStr(getCell(any, "PO Number", "PO"));
    const item_code = toStr(getCell(any, "Item Code"));
    const vendor = toStr(getCell(any, "Vendor")).replace(/\s+/g, " ");

    // Find matching order doc (orders already exist)
    const order = await Order.findOne({
      order_id,
      vendor,
      "item.item_code": item_code,
    }).lean();

    if (!order) {
      unmatched.push({
        key,
        reason: "Order not found",
        order_id,
        item_code,
      });
      continue;
    }

    orderCache.set(key, order);

    // determine earliest/latest date in this group
    const dates = g.rows
      .map((r) => toDDMMYYYY(getCell(r, "Date")))
      .filter(Boolean)
      .sort(); // works for YYYY-MM-DD
    const request_date = dates[0] || "";
    const last_inspected_date = dates[dates.length - 1] || request_date;

    // use order brand/desc as canonical (Excel has blanks often)
    const brand = toStr(order.brand);
    const description = toStr(order.item?.description || "");

    // quantities from latest row (by date)
    // pick the row with max date string; fallback first
    const latestRow =
      g.rows
        .map((r) => ({ r, d: toDDMMYYYY(getCell(r, "Date")) || "0000-00-00" }))
        .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))[0]?.r ||
      g.rows[0];

    const qtyRequested = toNum(getCell(latestRow, "Qty Requested"), 0);
    const qtyOffered = toNum(getCell(latestRow, "Qty Offered"), 0);
    const qtyInspected = toNum(getCell(latestRow, "Qty Inspected"), 0);
    const qtyPassed = toNum(getCell(latestRow, "Qty Passed"), 0);
    const cbmTotal = toNum(getCell(latestRow, "CBM"), 0);
    const latestQcName = toStr(getCell(latestRow, "QC Name")).replace(
      /\s+/g,
      " ",
    );
    const latestInspectorId =
      QC_NAME_TO_USER_ID.get(latestQcName) || FALLBACK_QC_USER;

    // user requirement: pending based on ORDER quantity - passed
    const pending = Math.max(toNum(order.quantity, 0) - qtyPassed, 0);

    // Upsert QC by order ObjectId (best unique anchor)
    const qcUpdate = {
      $setOnInsert: {
        order: order._id,
        request_date: dateParser(request_date || fmtDate(new Date())),
        createdBy: ADMIN_CREATED_BY,
      },

      $set: {
        // ✅ set whole objects ONLY here
        order_meta: { order_id, vendor, brand },
        item: {
          item_code,
          description: description || toStr(getCell(any, "Item name")),
        },

        inspector: latestInspectorId,

        // ✅ only here (NOT in $setOnInsert)
        last_inspected_date: dateParser(
          last_inspected_date || request_date || fmtDate(new Date()),
        ),

        // optional defaults (safe to set repeatedly)
        cbm: { top: "0", bottom: "0", total: cbmTotal },
        barcode: 0,
        packed_size: false,
        finishing: false,
        branding: false,

        // quantities snapshot
        "quantities.client_demand": toNum(order.quantity, 0),
        "quantities.quantity_requested": qtyRequested,
        "quantities.vendor_provision": qtyOffered,
        "quantities.qc_checked": qtyInspected,
        "quantities.qc_passed": qtyPassed,
        "quantities.pending": pending,
      },
    };

    const qcDoc = await QC.findOneAndUpdate({ order: order._id }, qcUpdate, {
      upsert: true,
      new: true,
    });

    qcCache.set(key, qcDoc);
  }

  console.log("Groups:", groups.size);
  console.log("Matched orders:", orderCache.size);
  console.log("QC upserted:", qcCache.size);
  console.log("Unmatched rows:", unmatched.length);

  // 3) Prefetch existing inspections for de-dupe (so reruns don’t duplicate)
  const qcIds = [...new Set([...qcCache.values()].map((q) => String(q._id)))];
  const existing = await Inspection.find(
    { qc: { $in: qcIds } },
    {
      qc: 1,
      inspection_date: 1,
      vendor_requested: 1,
      vendor_offered: 1,
      checked: 1,
      passed: 1,
    },
  ).lean();

  const existingKeys = new Set(
    existing.map((e) =>
      inspectionUniqKey({
        qcId: String(e.qc),
        date: toStr(e.inspection_date),
        vendor_requested: toNum(e.vendor_requested, 0),
        vendor_offered: toNum(e.vendor_offered, 0),
        checked: toNum(e.checked, 0),
        passed: toNum(e.passed, 0),
      }),
    ),
  );

  // 4) Build inspections to insert + QC/Order updates
  const inspectionsToInsert = [];
  const qcUpdateMap = new Map(); // qcId -> { dates:Set, inspIds:[] later, lastDate, latestRowForSnapshot }
  const orderUpdates = []; // { orderId, qcId }

  for (const r of rows) {
    const key = orderKeyFromRow(r);
    const order = orderCache.get(key);
    const qc = qcCache.get(key);
    if (!order || !qc) continue;

    const inspection_date = toDDMMYYYY(getCell(r, "Date"));
    if (!inspection_date) continue;

    const qcName = toStr(getCell(r, "QC Name")).replace(/\s+/g, " ");
    console.log("qc", qcName);
    const inspectorIdStr = QC_NAME_TO_USER_ID.get(qcName) || FALLBACK_QC_USER;
    const inspectorId = new mongoose.Types.ObjectId(inspectorIdStr);
    const vendor_requested = toNum(getCell(r, "Qty Requested"), 0);
    const vendor_offered = toNum(getCell(r, "Qty Offered"), 0);
    const checked = toNum(getCell(r, "Qty Inspected"), 0);
    const passed = toNum(getCell(r, "Qty Passed"), 0);

    const pending_after = Math.max(toNum(order.quantity, 0) - passed, 0);

    const cbmTotal = toNum(getCell(r, "CBM", "CBM "), 0);
    const remarks = toStr(getCell(r, "Remarks"));

    const uniq = inspectionUniqKey({
      qcId: String(qc._id),
      date: inspection_date,
      vendor_requested,
      vendor_offered,
      checked,
      passed,
    });

    if (existingKeys.has(uniq)) continue; // skip duplicates already in DB

    existingKeys.add(uniq);

    inspectionsToInsert.push({
      qc: qc._id,
      inspector: inspectorId,
      inspection_date,
      vendor_requested,
      vendor_offered,
      checked,
      passed,
      pending_after,
      cbm: { top: "0", bottom: "0", total: String(cbmTotal || 0) },
      label_ranges: [],
      labels_added: [],
      remarks: remarks || "",
      createdBy: ADMIN_CREATED_BY,
    });

    // Track QC update info
    const qcId = String(qc._id);
    if (!qcUpdateMap.has(qcId)) {
      qcUpdateMap.set(qcId, { dates: new Set(), lastDate: "0000-00-00" });
    }
    const state = qcUpdateMap.get(qcId);
    state.dates.add(inspection_date);
    if (inspection_date > state.lastDate) state.lastDate = inspection_date;

    // order -> qc_record update (do later in bulk)
    orderUpdates.push({ orderId: String(order._id), qcId });
  }

  console.log("New inspections to insert:", inspectionsToInsert.length);

  // 5) Insert inspections
  let inserted = [];
  if (inspectionsToInsert.length > 0) {
    inserted = await Inspection.insertMany(inspectionsToInsert, {
      ordered: false,
    });
  }

  console.log("Inserted inspections:", inserted.length);

  // 6) Build QC bulk updates using inserted inspection IDs
  const byQc = new Map(); // qcId -> { inspIds:[], dates:[], lastDate }
  for (const doc of inserted) {
    const qcId = String(doc.qc);
    if (!byQc.has(qcId))
      byQc.set(qcId, { inspIds: [], dates: new Set(), lastDate: "0000-00-00" });
    const st = byQc.get(qcId);
    st.inspIds.push(doc._id);
    st.dates.add(toStr(doc.inspection_date));
    if (toStr(doc.inspection_date) > st.lastDate)
      st.lastDate = toStr(doc.inspection_date);
  }

  const qcBulk = [];
  for (const [qcId, st] of byQc.entries()) {
    qcBulk.push({
      updateOne: {
        filter: { _id: qcId },
        update: {
          $addToSet: {
            inspection_record: { $each: st.inspIds },
            inspection_dates: { $each: [...st.dates] },
          },
          $set: { last_inspected_date: st.lastDate },
        },
      },
    });
  }

  if (qcBulk.length > 0) {
    const res = await QC.bulkWrite(qcBulk, { ordered: false });
    console.log("QC bulk update:", res.modifiedCount, "modified");
  } else {
    console.log("QC bulk update: nothing to update");
  }

  // 7) Update Orders.qc_record in bulk (safe)
  // De-dupe order updates
  const orderMap = new Map();
  for (const ou of orderUpdates) orderMap.set(ou.orderId, ou.qcId);

  const orderBulk = [];
  for (const [orderId, qcId] of orderMap.entries()) {
    orderBulk.push({
      updateOne: {
        filter: { _id: orderId },
        update: { $set: { qc_record: qcId } },
      },
    });
  }

  if (orderBulk.length > 0) {
    const res = await Order.bulkWrite(orderBulk, { ordered: false });
    console.log("Orders qc_record updated:", res.modifiedCount, "modified");
  }

  // 8) Write unmatched log (optional)
  if (unmatched.length > 0) {
    console.log("Unmatched examples:", unmatched.slice(0, 5));
  }

  await mongoose.disconnect();
  console.log("Done ✅");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
