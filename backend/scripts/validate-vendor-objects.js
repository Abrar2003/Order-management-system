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
  getVendorId,
  getVendorName,
  isEmbeddedVendor,
  normalizeVendorName,
} = require("../helpers/vendorRef");

loadEnvFiles({
  cwd: path.resolve(__dirname, ".."),
  preserveExistingEnv: true,
});

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    report: "vendor-validation-report.xls",
  };

  for (const arg of args) {
    if (arg.startsWith("--report=")) options.report = arg.split("=").slice(1).join("=").trim();
  }

  return options;
};

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

const getPath = (object, dottedPath) =>
  String(dottedPath || "")
    .split(".")
    .filter(Boolean)
    .reduce((cursor, key) => (cursor && typeof cursor === "object" ? cursor[key] : undefined), object);

const addIssue = (report, collection, documentId, field, value, reason) => {
  report.issues.push({
    collection,
    documentId: String(documentId || ""),
    field,
    value,
    reason,
  });
};

const validateVendorValue = (value, { report, vendorIds, collection, documentId, field, allowEmpty = true }) => {
  if (!value) {
    if (!allowEmpty) addIssue(report, collection, documentId, field, value, "Vendor value is missing");
    return;
  }

  if (typeof value === "string") {
    addIssue(report, collection, documentId, field, value, "Legacy string vendor remains");
    return;
  }

  if (!isEmbeddedVendor(value)) {
    addIssue(report, collection, documentId, field, value, "Vendor object is missing name or vendor_id");
    return;
  }

  const vendorId = getVendorId(value);
  if (!vendorIds.has(vendorId)) {
    addIssue(report, collection, documentId, field, value, "vendor_id does not point to an existing Vendor document");
  }

  if (!Object.prototype.hasOwnProperty.call(value, "country")) {
    addIssue(report, collection, documentId, field, value, "Vendor object is missing country field");
  }
};

const validateSinglePath = ({ doc, spec, field, report, vendorIds }) => {
  validateVendorValue(getPath(doc, field), {
    report,
    vendorIds,
    collection: spec.collection,
    documentId: doc._id,
    field,
  });
};

const validateArrayPath = ({ doc, spec, field, report, vendorIds }) => {
  const values = getPath(doc, field);
  if (!Array.isArray(values)) {
    if (values !== undefined && values !== null) {
      addIssue(report, spec.collection, doc._id, field, values, "Vendor array field is not an array");
    }
    return;
  }

  values.forEach((value, index) => {
    validateVendorValue(value, {
      report,
      vendorIds,
      collection: spec.collection,
      documentId: doc._id,
      field: `${field}.${index}`,
    });
  });
};

const validateNestedSingleArray = ({ doc, spec, nested, report, vendorIds }) => {
  const entries = getPath(doc, nested.arrayPath);
  if (!Array.isArray(entries)) return;
  entries.forEach((entry, index) => {
    validateVendorValue(getPath(entry, nested.field), {
      report,
      vendorIds,
      collection: spec.collection,
      documentId: doc._id,
      field: `${nested.arrayPath}.${index}.${nested.field}`,
    });
  });
};

const summaryRowsFromReport = (report) => [
  { Metric: "Total scanned", Value: report.totalScanned },
  { Metric: "Duplicate vendor names", Value: report.duplicateVendorNames.length },
  { Metric: "Issues", Value: report.issues.length },
  { Metric: "Scanned collections", Value: report.scannedCollections.join(", ") },
];

const writeReport = (reportPath, report) =>
  writeWorkbookReport({
    reportPath,
    fallbackFileName: "vendor-validation-report.xls",
    sheets: [
      {
        name: "Summary",
        rows: summaryRowsFromReport(report),
        headers: ["Metric", "Value"],
      },
      {
        name: "Issues",
        rows: report.issues,
        headers: ["collection", "documentId", "field", "value", "reason"],
        emptyMessage: "No validation issues",
      },
      {
        name: "Duplicate Vendor Names",
        rows: report.duplicateVendorNames,
        headers: ["normalizedName", "count"],
        emptyMessage: "No duplicate vendor names",
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

  const vendors = await Vendor.find({
    $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
  })
    .select("_id name country")
    .lean();
  const vendorIds = new Set(vendors.map((vendor) => String(vendor._id)));
  const nameCounts = new Map();
  vendors.forEach((vendor) => {
    const key = normalizeVendorName(getVendorName(vendor));
    if (!key) return;
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  });

  const report = {
    scannedCollections: [],
    totalScanned: 0,
    duplicateVendorNames: [...nameCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([normalizedName, count]) => ({ normalizedName, count })),
    issues: [],
  };

  for (const spec of COLLECTION_SPECS) {
    report.scannedCollections.push(spec.collection);
    const collection = mongoose.connection.collection(spec.collection);
    const cursor = collection.find({});

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      report.totalScanned += 1;
      for (const field of spec.single || []) {
        validateSinglePath({ doc, spec, field, report, vendorIds });
      }
      for (const field of spec.arrays || []) {
        validateArrayPath({ doc, spec, field, report, vendorIds });
      }
      for (const nested of spec.nestedSingleArrays || []) {
        validateNestedSingleArray({ doc, spec, nested, report, vendorIds });
      }
    }
  }

  const reportFile = writeReport(options.report, report);
  console.log(JSON.stringify({ ...report, reportFile }, null, 2));
  console.log(`Excel report written to: ${reportFile}`);
  if (report.duplicateVendorNames.length > 0 || report.issues.length > 0) {
    process.exitCode = 1;
  }
};

main()
  .catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
