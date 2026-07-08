const path = require("path");
const mongoose = require("mongoose");

const { loadEnvFiles } = require("../config/loadEnv");
const {
  applyMongoDnsServersFromEnv,
  formatMongoConnectionError,
} = require("../helpers/mongoConnectionDiagnostics");
const { writeWorkbookReport } = require("../helpers/workbookReport");
const Vendor = require("../models/vendor.model");
const {
  buildEmbeddedVendor,
  buildVendorNameMap,
  getVendorName,
  isEmbeddedVendor,
  normalizeVendorName,
} = require("../helpers/vendorRef");

loadEnvFiles({
  cwd: path.resolve(__dirname, ".."),
  preserveExistingEnv: true,
});

const COLLECTION_SPECS = [
  { collection: "orders", single: ["vendor"] },
  { collection: "items", arrays: ["vendors"], nestedSingleArrays: [{ arrayPath: "finish", field: "vendor" }] },
  { collection: "qc", single: ["order_meta.vendor"] },
  { collection: "samples", arrays: ["vendor"] },
  { collection: "sample_workflows", arrays: ["vendor"] },
  { collection: "complaints", single: ["vendor"] },
  { collection: "finish", single: ["vendor"] },
  { collection: "emailLogs", single: ["vendor"] },
  { collection: "order_edit_logs", single: ["vendor"] },
  { collection: "qc_edit_logs", single: ["vendor"] },
  { collection: "pis_update_logs", arrays: ["vendors"] },
  { collection: "inspectors", nestedSingleArrays: [{ arrayPath: "label_used_history", field: "qc_meta.vendor" }] },
  {
    collection: "upload_logs",
    arrays: ["uploaded_vendors"],
    nestedSingleArrays: [
      { arrayPath: "vendor_summaries", field: "vendor" },
      { arrayPath: "conflicts", field: "vendor" },
    ],
  },
];

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    apply: false,
    collection: "",
    limit: 0,
    report: "vendor-backfill-report.xls",
  };

  for (const arg of args) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg.startsWith("--collection=")) options.collection = arg.split("=").slice(1).join("=").trim();
    else if (arg.startsWith("--limit=")) options.limit = Number.parseInt(arg.split("=")[1], 10) || 0;
    else if (arg.startsWith("--report=")) options.report = arg.split("=").slice(1).join("=").trim();
  }

  return options;
};

const getPath = (object, dottedPath) =>
  String(dottedPath || "")
    .split(".")
    .filter(Boolean)
    .reduce((cursor, key) => (cursor && typeof cursor === "object" ? cursor[key] : undefined), object);

const setPath = (object, dottedPath, value) => {
  const parts = String(dottedPath || "").split(".").filter(Boolean);
  if (parts.length === 0) return;
  let cursor = object;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
};

const reportUnmatched = (report, collection, documentId, field, oldValue, reason = "No matching Vendor document found") => {
  const name = getVendorName(oldValue);
  report.unmatchedVendors.push({
    collection,
    documentId: String(documentId || ""),
    field,
    oldValue,
    normalizedValue: normalizeVendorName(name),
    reason,
  });
};

const buildRef = (value, vendorByName) => {
  if (!value) return { status: "empty" };
  if (isEmbeddedVendor(value)) return { status: "converted", value };
  const name = getVendorName(value);
  if (!name) return { status: "empty" };
  const vendorDoc = vendorByName.get(normalizeVendorName(name));
  if (!vendorDoc) return { status: "unmatched", oldValue: value };
  return { status: "updated", value: buildEmbeddedVendor(vendorDoc, value?.country) };
};

const processSinglePath = ({ doc, collection, path: fieldPath, report, vendorByName }) => {
  const value = getPath(doc, fieldPath);
  const result = buildRef(value, vendorByName);
  if (result.status === "converted") {
    report.alreadyConverted += 1;
    return false;
  }
  if (result.status === "unmatched") {
    reportUnmatched(report, collection, doc._id, fieldPath, result.oldValue);
    return false;
  }
  if (result.status !== "updated") return false;
  setPath(doc, fieldPath, result.value);
  return true;
};

const processArrayPath = ({ doc, collection, path: fieldPath, report, vendorByName }) => {
  const values = getPath(doc, fieldPath);
  if (!Array.isArray(values) || values.length === 0) return false;

  let changed = false;
  let convertedCount = 0;
  const nextValues = [];
  for (const value of values) {
    const result = buildRef(value, vendorByName);
    if (result.status === "converted") {
      convertedCount += 1;
      nextValues.push(value);
      continue;
    }
    if (result.status === "unmatched") {
      reportUnmatched(report, collection, doc._id, fieldPath, result.oldValue);
      nextValues.push(value);
      continue;
    }
    if (result.status === "updated") {
      changed = true;
      nextValues.push(result.value);
      continue;
    }
    nextValues.push(value);
  }

  if (convertedCount === values.length) report.alreadyConverted += 1;
  if (changed) setPath(doc, fieldPath, nextValues);
  return changed;
};

