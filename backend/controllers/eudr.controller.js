const crypto = require("node:crypto");
const path = require("node:path");
const mongoose = require("mongoose");

const TimberSupplier = require("../models/timberSupplier.model");
const TimberPurchase = require("../models/timberPurchase.model");
const {
  DOCUMENT_CATEGORIES,
  buildInvoiceIdentity,
  findNameSimilarity,
  formatMilliCft,
  hasValidFileSignature,
  isApprovalBlocked,
  isSameActor,
  isValidGstin,
  normalizeFinancialYear,
  normalizeGstin,
  normalizeInvoiceNumber,
  normalizeKey,
  normalizeText,
  parseCftToMilli,
  sha256,
  validateDeliveryQuantities,
} = require("../helpers/eudrTimber");
const { getVendorAccessOptions } = require("../services/userDataAccess.service");
const {
  createStorageKey,
  deleteObject,
  getSignedObjectUrl,
  uploadBuffer,
} = require("../services/wasabiStorage.service");
const {
  runInventoryTransaction,
  syncApprovedPurchaseReceipts,
} = require("../services/eudrInventory.service");

const ACTIVE_DOCUMENT = (document) => !document?.replaced_at;
const MAX_LIST_LIMIT = 100;

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const buildActor = (user = {}) => ({
  user: user?._id || user?.id || null,
  name: normalizeText(user?.name) || normalizeText(user?.email) || "Unknown",
});

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseDate = (value, label, { required = false } = {}) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    if (required) throw createHttpError(400, `${label} is required`);
    return null;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw createHttpError(400, `${label} is invalid`);
  return parsed;
};

const parseJson = (value, fallback = {}) => {
  if (value && typeof value === "object") return value;
  const normalized = normalizeText(value);
  if (!normalized) return fallback;
  try {
    return JSON.parse(normalized);
  } catch {
    throw createHttpError(400, "Invalid JSON request field");
  }
};

const getAccessibleManufacturers = async (user) => getVendorAccessOptions({ user });

const getAccessibleManufacturerIds = async (user) =>
  (await getAccessibleManufacturers(user)).map((vendor) => String(vendor._id));

const assertManufacturerAccess = async (manufacturerId, user) => {
  if (!mongoose.Types.ObjectId.isValid(String(manufacturerId || ""))) {
    throw createHttpError(400, "Select a valid furniture manufacturer");
  }
  const manufacturer = (await getAccessibleManufacturers(user)).find(
    (vendor) => String(vendor._id) === String(manufacturerId),
  );
  if (!manufacturer) throw createHttpError(403, "You do not have access to the selected manufacturer");
  return manufacturer;
};

const assertPurchaseAccess = async (purchase, user) => {
  const allowedIds = await getAccessibleManufacturerIds(user);
  if (!allowedIds.includes(String(purchase?.manufacturer_vendor_id || ""))) {
    throw createHttpError(403, "You do not have access to this timber purchase");
  }
};

