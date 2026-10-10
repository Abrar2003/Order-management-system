const mongoose = require("mongoose");

const TimberInventoryBalance = require("../models/timberInventoryBalance.model");
const TimberInventoryLedger = require("../models/timberInventoryLedger.model");
const {
  consumptionEventKey,
  consumptionReversalEventKey,
  receiptCorrectionEventKey,
  receiptCreditDeltas,
  receiptCreditEventKey,
} = require("../helpers/eudrInventory");

const createHttpError = (statusCode, message, details = undefined) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
};

const transactionUnavailable = (error) =>
  /transaction numbers are only allowed|replica set|transactions are not supported/i.test(String(error?.message || ""));

const runInventoryTransaction = async (callback) => {
  if (mongoose.connection.readyState !== 1) {
    throw createHttpError(503, "Timber inventory requires an available MongoDB transaction connection");
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await callback(session);
    });
    return result;
  } catch (error) {
    if (transactionUnavailable(error)) {
      throw createHttpError(503, "Timber inventory requires MongoDB replica-set transactions; no inventory change was made");
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

const ensureBalance = async ({ manufacturerId, manufacturerSnapshot, session }) =>
  TimberInventoryBalance.findOneAndUpdate(
    { manufacturer_vendor_id: manufacturerId },
    {
      $setOnInsert: {
        manufacturer_vendor_id: manufacturerId,
        manufacturer_snapshot: {
          vendor_id: manufacturerId,
          name: String(manufacturerSnapshot?.name || "").trim() || "Unknown manufacturer",
          country: String(manufacturerSnapshot?.country || "").trim(),
        },
      },
    },
    { new: true, upsert: true, session },
  );

const balanceIncrementFor = (transactionType, signedDeltaUnits) => {
  const increment = { available_units: signedDeltaUnits, version: 1 };
  if (["RECEIPT_CREDIT", "RECEIPT_CORRECTION"].includes(transactionType)) {
    increment.approved_received_units = signedDeltaUnits;
  } else if (transactionType === "CONTAINER_DEBIT") {
    increment.consumed_units = Math.abs(signedDeltaUnits);
  } else if (transactionType === "CONTAINER_REVERSAL") {
    increment.consumed_units = -Math.abs(signedDeltaUnits);
  } else {
    increment.net_adjustment_units = signedDeltaUnits;
  }
  return increment;
};

const applyLedgerMovement = async ({
  manufacturerId,
  manufacturerSnapshot,
  transactionType,
  signedDeltaUnits,
  sourceType,
  sourceId = null,
  sourceEventKey,
  timberPurchaseId = null,
  timberReceiptId = null,
  containerConsumptionId = null,
  remarks = "",
  actor,
  occurredAt = new Date(),
  reversalOfTransactionId = null,
  session,
}) => {
  if (!Number.isSafeInteger(signedDeltaUnits) || signedDeltaUnits === 0) {
    throw createHttpError(400, "Inventory movement must contain a non-zero exact CFT quantity");
  }

  const existing = await TimberInventoryLedger.findOne({ source_event_key: sourceEventKey }).session(session).lean();
  if (existing) return { ledger: existing, idempotent: true };

  const balance = await ensureBalance({ manufacturerId, manufacturerSnapshot, session });
  const balanceQuery = {
    _id: balance._id,
    version: balance.version,
    ...(signedDeltaUnits < 0 ? { available_units: { $gte: Math.abs(signedDeltaUnits) } } : {}),
  };
  const set = {};
  if (["RECEIPT_CREDIT", "RECEIPT_CORRECTION"].includes(transactionType)) set.last_receipt_at = occurredAt;
  if (["CONTAINER_DEBIT", "CONTAINER_REVERSAL"].includes(transactionType)) set.last_consumption_at = occurredAt;

  const updatedBalance = await TimberInventoryBalance.findOneAndUpdate(
    balanceQuery,
    { $inc: balanceIncrementFor(transactionType, signedDeltaUnits), ...(Object.keys(set).length ? { $set: set } : {}) },
    { new: true, session },
  );

  if (!updatedBalance) {
    const available = Number(balance.available_units || 0);
    throw createHttpError(
      409,
      signedDeltaUnits < 0 ? "Insufficient timber inventory" : "Timber inventory changed concurrently; retry the request",
      signedDeltaUnits < 0 ? { available_units: available, requested_units: Math.abs(signedDeltaUnits), shortfall_units: Math.max(0, Math.abs(signedDeltaUnits) - available) } : undefined,
    );
  }

  const [ledger] = await TimberInventoryLedger.create([{
    manufacturer_vendor_id: manufacturerId,
    transaction_type: transactionType,
    quantity_units: Math.abs(signedDeltaUnits),
    signed_delta_units: signedDeltaUnits,
    balance_after_units: updatedBalance.available_units,
    source_type: sourceType,
    source_id: sourceId,
    source_event_key: sourceEventKey,
    timber_purchase_id: timberPurchaseId,
    timber_receipt_id: timberReceiptId,
    container_consumption_id: containerConsumptionId,
    remarks: String(remarks || "").trim(),
    created_by: actor,
    reversal_of_transaction_id: reversalOfTransactionId,
  }], { session });

  return { ledger, balance: updatedBalance, idempotent: false };
};

const syncApprovedPurchaseReceipts = async ({ purchase, actor, session }) => {
  if (purchase?.verification_status !== "APPROVED") return [];
  const manufacturerId = purchase.manufacturer_vendor_id;
  if (!manufacturerId) return [];
  const receiptIds = (purchase.delivery_entries || []).map((entry) => entry?._id).filter(Boolean);
  if (receiptIds.length === 0) return [];

  const priorEntries = await TimberInventoryLedger.find({
    timber_purchase_id: purchase._id,
    timber_receipt_id: { $in: receiptIds },
    transaction_type: { $in: ["RECEIPT_CREDIT", "RECEIPT_CORRECTION"] },
  }).session(session).lean();

  const deltas = receiptCreditDeltas({ deliveryEntries: purchase.delivery_entries, ledgerEntries: priorEntries });
  const posted = [];
  for (const delta of deltas) {
    const isFirstCredit = delta.priorTransactionCount === 0;
    posted.push(await applyLedgerMovement({
      manufacturerId,
      manufacturerSnapshot: purchase.manufacturer_snapshot,
      transactionType: isFirstCredit ? "RECEIPT_CREDIT" : "RECEIPT_CORRECTION",
      signedDeltaUnits: delta.deltaUnits,
      sourceType: "TIMBER_PURCHASE_RECEIPT",
      sourceId: purchase._id,
      sourceEventKey: isFirstCredit
        ? receiptCreditEventKey(purchase._id, delta.receiptId)
        : receiptCorrectionEventKey(purchase._id, delta.receiptId, delta.priorTransactionCount),
      timberPurchaseId: purchase._id,
      timberReceiptId: delta.receiptId,
      remarks: isFirstCredit ? "Approved received timber credit" : "Approved receipt quantity correction",
      actor,
      occurredAt: delta.receipt.delivery_date || purchase.reviewed_at || new Date(),
      session,
    }));
  }
  return posted;
};

const confirmConsumption = async ({ consumption, actor, session }) => {
  if (consumption.status === "CONFIRMED") return { consumption, idempotent: true };
  if (consumption.status !== "DRAFT") throw createHttpError(409, "Only draft consumption can be confirmed");

  const posted = await applyLedgerMovement({
    manufacturerId: consumption.manufacturer_vendor_id,
    manufacturerSnapshot: consumption.manufacturer_snapshot,
    transactionType: "CONTAINER_DEBIT",
    signedDeltaUnits: -Number(consumption.reported_cft_units),
    sourceType: "TIMBER_CONTAINER_CONSUMPTION",
    sourceId: consumption._id,
    sourceEventKey: consumptionEventKey(consumption._id),
    containerConsumptionId: consumption._id,
    remarks: consumption.remarks,
    actor,
    occurredAt: consumption.stuffing_date || new Date(),
    session,
  });

  consumption.status = "CONFIRMED";
  consumption.confirmed_cft_units = consumption.reported_cft_units;
  consumption.confirmed_by = actor;
  consumption.confirmed_at = new Date();
  await consumption.save({ session });
  return { consumption, posted, idempotent: false };
};

const reverseConsumption = async ({ consumption, actor, reason, session }) => {
  if (consumption.status === "REVERSED") return { consumption, idempotent: true };
  if (consumption.status !== "CONFIRMED") throw createHttpError(409, "Only confirmed consumption can be reversed");

  const debit = await TimberInventoryLedger.findOne({
    source_event_key: consumptionEventKey(consumption._id),
  }).session(session).lean();
  if (!debit) throw createHttpError(409, "The original consumption ledger entry is missing and requires reconciliation");

  const posted = await applyLedgerMovement({
    manufacturerId: consumption.manufacturer_vendor_id,
    manufacturerSnapshot: consumption.manufacturer_snapshot,
    transactionType: "CONTAINER_REVERSAL",
    signedDeltaUnits: Number(consumption.confirmed_cft_units),
    sourceType: "TIMBER_CONTAINER_CONSUMPTION_REVERSAL",
    sourceId: consumption._id,
    sourceEventKey: consumptionReversalEventKey(consumption._id),
    containerConsumptionId: consumption._id,
    remarks: reason,
    actor,
    occurredAt: new Date(),
    reversalOfTransactionId: debit._id,
    session,
  });

  consumption.status = "REVERSED";
  consumption.reversed_by = actor;
  consumption.reversed_at = new Date();
  consumption.reversal_reason = reason;
  await consumption.save({ session });
  return { consumption, posted, idempotent: false };
};

module.exports = {
  applyLedgerMovement,
  confirmConsumption,
  createHttpError,
  reverseConsumption,
  runInventoryTransaction,
  syncApprovedPurchaseReceipts,
};
