const normalizeText = (value) => String(value ?? "").trim();

const parseTenureDate = (value, label) => {
  const date = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${label} must be a valid date`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`${label} must be a valid date`);
  }
  return parsed;
};

const parseQuantity = (value, label, { allowZero = false } = {}) => {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 0 || (!allowZero && quantity === 0)) {
    throw new Error(`${label} must be a ${allowZero ? "non-negative" : "positive"} whole number`);
  }
  return quantity;
};

const normalizeClaimTenures = (value = []) => {
  if (!Array.isArray(value)) {
    throw new Error("claim_tenures must be an array");
  }

  const tenures = value.map((entry, index) => {
    const label = `Claim tenure ${index + 1}`;
    const fromDate = parseTenureDate(entry?.from_date, `${label} from date`);
    const toDate = parseTenureDate(entry?.to_date, `${label} to date`);
    if (toDate < fromDate) {
      throw new Error(`${label} to date cannot be before from date`);
    }

    const deliveredQuantity = parseQuantity(
      entry?.delivered_quantity,
      `${label} delivered quantity`,
    );
    const rejectedQuantity = parseQuantity(
      entry?.rejected_quantity,
      `${label} rejected quantity`,
      { allowZero: true },
    );
    if (rejectedQuantity > deliveredQuantity) {
      throw new Error(`${label} rejected quantity cannot exceed delivered quantity`);
    }

    return {
      from_date: fromDate,
      to_date: toDate,
      delivered_quantity: deliveredQuantity,
      rejected_quantity: rejectedQuantity,
    };
  });

  const chronological = [...tenures].sort((left, right) => left.from_date - right.from_date);
  chronological.slice(1).forEach((tenure, index) => {
    if (tenure.from_date <= chronological[index].to_date) {
      throw new Error("Claim tenure date ranges cannot overlap");
    }
  });

  const totals = tenures.reduce(
    (summary, tenure) => ({
      delivered_quantity: summary.delivered_quantity + tenure.delivered_quantity,
      rejected_quantity: summary.rejected_quantity + tenure.rejected_quantity,
    }),
    { delivered_quantity: 0, rejected_quantity: 0 },
  );

  return {
    tenures,
    ...totals,
    claim_percentage:
      totals.delivered_quantity > 0
        ? Number(((totals.rejected_quantity / totals.delivered_quantity) * 100).toFixed(2))
        : 0,
  };
};

module.exports = {
  normalizeClaimTenures,
};