const createPurchaseNumber = () =>
  `TP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const activeInvoiceDocuments = (purchase = {}) =>
  (Array.isArray(purchase.documents) ? purchase.documents : []).filter(
    (document) => ACTIVE_DOCUMENT(document) && document.category === "TIMBER_PURCHASE_INVOICE",
  );

const toCft = (value) => formatMilliCft(value);

const serializeDocument = async (document = {}, { includeUrl = false } = {}) => {
  const serialized = {
    _id: String(document._id || ""),
    category: document.category || "",
    original_name: document.original_name || "",
    mime_type: document.mime_type || "",
    size_bytes: Number(document.size_bytes || 0),
    sha256: document.sha256 || "",
    uploaded_by: document.uploaded_by || null,
    uploaded_at: document.uploaded_at || null,
    replaced_document_id: document.replaced_document_id ? String(document.replaced_document_id) : "",
    replaced_at: document.replaced_at || null,
    replaced_by: document.replaced_by || null,
  };
  if (includeUrl && document.storage_key) {
    serialized.preview_url = await getSignedObjectUrl(document.storage_key, {
      expiresIn: 60 * 60,
      filename: document.original_name,
    });
  }
  return serialized;
};

const serializePurchase = async (purchase = {}, { includeDocuments = false } = {}) => {
  const raw = purchase.toObject ? purchase.toObject() : purchase;
  const result = {
    _id: String(raw._id || ""),
    purchase_number: raw.purchase_number || "",
    manufacturer_vendor_id: String(raw.manufacturer_vendor_id || ""),
    manufacturer: raw.manufacturer_snapshot || null,
    timber_supplier_id: String(raw.timber_supplier_id || ""),
    supplier: raw.supplier_snapshot || null,
    invoice_number: raw.invoice_number || "",
    financial_year: raw.financial_year || "",
    invoice_date: raw.invoice_date || null,
    species: raw.species || "",
    purchased_cft: toCft(raw.purchased_cft_milli),
    received_cft: toCft(raw.received_cft_milli),
    delivery_entries: (raw.delivery_entries || []).map((entry) => ({
      ...entry,
      _id: String(entry._id || ""),
      received_cft: toCft(entry.received_cft_milli),
    })),
    transport_details: raw.transport_details || {},
    purchase_remarks: raw.purchase_remarks || "",
    origin_information: raw.origin_information || {},
    document_check: raw.document_check
      ? { ...raw.document_check, invoice_quantity_cft: raw.document_check.invoice_quantity_milli_cft === null ? "" : toCft(raw.document_check.invoice_quantity_milli_cft) }
      : {},
    verification_status: raw.verification_status || "DRAFT",
    validation_flags: raw.validation_flags || [],
    duplicate_warning: (raw.validation_flags || []).some((flag) => flag.state !== "RESOLVED" && ["HARD", "WARNING"].includes(flag.severity)),
    reviewer_notes: raw.reviewer_notes || "",
    reviewed_by: raw.reviewed_by || null,
    reviewed_at: raw.reviewed_at || null,
    created_by: raw.created_by || null,
    updated_by: raw.updated_by || null,
    submitted_at: raw.submitted_at || null,
    created_at: raw.created_at || raw.createdAt || null,
    updated_at: raw.updated_at || raw.updatedAt || null,
  };
  if (includeDocuments) {
    result.documents = await Promise.all((raw.documents || []).map((document) => serializeDocument(document, { includeUrl: true })));
    result.audit_history = raw.audit_history || [];
  }
  return result;
};

const serializeSupplier = (supplier = {}) => {
  const raw = supplier.toObject ? supplier.toObject() : supplier;
  return {
    _id: String(raw._id || ""),
    name: raw.name || "",
    gstin: raw.gstin || "",
    contact_person: raw.contact_person || "",
    mobile_number: raw.mobile_number || "",
    email: raw.email || "",
    address: raw.address || "",
    city: raw.city || "",
    state: raw.state || "",
    country: raw.country || "India",
    supplier_type: raw.supplier_type || "TIMBER_TRADER",
    remarks: raw.remarks || "",
    is_active: raw.is_active !== false,
    created_by: raw.created_by || null,
    updated_by: raw.updated_by || null,
    created_at: raw.created_at || raw.createdAt || null,
    updated_at: raw.updated_at || raw.updatedAt || null,
  };
};

const pushAudit = (purchase, action, actor, details = {}) => {
  purchase.audit_history.push({ action, actor, timestamp: new Date(), details });
  purchase.updated_by = actor;
};

const parseDeliveryEntries = (value, actor, existingEntries = []) => {
  const entries = Array.isArray(value) ? value : parseJson(value, []);
  if (!Array.isArray(entries)) throw createHttpError(400, "Delivery entries must be a list");
  const existingById = new Map((existingEntries || []).map((entry) => [String(entry?._id || ""), entry]));
  return entries.map((entry) => {
    const suppliedId = String(entry?._id || "");
    const existing = existingById.get(suppliedId);
    if (suppliedId && !existing) throw createHttpError(400, "A delivery entry cannot be replaced with an unknown receipt id");
    return {
      ...(existing?._id ? { _id: existing._id } : {}),
      received_cft_milli: parseCftToMilli(entry?.received_cft ?? entry?.received_cft_milli / 1000),
      delivery_date: parseDate(entry?.delivery_date, "Delivery date"),
      transporter_name: normalizeText(entry?.transporter_name),
      transporter_contact_number: normalizeText(entry?.transporter_contact_number),
      vehicle_number: normalizeText(entry?.vehicle_number),
      delivery_challan_number: normalizeText(entry?.delivery_challan_number),
      e_way_bill_number: normalizeText(entry?.e_way_bill_number),
      remarks: normalizeText(entry?.remarks),
      created_by: existing?.created_by || actor,
      created_at: existing?.created_at || new Date(),
    };
  });
};

const buildDocumentCheck = (value = {}, existing = {}) => {
  const check = parseJson(value, {});
  const has = (key) => Object.prototype.hasOwnProperty.call(check, key);
  const rawQuantity = has("invoice_quantity_cft")
    ? check.invoice_quantity_cft
    : existing.invoice_quantity_milli_cft === null || existing.invoice_quantity_milli_cft === undefined
      ? ""
      : formatMilliCft(existing.invoice_quantity_milli_cft);
  return {
    invoice_quantity_milli_cft: normalizeText(rawQuantity) ? parseCftToMilli(rawQuantity, { allowZero: true }) : null,
    invoice_supplier_name: has("invoice_supplier_name") ? normalizeText(check.invoice_supplier_name) : normalizeText(existing.invoice_supplier_name),
    invoice_gstin: has("invoice_gstin") ? (normalizeGstin(check.invoice_gstin) || "") : normalizeText(existing.invoice_gstin),
    invoice_quantity_confirmed: has("invoice_quantity_confirmed")
      ? check.invoice_quantity_confirmed === true || check.invoice_quantity_confirmed === "true"
      : existing.invoice_quantity_confirmed === true,
  };
};

const updatePurchaseFromPayload = async (purchase, payload = {}, user) => {
  const actor = buildActor(user);
  const changed = [];
  const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);

  if (has("manufacturer_vendor_id")) {
    const manufacturerId = normalizeText(payload.manufacturer_vendor_id);
    if (!manufacturerId) {
      purchase.manufacturer_vendor_id = null;
      purchase.manufacturer_snapshot = null;
    } else {
      const manufacturer = await assertManufacturerAccess(manufacturerId, user);
      purchase.manufacturer_vendor_id = manufacturer._id;
      purchase.manufacturer_snapshot = {
        vendor_id: manufacturer._id,
        name: manufacturer.name,
        country: manufacturer.country || "",
      };
    }
    changed.push("manufacturer");
  }

  if (has("timber_supplier_id")) {
    const supplierId = normalizeText(payload.timber_supplier_id);
    if (!supplierId) {
      purchase.timber_supplier_id = null;
      purchase.supplier_snapshot = { name: "", gstin: "" };
    } else {
      if (!mongoose.Types.ObjectId.isValid(supplierId)) {
        throw createHttpError(400, "Select a valid timber supplier");
      }
      const supplier = await TimberSupplier.findById(supplierId);
      if (!supplier || !supplier.is_active) throw createHttpError(400, "Select an active timber supplier");
      purchase.timber_supplier_id = supplier._id;
      purchase.supplier_snapshot = { name: supplier.name, gstin: supplier.gstin || "" };
    }
    changed.push("supplier");
  }

  if (has("invoice_number")) {
    purchase.invoice_number = normalizeText(payload.invoice_number);
    purchase.normalized_invoice_number = normalizeInvoiceNumber(payload.invoice_number);
    changed.push("invoice number");
  }
  if (has("invoice_date")) {
    purchase.invoice_date = parseDate(payload.invoice_date, "Invoice date");
    purchase.financial_year = normalizeFinancialYear(payload.financial_year || purchase.financial_year, purchase.invoice_date);
    changed.push("invoice date");
  } else if (has("financial_year")) {
    purchase.financial_year = normalizeFinancialYear(payload.financial_year, purchase.invoice_date);
    changed.push("financial year");
  }
  if (has("species")) { purchase.species = normalizeText(payload.species); changed.push("species"); }
  if (has("purchased_cft")) {
    purchase.purchased_cft_milli = normalizeText(payload.purchased_cft)
      ? parseCftToMilli(payload.purchased_cft)
      : 0;
    changed.push("purchased CFT");
  }
  if (has("delivery_entries")) {
    const incomingEntries = Array.isArray(payload.delivery_entries)
      ? payload.delivery_entries
      : parseJson(payload.delivery_entries, []);
    const wasPreviouslyApproved = (purchase.audit_history || []).some((entry) => entry?.action === "APPROVED");
    if (wasPreviouslyApproved) {
      const incomingIds = new Set(incomingEntries.map((entry) => String(entry?._id || "")).filter(Boolean));
      const removedReceipt = (purchase.delivery_entries || []).some((entry) => !incomingIds.has(String(entry?._id || "")));
      if (removedReceipt) throw createHttpError(409, "Previously approved receipt entries cannot be removed; correct the existing receipt quantity instead");
    }
    purchase.delivery_entries = parseDeliveryEntries(incomingEntries, actor, purchase.delivery_entries);
    changed.push("delivery entries");
  } else if (has("initial_received_cft") || has("received_cft")) {
    const received = payload.initial_received_cft ?? payload.received_cft;
    const amount = normalizeText(received);
    purchase.delivery_entries = amount && parseCftToMilli(amount, { allowZero: true }) > 0
      ? [{ received_cft_milli: parseCftToMilli(amount), created_by: actor }]
      : [];
    changed.push("initial receipt");
  }
  if (has("transport_details")) {
    const details = parseJson(payload.transport_details, {});
    purchase.transport_details = {
      transporter_name: normalizeText(details.transporter_name),
      transporter_contact_number: normalizeText(details.transporter_contact_number),
      vehicle_number: normalizeText(details.vehicle_number),
      transport_date: parseDate(details.transport_date, "Transport date"),
      delivery_challan_number: normalizeText(details.delivery_challan_number),
      e_way_bill_number: normalizeText(details.e_way_bill_number),
      delivery_remarks: normalizeText(details.delivery_remarks),
    };
    changed.push("transport details");
  }
  if (has("purchase_remarks")) { purchase.purchase_remarks = normalizeText(payload.purchase_remarks); changed.push("purchase remarks"); }
  if (has("origin_information")) {
    const origin = parseJson(payload.origin_information, {});
    purchase.origin_information = {
      harvesting_country: normalizeText(origin.harvesting_country),
      scientific_species_name: normalizeText(origin.scientific_species_name),
      origin_document_reference: normalizeText(origin.origin_document_reference),
      remarks: normalizeText(origin.remarks),
    };
    changed.push("origin information");
  }
  if (has("document_check")) {
    purchase.document_check = buildDocumentCheck(payload.document_check, purchase.document_check || {});
    changed.push("document check");
  }

  if (purchase.purchased_cft_milli > 0 || purchase.delivery_entries.length > 0) {
    const quantityError = validateDeliveryQuantities({
      purchasedMilliCft: purchase.purchased_cft_milli,
      deliveryEntries: purchase.delivery_entries,
    });
    if (quantityError) throw createHttpError(400, quantityError);
  }
  purchase.received_cft_milli = (purchase.delivery_entries || []).reduce((total, entry) => total + entry.received_cft_milli, 0);
  purchase.updated_by = actor;
  return changed;
};

const validateSubmission = (purchase) => {
  if (!purchase.manufacturer_vendor_id) return "Furniture manufacturer is required";
  if (!purchase.timber_supplier_id) return "Timber supplier is required";
  if (!normalizeText(purchase.invoice_number)) return "Invoice number is required";
  if (!normalizeText(purchase.normalized_invoice_number)) return "Invoice number is invalid";
  if (!purchase.invoice_date) return "Invoice date is required";
  if (!normalizeText(purchase.financial_year)) return "Financial year is required";
  if (!purchase.purchased_cft_milli || purchase.purchased_cft_milli <= 0) return "Purchased CFT must be greater than zero";
  if (activeInvoiceDocuments(purchase).length === 0) return "Upload an active Timber Purchase Invoice before submission";
  return validateDeliveryQuantities({
    purchasedMilliCft: purchase.purchased_cft_milli,
    deliveryEntries: purchase.delivery_entries,
  });
};

const buildValidationFlags = async (purchase) => {
  const flags = [];
  const activeDocuments = (purchase.documents || []).filter(ACTIVE_DOCUMENT);
  const invoiceDocuments = activeInvoiceDocuments(purchase);
  if (invoiceDocuments.length === 0) {
    flags.push({ code: "MISSING_INVOICE", severity: "HARD", message: "A Timber Purchase Invoice must be attached", matched_purchase_ids: [] });
  }

  if (purchase.timber_supplier_id && purchase.normalized_invoice_number && purchase.financial_year) {
    const identityMatches = await TimberPurchase.find({
      _id: { $ne: purchase._id },
      timber_supplier_id: purchase.timber_supplier_id,
      normalized_invoice_number: purchase.normalized_invoice_number,
      financial_year: purchase.financial_year,
      verification_status: { $ne: "REJECTED" },
    }).select("_id purchased_cft_milli manufacturer_snapshot purchase_number verification_status").lean();
    if (identityMatches.length > 0) {
      flags.push({
        code: "DUPLICATE_INVOICE_IDENTITY",
        severity: "HARD",
        message: "This supplier invoice identity is already registered, including across manufacturers",
        matched_purchase_ids: identityMatches.map((match) => match._id),
      });
      if (identityMatches.some((match) => match.purchased_cft_milli !== purchase.purchased_cft_milli)) {
        flags.push({
          code: "INVOICE_QUANTITY_DIFFERS",
          severity: "WARNING",
          message: "A matching invoice identity has a different claimed CFT quantity",
          matched_purchase_ids: identityMatches.map((match) => match._id),
        });
      }
    }
  }

  const hashes = activeDocuments.map((document) => document.sha256).filter(Boolean);
  if (hashes.length > 0) {
    const hashMatches = await TimberPurchase.find({
      _id: { $ne: purchase._id },
      "documents.sha256": { $in: hashes },
    }).select("_id documents manufacturer_snapshot purchase_number").lean();
    const invoiceHashes = new Set(invoiceDocuments.map((document) => document.sha256));
    const invoiceMatches = hashMatches.filter((match) =>
      (match.documents || []).some((document) => invoiceHashes.has(document.sha256) && document.category === "TIMBER_PURCHASE_INVOICE"),
    );
    if (invoiceMatches.length > 0) {
      flags.push({
        code: "DUPLICATE_INVOICE_FILE",
        severity: "HARD",
        message: "An identical invoice file has already been uploaded for another purchase",
        matched_purchase_ids: invoiceMatches.map((match) => match._id),
      });
    }
    const supportingMatches = hashMatches.filter((match) => !invoiceMatches.includes(match));
    if (supportingMatches.length > 0) {
      flags.push({
        code: "DUPLICATE_SUPPORTING_FILE",
        severity: "WARNING",
        message: "An identical supporting file is attached to another purchase and requires review",
        matched_purchase_ids: supportingMatches.map((match) => match._id),
      });
    }
  }

  const documentCheck = purchase.document_check || {};
  if (
    documentCheck.invoice_quantity_milli_cft !== null
    && documentCheck.invoice_quantity_milli_cft !== undefined
    && documentCheck.invoice_quantity_milli_cft !== purchase.purchased_cft_milli
  ) {
    flags.push({ code: "INVOICE_QUANTITY_MISMATCH", severity: "HARD", message: "Invoice quantity entered for review differs from claimed purchased CFT", matched_purchase_ids: [] });
  }
  if (documentCheck.invoice_supplier_name && findNameSimilarity(documentCheck.invoice_supplier_name, purchase.supplier_snapshot?.name) < 0.8) {
    flags.push({ code: "INVOICE_SUPPLIER_MISMATCH", severity: "WARNING", message: "Supplier name entered from the invoice differs from the selected supplier", matched_purchase_ids: [] });
  }
  if (documentCheck.invoice_gstin && documentCheck.invoice_gstin !== normalizeGstin(purchase.supplier_snapshot?.gstin)) {
    flags.push({ code: "INVOICE_GSTIN_MISMATCH", severity: "WARNING", message: "GSTIN entered from the invoice differs from the selected supplier", matched_purchase_ids: [] });
  }
  if (purchase.transport_details?.transport_date && purchase.invoice_date && new Date(purchase.transport_details.transport_date) < new Date(purchase.invoice_date)) {
    flags.push({ code: "TRANSPORT_BEFORE_INVOICE", severity: "WARNING", message: "Transport date is before invoice date and requires reviewer confirmation", matched_purchase_ids: [] });
  }
  if ((purchase.delivery_entries || []).some((entry) => entry.delivery_date && purchase.invoice_date && new Date(entry.delivery_date) < new Date(purchase.invoice_date))) {
    flags.push({ code: "DELIVERY_BEFORE_INVOICE", severity: "WARNING", message: "A delivery date is before the invoice date and requires reviewer confirmation", matched_purchase_ids: [] });
  }
  if (purchase.transport_details?.e_way_bill_number) {
    const eWayMatches = await TimberPurchase.find({
      _id: { $ne: purchase._id },
      "transport_details.e_way_bill_number": purchase.transport_details.e_way_bill_number,
      verification_status: { $ne: "REJECTED" },
    }).select("_id transport_details.vehicle_number").lean();
    if (eWayMatches.length > 0) {
      const hasVehicleConflict = eWayMatches.some((match) => {
        const previousVehicle = normalizeKey(match?.transport_details?.vehicle_number);
        const currentVehicle = normalizeKey(purchase.transport_details?.vehicle_number);
        return previousVehicle && currentVehicle && previousVehicle !== currentVehicle;
      });
      flags.push({
        code: hasVehicleConflict ? "EWAY_BILL_VEHICLE_CONFLICT" : "EWAY_BILL_REUSED",
        severity: "WARNING",
        message: hasVehicleConflict
          ? "This E-Way Bill is linked to a different vehicle on another purchase"
          : "This E-Way Bill number appears on another purchase",
        matched_purchase_ids: eWayMatches.map((match) => match._id),
      });
    }
  }
  return flags;
};

const revalidatePurchase = async (purchase, actor, { audit = true } = {}) => {
  purchase.validation_flags = await buildValidationFlags(purchase);
  if (audit) pushAudit(purchase, "VALIDATION_RUN", actor, { flag_count: purchase.validation_flags.length });
  return purchase.validation_flags;
};

const ensureEditable = (purchase) => {
  if (!["DRAFT", "NEEDS_INFORMATION"].includes(purchase.verification_status)) {
    throw createHttpError(409, "Only draft or needs-information purchases can be edited");
  }
};

const getPurchaseOrThrow = async (id, user) => {
  if (!mongoose.Types.ObjectId.isValid(String(id || ""))) throw createHttpError(400, "Invalid timber purchase id");
  const purchase = await TimberPurchase.findById(id);
  if (!purchase) throw createHttpError(404, "Timber purchase not found");
  await assertPurchaseAccess(purchase, user);
  return purchase;
};

exports.listSuppliers = async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(MAX_LIST_LIMIT, parsePositiveInt(req.query.limit, 25));
    const search = normalizeText(req.query.search);
    const active = normalizeText(req.query.active);
    const match = {};
    if (active === "true" || active === "false") match.is_active = active === "true";
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      match.$or = ["name", "gstin", "contact_person", "city", "state"].map((field) => ({ [field]: { $regex: escaped, $options: "i" } }));
    }
    const [rows, total] = await Promise.all([
      TimberSupplier.find(match).sort({ is_active: -1, name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      TimberSupplier.countDocuments(match),
    ]);
    return res.json({ success: true, data: rows.map(serializeSupplier), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to list timber suppliers" });
  }
};

exports.listManufacturers = async (req, res) => {
  try {
    const manufacturers = await getAccessibleManufacturers(req.user);
    return res.json({
      success: true,
      data: manufacturers.map((manufacturer) => ({
        _id: String(manufacturer._id),
        name: manufacturer.name,
        country: manufacturer.country || "",
      })),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to list manufacturers" });
  }
};

exports.getSupplier = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw createHttpError(400, "Invalid timber supplier id");
    const supplier = await TimberSupplier.findById(req.params.id).lean();
    if (!supplier) throw createHttpError(404, "Timber supplier not found");
    const allowedIds = await getAccessibleManufacturerIds(req.user);
    const purchases = await TimberPurchase.find({ timber_supplier_id: supplier._id, manufacturer_vendor_id: { $in: allowedIds } })
      .sort({ created_at: -1 }).limit(100).lean();
    return res.json({ success: true, data: { ...serializeSupplier(supplier), purchases: await Promise.all(purchases.map((purchase) => serializePurchase(purchase)) ) } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to get timber supplier" });
  }
};

const validateSupplierPayload = (payload = {}) => {
  const name = normalizeText(payload.name);
  const country = normalizeText(payload.country) || "India";
  const gstin = normalizeGstin(payload.gstin);
  if (!name) throw createHttpError(400, "Supplier name is required");
  if (!isValidGstin(gstin)) throw createHttpError(400, "GSTIN format is invalid");
  return { name, country, gstin };
};

const supplierInput = (payload, actor) => {
  const { name, country, gstin } = validateSupplierPayload(payload);
  return {
    name,
    normalized_name: normalizeKey(name),
    gstin,
    normalized_gstin: gstin,
    contact_person: normalizeText(payload.contact_person),
    mobile_number: normalizeText(payload.mobile_number),
    email: normalizeText(payload.email).toLowerCase(),
    address: normalizeText(payload.address),
    city: normalizeText(payload.city),
    state: normalizeText(payload.state),
    country,
    supplier_type: normalizeText(payload.supplier_type) || "TIMBER_TRADER",
    remarks: normalizeText(payload.remarks),
    is_active: payload.is_active !== false && payload.is_active !== "false",
    updated_by: actor,
  };
};

const similarSupplierWarnings = async (name, exceptId = "") => {
  const candidates = await TimberSupplier.find({ _id: exceptId ? { $ne: exceptId } : { $exists: true }, is_active: true }).select("_id name").lean();
  return candidates
    .map((supplier) => ({ supplier, similarity: findNameSimilarity(name, supplier.name) }))
    .filter(({ similarity }) => similarity >= 0.8 && similarity < 1)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 5)
    .map(({ supplier }) => ({ supplier_id: String(supplier._id), supplier_name: supplier.name }));
};

exports.createSupplier = async (req, res) => {
  try {
    const actor = buildActor(req.user);
    const input = supplierInput(req.body || {}, actor);
    input.created_by = actor;
    const duplicate = await TimberSupplier.findOne({
      $or: [
        ...(input.normalized_gstin ? [{ normalized_gstin: input.normalized_gstin }] : []),
        { normalized_name: input.normalized_name, country: input.country, is_active: true },
      ],
    }).lean();
    if (duplicate) throw createHttpError(409, "A matching active timber supplier or GSTIN already exists");
    const warnings = await similarSupplierWarnings(input.name);
    const supplier = await TimberSupplier.create(input);
    return res.status(201).json({ success: true, data: serializeSupplier(supplier), warnings });
  } catch (error) {
    const status = error.code === 11000 ? 409 : error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.code === 11000 ? "A matching GSTIN or active supplier identity already exists" : error.message || "Failed to create timber supplier" });
  }
};

exports.updateSupplier = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw createHttpError(400, "Invalid timber supplier id");
    const supplier = await TimberSupplier.findById(req.params.id);
    if (!supplier) throw createHttpError(404, "Timber supplier not found");
    const input = supplierInput({ ...supplier.toObject(), ...(req.body || {}) }, buildActor(req.user));
    if (input.is_active) {
      const duplicate = await TimberSupplier.findOne({
        _id: { $ne: supplier._id },
        $or: [
          ...(input.normalized_gstin ? [{ normalized_gstin: input.normalized_gstin }] : []),
          { normalized_name: input.normalized_name, country: input.country, is_active: true },
        ],
      }).lean();
      if (duplicate) throw createHttpError(409, "A matching active timber supplier or GSTIN already exists");
    }
    Object.assign(supplier, input);
    await supplier.save();
    return res.json({ success: true, data: serializeSupplier(supplier), warnings: await similarSupplierWarnings(supplier.name, supplier._id) });
  } catch (error) {
    const status = error.code === 11000 ? 409 : error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.code === 11000 ? "A matching GSTIN already exists" : error.message || "Failed to update timber supplier" });
  }
};

exports.listPurchases = async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(MAX_LIST_LIMIT, parsePositiveInt(req.query.limit, 25));
    const allowedManufacturerIds = await getAccessibleManufacturerIds(req.user);
    const match = { manufacturer_vendor_id: { $in: allowedManufacturerIds } };
    const search = normalizeText(req.query.search || req.query.invoice_number);
    const status = normalizeText(req.query.status);
    const supplierId = normalizeText(req.query.timber_supplier_id);
    const manufacturerId = normalizeText(req.query.manufacturer_vendor_id);
    if (status && status !== "ALL") match.verification_status = status;
    if (mongoose.Types.ObjectId.isValid(supplierId)) match.timber_supplier_id = supplierId;
    if (manufacturerId && allowedManufacturerIds.includes(manufacturerId)) match.manufacturer_vendor_id = manufacturerId;
    if (normalizeText(req.query.duplicates) === "true") match["validation_flags.state"] = "OPEN";
    const from = parseDate(req.query.date_from, "From date");
    const to = parseDate(req.query.date_to, "To date");
    if (from || to) {
      match.invoice_date = {};
      if (from) match.invoice_date.$gte = from;
      if (to) { to.setUTCHours(23, 59, 59, 999); match.invoice_date.$lte = to; }
    }
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      match.$or = ["purchase_number", "invoice_number", "manufacturer_snapshot.name", "supplier_snapshot.name", "species"].map((field) => ({ [field]: { $regex: escaped, $options: "i" } }));
    }
    const [rows, total] = await Promise.all([
      TimberPurchase.find(match).sort({ created_at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      TimberPurchase.countDocuments(match),
    ]);
    return res.json({ success: true, data: await Promise.all(rows.map((purchase) => serializePurchase(purchase))), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to list timber purchases" });
  }
};

exports.createPurchase = async (req, res) => {
  try {
    const actor = buildActor(req.user);
    const purchase = new TimberPurchase({ purchase_number: createPurchaseNumber(), created_by: actor, updated_by: actor });
    const changed = await updatePurchaseFromPayload(purchase, req.body || {}, req.user);
    pushAudit(purchase, "CREATED", actor, { fields: changed });
    await runInventoryTransaction(async (session) => {
      await purchase.save({ session });
      await syncApprovedPurchaseReceipts({ purchase, actor, session });
    });
    return res.status(201).json({ success: true, data: await serializePurchase(purchase, { includeDocuments: true }) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to create timber purchase" });
  }
};

exports.getPurchase = async (req, res) => {
  try {
    const purchase = await getPurchaseOrThrow(req.params.id, req.user);
    return res.json({ success: true, data: await serializePurchase(purchase, { includeDocuments: true }) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to get timber purchase" });
  }
};

exports.updatePurchase = async (req, res) => {
  try {
    const purchase = await getPurchaseOrThrow(req.params.id, req.user);
    ensureEditable(purchase);
    const actor = buildActor(req.user);
    const changed = await updatePurchaseFromPayload(purchase, req.body || {}, req.user);
    pushAudit(purchase, "UPDATED", actor, { fields: changed });
    await revalidatePurchase(purchase, actor, { audit: false });
    await purchase.save();
    return res.json({ success: true, data: await serializePurchase(purchase, { includeDocuments: true }) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to update timber purchase" });
  }
};

exports.uploadDocuments = async (req, res) => {
  const uploadedKeys = [];
  try {
    const purchase = await getPurchaseOrThrow(req.params.id, req.user);
    ensureEditable(purchase);
    const category = normalizeText(req.body?.category);
    if (!DOCUMENT_CATEGORIES.includes(category)) throw createHttpError(400, "Select a valid document category");
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) throw createHttpError(400, "Select at least one document to upload");
    const actor = buildActor(req.user);
    const replacementId = normalizeText(req.body?.replace_document_id);
    let replacement = null;
    if (replacementId) {
      replacement = purchase.documents.id(replacementId);
      if (!replacement || replacement.replaced_at) throw createHttpError(400, "The document selected for replacement is unavailable");
    }
    const documents = [];
    for (const file of files) {
      if (!hasValidFileSignature(file.buffer, file.mimetype)) {
        throw createHttpError(400, `${normalizeText(file.originalname) || "File"} does not match an allowed PDF, JPEG, or PNG signature`);
      }
      const originalName = path.basename(normalizeText(file.originalname)).replace(/[\x00-\x1f]/g, "");
      const key = createStorageKey({ folder: `eudr-timber/${purchase._id}`, originalName, extension: path.extname(originalName).toLowerCase() });
      const stored = await uploadBuffer({ buffer: file.buffer, key, originalName, contentType: file.mimetype });
      uploadedKeys.push(stored.key);
      documents.push({
        category,
        storage_key: stored.key,
        original_name: originalName,
        mime_type: file.mimetype,
        size_bytes: Number(file.size || stored.size || 0),
        sha256: sha256(file.buffer),
        uploaded_by: actor,
        uploaded_at: new Date(),
      });
    }
    purchase.documents.push(...documents);
    if (replacement) {
      replacement.replaced_at = new Date();
      replacement.replaced_by = actor;
      replacement.replaced_document_id = purchase.documents[purchase.documents.length - documents.length]?._id || null;
    }
    pushAudit(purchase, replacement ? "DOCUMENT_REPLACED" : "DOCUMENT_UPLOADED", actor, { category, count: documents.length, replaced_document_id: replacementId || "" });
    await revalidatePurchase(purchase, actor, { audit: false });
    await purchase.save();
    return res.status(201).json({ success: true, data: await serializePurchase(purchase, { includeDocuments: true }) });
  } catch (error) {
    await Promise.all(uploadedKeys.map((key) => deleteObject(key).catch(() => undefined)));
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to upload timber purchase documents" });
  }
};

exports.getPurchaseDocuments = async (req, res) => {
  try {
    const purchase = await getPurchaseOrThrow(req.params.id, req.user);
    return res.json({ success: true, data: await Promise.all((purchase.documents || []).map((document) => serializeDocument(document, { includeUrl: true }))) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to get timber documents" });
  }
};

exports.downloadDocument = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw createHttpError(400, "Invalid document id");
    const purchase = await TimberPurchase.findOne({ "documents._id": req.params.id });
    if (!purchase) throw createHttpError(404, "Document not found");
    await assertPurchaseAccess(purchase, req.user);
    const document = purchase.documents.id(req.params.id);
    if (!document?.storage_key) throw createHttpError(404, "Document storage reference is unavailable");
    const url = await getSignedObjectUrl(document.storage_key, { expiresIn: 60 * 60, filename: document.original_name });
    return res.redirect(url);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to download timber document" });
  }
};

exports.submitPurchase = async (req, res) => {
  try {
    const purchase = await getPurchaseOrThrow(req.params.id, req.user);
    if (purchase.verification_status === "SUBMITTED") return res.json({ success: true, data: await serializePurchase(purchase, { includeDocuments: true }) });
    ensureEditable(purchase);
    const errorMessage = validateSubmission(purchase);
    if (errorMessage) throw createHttpError(400, errorMessage);
    const actor = buildActor(req.user);
    await revalidatePurchase(purchase, actor, { audit: false });
    purchase.verification_status = "SUBMITTED";
    purchase.submitted_at = new Date();
    pushAudit(purchase, "SUBMITTED", actor, { validation_flag_count: purchase.validation_flags.length });
    await purchase.save();
    return res.json({ success: true, data: await serializePurchase(purchase, { includeDocuments: true }) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to submit timber purchase" });
  }
};

exports.revalidatePurchase = async (req, res) => {
  try {
    const purchase = await getPurchaseOrThrow(req.params.id, req.user);
    const actor = buildActor(req.user);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "document_check")) {
      purchase.document_check = buildDocumentCheck(req.body.document_check, purchase.document_check || {});
    }
    await revalidatePurchase(purchase, actor);
    await purchase.save();
    return res.json({ success: true, data: { validation_flags: purchase.validation_flags, approval_blocked: isApprovalBlocked(purchase.validation_flags) } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to validate timber purchase" });
  }
};

exports.getValidation = async (req, res) => {
  try {
    const purchase = await getPurchaseOrThrow(req.params.id, req.user);
    const allowedManufacturerIds = await getAccessibleManufacturerIds(req.user);
    const matches = await TimberPurchase.find({
      _id: { $in: purchase.validation_flags.flatMap((flag) => flag.matched_purchase_ids || []) },
      manufacturer_vendor_id: { $in: allowedManufacturerIds },
    }).lean();
    return res.json({ success: true, data: { validation_flags: purchase.validation_flags, approval_blocked: isApprovalBlocked(purchase.validation_flags), matched_purchases: await Promise.all(matches.map((match) => serializePurchase(match))) } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to get validation results" });
  }
};

const assertReviewer = (purchase, user) => {
  if (isSameActor(user, purchase.created_by)) throw createHttpError(403, "A submitter cannot review their own timber purchase");
};

exports.approvePurchase = async (req, res) => {
  try {
    const purchase = await getPurchaseOrThrow(req.params.id, req.user);
    if (purchase.verification_status === "APPROVED") return res.json({ success: true, data: await serializePurchase(purchase, { includeDocuments: true }) });
    if (purchase.verification_status !== "SUBMITTED") throw createHttpError(409, "Only submitted purchases can be approved");
    assertReviewer(purchase, req.user);
    const actor = buildActor(req.user);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "document_check")) {
      purchase.document_check = buildDocumentCheck(req.body.document_check, purchase.document_check || {});
    }
    if (req.body?.invoice_quantity_confirmed === true || req.body?.invoice_quantity_confirmed === "true") {
      purchase.document_check.invoice_quantity_confirmed = true;
    }
    if (!purchase.document_check?.invoice_quantity_confirmed) {
      throw createHttpError(400, "Confirm that the original invoice quantity was checked before approval");
    }
    await revalidatePurchase(purchase, actor, { audit: false });
    if (isApprovalBlocked(purchase.validation_flags)) {
      throw createHttpError(409, "Approval is blocked by unresolved duplicate or validation conflicts");
    }
    purchase.verification_status = "APPROVED";
    purchase.reviewer_notes = normalizeText(req.body?.reviewer_notes);
    purchase.reviewed_by = actor;
    purchase.reviewed_at = new Date();
    pushAudit(purchase, "APPROVED", actor, { reviewer_notes: purchase.reviewer_notes });
    await purchase.save();
    return res.json({ success: true, data: await serializePurchase(purchase, { includeDocuments: true }) });
  } catch (error) {
    const status = error.code === 11000 ? 409 : error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.code === 11000 ? "Another purchase was approved with this invoice identity first" : error.message || "Failed to approve timber purchase" });
  }
};

const reviewPurchase = async (req, res, status, action, requiredMessage) => {
  const purchase = await getPurchaseOrThrow(req.params.id, req.user);
  if (purchase.verification_status === status) return purchase;
  if (purchase.verification_status !== "SUBMITTED") throw createHttpError(409, "Only submitted purchases can be reviewed");
  assertReviewer(purchase, req.user);
  const reviewerNotes = normalizeText(req.body?.reviewer_notes);
  if (!reviewerNotes) throw createHttpError(400, requiredMessage);
  const actor = buildActor(req.user);
  purchase.verification_status = status;
  purchase.reviewer_notes = reviewerNotes;
  purchase.reviewed_by = actor;
  purchase.reviewed_at = new Date();
  pushAudit(purchase, action, actor, { reviewer_notes: reviewerNotes });
  await purchase.save();
  return purchase;
};

exports.rejectPurchase = async (req, res) => {
  try {
    const purchase = await reviewPurchase(req, res, "REJECTED", "REJECTED", "A rejection reason is required");
    return res.json({ success: true, data: await serializePurchase(purchase, { includeDocuments: true }) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to reject timber purchase" });
  }
};

exports.requestInformation = async (req, res) => {
  try {
    const purchase = await reviewPurchase(req, res, "NEEDS_INFORMATION", "NEEDS_INFORMATION", "Explain what information is required");
    return res.json({ success: true, data: await serializePurchase(purchase, { includeDocuments: true }) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to request information" });
  }
};

exports.reopenPurchase = async (req, res) => {
  try {
    const purchase = await getPurchaseOrThrow(req.params.id, req.user);
    if (!["APPROVED", "REJECTED"].includes(purchase.verification_status)) throw createHttpError(409, "Only approved or rejected purchases can be reopened");
    const reason = normalizeText(req.body?.reason);
    if (!reason) throw createHttpError(400, "A reopening reason is required");
    const actor = buildActor(req.user);
    purchase.verification_status = "NEEDS_INFORMATION";
    purchase.reviewer_notes = reason;
    pushAudit(purchase, "REOPENED", actor, { reason });
    await purchase.save();
    return res.json({ success: true, data: await serializePurchase(purchase, { includeDocuments: true }) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to reopen timber purchase" });
  }
};

exports.__test__ = {
  activeInvoiceDocuments,
  buildInvoiceIdentity,
  parseDeliveryEntries,
  validateSubmission,
};
