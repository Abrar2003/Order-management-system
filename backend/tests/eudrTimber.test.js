const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const TimberSupplier = require("../models/timberSupplier.model");
const TimberPurchase = require("../models/timberPurchase.model");
const controller = require("../controllers/eudr.controller");
const {
  buildInvoiceIdentity,
  hasValidFileSignature,
  isApprovalBlocked,
  isSameActor,
  isValidGstin,
  normalizeFinancialYear,
  normalizeGstin,
  normalizeInvoiceNumber,
  parseCftToMilli,
  sha256,
  validateDeliveryQuantities,
} = require("../helpers/eudrTimber");

const submittedPurchase = (overrides = {}) => ({
  manufacturer_vendor_id: "507f1f77bcf86cd799439011",
  timber_supplier_id: "507f1f77bcf86cd799439012",
  invoice_number: "RTT/2026/101",
  normalized_invoice_number: "RTT/2026/101",
  financial_year: "2026-27",
  invoice_date: new Date("2026-05-01"),
  purchased_cft_milli: 100000,
  delivery_entries: [],
  documents: [{ category: "TIMBER_PURCHASE_INVOICE", storage_key: "test.pdf" }],
  ...overrides,
});

test("purchase validation calculates received timber without a callback", async () => {
  const purchase = new TimberPurchase({
    purchase_number: "TP-VALIDATION-HOOK",
    purchased_cft_milli: 100000,
    delivery_entries: [{ received_cft_milli: 100000 }],
  });

  await purchase.validate();
  assert.equal(purchase.received_cft_milli, 100000);
});

test("normalizes and validates a GSTIN before supplier comparison", () => {
  assert.equal(normalizeGstin(" 08aabct1332l1zv "), "08AABCT1332L1ZV");
  assert.equal(isValidGstin("08AABCT1332L1ZV"), true);
  assert.equal(isValidGstin("invalid"), false);
});

test("supplier schema safeguards duplicate GSTINs and active identities", () => {
  const indexes = TimberSupplier.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => fields.normalized_gstin === 1 && options.unique));
  assert.ok(indexes.some(([fields, options]) => fields.normalized_name === 1 && fields.country === 1 && options.unique));
});

test("draft validation does not require an invoice until submission", () => {
  assert.equal(controller.__test__.validateSubmission({}), "Furniture manufacturer is required");
});

test("submission requires an attached original invoice", () => {
  assert.equal(
    controller.__test__.validateSubmission(submittedPurchase({ documents: [] })),
    "Upload an active Timber Purchase Invoice before submission",
  );
});

test("allows only PDF, JPEG, and PNG file signatures", () => {
  assert.equal(hasValidFileSignature(Buffer.from("%PDF-1.7"), "application/pdf"), true);
  assert.equal(hasValidFileSignature(Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg"), true);
  assert.equal(hasValidFileSignature(Buffer.from("not a PDF"), "application/pdf"), false);
});

test("detects identical documents regardless of their filenames", () => {
  const file = Buffer.from("same invoice bytes");
  assert.equal(sha256(file), sha256(Buffer.from("same invoice bytes")));
});

test("invoice identity is global and does not include the manufacturer", () => {
  const first = buildInvoiceIdentity({ supplierId: "supplier", invoiceNumber: " RTT/101 ", financialYear: "2026-27" });
  const second = buildInvoiceIdentity({ supplierId: "supplier", invoiceNumber: "RTT/101", financialYear: "2026-27" });
  assert.equal(first, second);
});

test("invoice normalization preserves meaningful punctuation", () => {
  assert.notEqual(normalizeInvoiceNumber("RTT/101"), normalizeInvoiceNumber("RTT-101"));
  assert.equal(normalizeInvoiceNumber(" rtt / 101 "), "RTT/101");
});

test("financial year defaults from the invoice date using the Indian April boundary", () => {
  assert.equal(normalizeFinancialYear("", "2026-03-31"), "2025-26");
  assert.equal(normalizeFinancialYear("", "2026-04-01"), "2026-27");
});

test("CFT uses thousandths rather than floating point equality", () => {
  assert.equal(parseCftToMilli("100.125"), 100125);
  assert.throws(() => parseCftToMilli("1.1234"));
});

test("multiple legitimate deliveries may equal but never exceed the invoice quantity", () => {
  assert.equal(validateDeliveryQuantities({ purchasedMilliCft: 100000, deliveryEntries: [{ received_cft_milli: 40000 }, { received_cft_milli: 60000 }] }), "");
  assert.equal(validateDeliveryQuantities({ purchasedMilliCft: 100000, deliveryEntries: [{ received_cft_milli: 40000 }, { received_cft_milli: 70000 }] }), "Received CFT cannot exceed purchased CFT");
});

test("an edited approved receipt keeps its stable delivery-entry identity", () => {
  const receiptId = new mongoose.Types.ObjectId();
  const actor = { user: new mongoose.Types.ObjectId(), name: "Reviewer" };
  const existing = [{ _id: receiptId, received_cft_milli: 70000, created_by: actor, created_at: new Date("2026-01-01") }];
  const entries = controller.__test__.parseDeliveryEntries([{ _id: String(receiptId), received_cft: "50" }], actor, existing);
  assert.equal(String(entries[0]._id), String(receiptId));
  assert.equal(entries[0].received_cft_milli, 50000);
  assert.throws(() => controller.__test__.parseDeliveryEntries([{ _id: String(new mongoose.Types.ObjectId()), received_cft: "50" }], actor, existing));
});

test("hard validation flags block approval while warnings do not", () => {
  assert.equal(isApprovalBlocked([{ severity: "WARNING", state: "OPEN" }]), false);
  assert.equal(isApprovalBlocked([{ severity: "HARD", state: "OPEN" }]), true);
  assert.equal(isApprovalBlocked([{ severity: "HARD", state: "RESOLVED" }]), false);
});

test("maker-checker comparison rejects the submitting actor", () => {
  assert.equal(isSameActor({ _id: "user-1" }, { user: "user-1" }), true);
  assert.equal(isSameActor({ _id: "user-2" }, { user: "user-1" }), false);
});

test("approved invoice identity has a database uniqueness safeguard", () => {
  const indexes = TimberPurchase.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => (
    fields.timber_supplier_id === 1
    && fields.normalized_invoice_number === 1
    && fields.financial_year === 1
    && options.unique
    && options.partialFilterExpression?.verification_status === "APPROVED"
  )));
});

test("Phase 1 purchase model does not create inventory or container fields", () => {
  const paths = TimberPurchase.schema.paths;
  assert.equal(Boolean(paths.stock_ledger), false);
  assert.equal(Boolean(paths.container_consumption), false);
});
