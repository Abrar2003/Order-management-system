const formatNumber = (value, decimals = 2) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "-";
  return parsed.toFixed(decimals).replace(/\.?0+$/, "");
};

const formatRemark = (entry = {}, fallback = "Entry") => {
  const raw = String(entry?.remark || entry?.box_type || entry?.type || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "base") return "Base";
  if (raw === "top") return "Top";
  if (raw === "inner") return "Inner Carton";
  if (raw === "master") return "Master Carton";
  return raw.replace(/([a-z]+)(\d+)/i, (_, prefix, number) =>
    `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)} ${number}`,
  );
};

const getEntryWeight = (entry = {}, weightKey = "") => {
  if (weightKey && entry?.[weightKey] !== undefined) return entry[weightKey];
  return entry?.weight;
};

const hasEntryValue = (entry = {}, weightKey = "") => {
  const hasSize =
    Number(entry?.L || 0) > 0 ||
    Number(entry?.B || 0) > 0 ||
    Number(entry?.H || 0) > 0;
  const hasWeight = Number(getEntryWeight(entry, weightKey) || 0) > 0;
  return hasSize || hasWeight || Boolean(String(entry?.remark || "").trim());
};

const normalizeEntries = (entries = [], weightKey = "") =>
  (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === "object")
    .filter((entry) => hasEntryValue(entry, weightKey));

const MeasuredSizeDisplayTable = ({
  entries = [],
  weightKey = "",
  emptyLabel = "No sizes saved",
}) => {
  const normalizedEntries = normalizeEntries(entries, weightKey);
  if (normalizedEntries.length === 0) {
    return <span className="text-secondary">{emptyLabel}</span>;
  }

  return (
    <div className="table-responsive">
      <table className="table table-sm align-middle mb-0 om-size-data-table">
        <thead>
          <tr>
            <th>Part</th>
            <th>L x B x H</th>
            <th>Weight</th>
          </tr>
        </thead>
        <tbody>
          {normalizedEntries.map((entry, index) => (
            <tr key={`${entry?.remark || entry?.box_type || "entry"}-${index}`}>
              <td>{formatRemark(entry, `Entry ${index + 1}`)}</td>
              <td>
                {formatNumber(entry?.L)} x {formatNumber(entry?.B)} x {formatNumber(entry?.H)}
              </td>
              <td>{formatNumber(getEntryWeight(entry, weightKey), 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default MeasuredSizeDisplayTable;