const processNestedSingleArray = ({ doc, collection, arrayPath, field, report, vendorByName }) => {
  const entries = getPath(doc, arrayPath);
  if (!Array.isArray(entries) || entries.length === 0) return false;

  let changed = false;
  let convertedCount = 0;
  entries.forEach((entry, index) => {
    const fullPath = `${arrayPath}.${index}.${field}`;
    const value = getPath(entry, field);
    const result = buildRef(value, vendorByName);
    if (result.status === "converted") {
      convertedCount += 1;
      return;
    }
    if (result.status === "unmatched") {
      reportUnmatched(report, collection, doc._id, fullPath, result.oldValue);
      return;
    }
    if (result.status === "updated") {
      setPath(entry, field, result.value);
      changed = true;
    }
  });

  if (convertedCount === entries.length) report.alreadyConverted += 1;
  return changed;
};

const summaryRowsFromReport = (report) => [
  { Metric: "Mode", Value: report.mode },
  { Metric: "Total scanned", Value: report.totalScanned },
  { Metric: "Total records to update", Value: report.totalUpdated },
  { Metric: "Already converted vendor fields", Value: report.alreadyConverted },
  { Metric: "Unmatched vendors", Value: report.unmatchedVendors.length },
  { Metric: "Duplicate vendor names", Value: report.duplicateVendorNames.length },
  { Metric: "Skipped records", Value: report.skippedRecords.length },
  { Metric: "Errors", Value: report.errors.length },
  { Metric: "Scanned collections", Value: report.scannedCollections.join(", ") },
];

const writeReport = (reportPath, report) =>
  writeWorkbookReport({
    reportPath,
    fallbackFileName: "vendor-backfill-report.xls",
    sheets: [
      {
        name: "Summary",
        rows: summaryRowsFromReport(report),
        headers: ["Metric", "Value"],
      },
      {
        name: "Unmatched Vendors",
        rows: report.unmatchedVendors,
        headers: ["collection", "documentId", "field", "oldValue", "normalizedValue", "reason"],
        emptyMessage: "No unmatched vendors",
      },
      {
        name: "Duplicate Vendor Names",
        rows: report.duplicateVendorNames,
        headers: ["normalizedName", "vendors"],
        emptyMessage: "No duplicate vendor names",
      },
      {
        name: "Skipped Records",
        rows: report.skippedRecords,
        emptyMessage: "No skipped records",
      },
      {
        name: "Errors",
        rows: report.errors,
        headers: ["collection", "documentId", "message"],
        emptyMessage: "No errors",
      },
    ],
  });

const main = async () => {
  const options = parseArgs();
  const mongoUri = String(process.env.MONGO_URI || "").trim();
  if (!mongoUri) throw new Error("MONGO_URI is not configured");

  applyMongoDnsServersFromEnv();

  try {
    await mongoose.connect(mongoUri);
  } catch (error) {
    throw new Error(formatMongoConnectionError(error, mongoUri));
  }

  const vendorDocs = await Vendor.find({
    $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
  })
    .select("_id name country")
    .lean();
  const { map: vendorByName, duplicates } = buildVendorNameMap(vendorDocs);

  const report = {
    mode: options.apply ? "apply" : "dry-run",
    scannedCollections: [],
    totalScanned: 0,
    totalUpdated: 0,
    alreadyConverted: 0,
    unmatchedVendors: [],
    duplicateVendorNames: duplicates,
    skippedRecords: [],
    errors: [],
  };

  if (duplicates.length > 0) {
    const reportFile = writeReport(options.report, report);
    throw new Error(`Duplicate normalized vendor names found. See ${reportFile}`);
  }

  const specs = COLLECTION_SPECS.filter((spec) => !options.collection || spec.collection === options.collection);
  if (options.collection && specs.length === 0) {
    throw new Error(`Unknown collection "${options.collection}"`);
  }

  for (const spec of specs) {
    report.scannedCollections.push(spec.collection);
    const collection = mongoose.connection.collection(spec.collection);
    const cursor = collection.find({});
    if (options.limit > 0) cursor.limit(options.limit);

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      report.totalScanned += 1;
      let changed = false;

      try {
        for (const fieldPath of spec.single || []) {
          changed = processSinglePath({ doc, collection: spec.collection, path: fieldPath, report, vendorByName }) || changed;
        }
        for (const fieldPath of spec.arrays || []) {
          changed = processArrayPath({ doc, collection: spec.collection, path: fieldPath, report, vendorByName }) || changed;
        }
        for (const nested of spec.nestedSingleArrays || []) {
          changed = processNestedSingleArray({
            doc,
            collection: spec.collection,
            arrayPath: nested.arrayPath,
            field: nested.field,
            report,
            vendorByName,
          }) || changed;
        }

        if (changed) {
          report.totalUpdated += 1;
          if (options.apply) {
            await collection.replaceOne({ _id: doc._id }, doc);
          }
        }
      } catch (error) {
        report.errors.push({
          collection: spec.collection,
          documentId: String(doc?._id || ""),
          message: error?.message || String(error),
        });
      }
    }
  }

  const reportFile = writeReport(options.report, report);
  console.log(JSON.stringify({ ...report, reportFile }, null, 2));
  console.log(`Excel report written to: ${reportFile}`);
};

main()
  .catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
