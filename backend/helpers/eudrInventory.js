const { formatMilliCft, normalizeText, parseCftToMilli } = require("./eudrTimber");

const normalizeContainerNumber = (value = "") =>
  normalizeText(value).toUpperCase().replace(/\s+/g, "");

const shipmentRefKey = (orderId, shipmentId) =>
  `${String(orderId || "").trim()}:${String(shipmentId || "").trim()}`;

const consumptionGroupKey = (manufacturerId, containerNumber, stuffingDate = null) =>
  [String(manufacturerId || "").trim(), normalizeContainerNumber(containerNumber), stuffingDate ? new Date(stuffingDate).toISOString().slice(0, 10) : ""].join(":");

const parseShipmentRefKey = (value = "") => {
  const [orderId = "", shipmentId = "", ...rest] = String(value || "").split(":");
  return rest.length === 0 && orderId && shipmentId ? { orderId, shipmentId } : null;
};

const receiptCreditEventKey = (purchaseId, receiptId) =>
  `receipt-credit:${String(purchaseId)}:${String(receiptId)}`;

const receiptCorrectionEventKey = (purchaseId, receiptId, sequence) =>
  `receipt-correction:${String(purchaseId)}:${String(receiptId)}:${Number(sequence)}`;

const consumptionEventKey = (consumptionId) => `container-consumption:${String(consumptionId)}`;
const consumptionReversalEventKey = (consumptionId) => `container-reversal:${String(consumptionId)}`;

const sumUnits = (values = []) =>
  (Array.isArray(values) ? values : []).reduce((total, value) => {
    const numeric = Number(value || 0);
    if (!Number.isSafeInteger(numeric) || !Number.isSafeInteger(total + numeric)) {
      throw new Error("Inventory quantity is outside the supported range");
    }
    return total + numeric;
  }, 0);

const receiptCreditDeltas = ({ deliveryEntries = [], ledgerEntries = [] } = {}) => {
  const creditedByReceipt = new Map();
  const transactionCountByReceipt = new Map();

  for (const entry of Array.isArray(ledgerEntries) ? ledgerEntries : []) {
    const receiptId = String(entry?.timber_receipt_id || "");
    if (!receiptId) continue;
    creditedByReceipt.set(
      receiptId,
      sumUnits([creditedByReceipt.get(receiptId) || 0, Number(entry?.signed_delta_units || 0)]),
    );
    transactionCountByReceipt.set(receiptId, (transactionCountByReceipt.get(receiptId) || 0) + 1);
  }

  return (Array.isArray(deliveryEntries) ? deliveryEntries : [])
    .map((receipt) => {
      const receiptId = String(receipt?._id || "");
      const receivedUnits = Number(receipt?.received_cft_milli || 0);
      if (!receiptId || !Number.isSafeInteger(receivedUnits) || receivedUnits <= 0) return null;
      const creditedUnits = creditedByReceipt.get(receiptId) || 0;
      const deltaUnits = receivedUnits - creditedUnits;
      if (deltaUnits === 0) return null;
      return {
        receipt,
        receiptId,
        deltaUnits,
        priorTransactionCount: transactionCountByReceipt.get(receiptId) || 0,
      };
    })
    .filter(Boolean);
};

const buildBalanceTotals = (ledgerEntries = []) =>
  (Array.isArray(ledgerEntries) ? ledgerEntries : []).reduce(
    (totals, entry) => {
      const delta = Number(entry?.signed_delta_units || 0);
      if (!Number.isSafeInteger(delta)) throw new Error("Invalid ledger quantity");
      totals.available_units += delta;
      if (["RECEIPT_CREDIT", "RECEIPT_CORRECTION"].includes(entry?.transaction_type)) {
        totals.approved_received_units += delta;
      } else if (entry?.transaction_type === "CONTAINER_DEBIT") {
        totals.consumed_units += Math.abs(delta);
      } else if (entry?.transaction_type === "CONTAINER_REVERSAL") {
        totals.consumed_units -= Math.abs(delta);
      } else {
        totals.net_adjustment_units += delta;
      }
      return totals;
    },
    { approved_received_units: 0, consumed_units: 0, net_adjustment_units: 0, available_units: 0 },
  );

const toCft = (units) => formatMilliCft(units);

module.exports = {
  buildBalanceTotals,
  consumptionGroupKey,
  consumptionEventKey,
  consumptionReversalEventKey,
  normalizeContainerNumber,
  parseCftToMilli,
  parseShipmentRefKey,
  receiptCorrectionEventKey,
  receiptCreditDeltas,
  receiptCreditEventKey,
  shipmentRefKey,
  sumUnits,
  toCft,
};
