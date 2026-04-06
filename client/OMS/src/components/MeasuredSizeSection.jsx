import {
  getRemarkLabel,
  normalizeSizeCount,
} from "../utils/measuredSizeForm";

const MeasuredSizeSection = ({
  sectionKey,
  title,
  countLabel,
  countValue,
  entries,
  remarkOptions,
  weightLabel,
  disabled = false,
  onCountChange,
  onEntryChange,
}) => {
  const safeCount = normalizeSizeCount(countValue, 1);
  const entryColumnClass = safeCount > 1 ? "col-md-2" : "col-md-3";

  return (
    <>
      <div className="col-md-2">
        <label className="form-label">{countLabel}</label>
        <select
          className="form-select"
          value={String(safeCount)}
          onChange={(event) => onCountChange?.(event.target.value)}
          disabled={disabled}
        >
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
        </select>
      </div>
      <div className="col-md-10">
        <label className="form-label">{title}</label>
        <div className="d-grid gap-2">
          {entries.slice(0, safeCount).map((entry, index) => (
            <div key={`${sectionKey}-${index}`} className="border rounded p-3">
              <div className="small text-secondary mb-2">
                {safeCount === 1
                  ? "Single entry"
                  : `Entry ${index + 1}${entry.remark ? ` | ${getRemarkLabel(remarkOptions, entry.remark)}` : ""}`}
              </div>
              <div className="row g-2">
                {safeCount > 1 && (
                  <div className="col-md-3">
                    <label className="form-label small text-secondary">Remark</label>
                    <select
                      className="form-select"
                      value={entry.remark}
                      onChange={(event) => onEntryChange?.(index, "remark", event.target.value)}
                      disabled={disabled}
                    >
                      <option value="">Select remark</option>
                      {remarkOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className={entryColumnClass}>
                  <label className="form-label small text-secondary">L</label>
                  <input
                    type="number"
                    className="form-control"
                    value={entry.L}
                    onChange={(event) => onEntryChange?.(index, "L", event.target.value)}
                    min="0"
                    step="any"
                    disabled={disabled}
                  />
                </div>
                <div className={entryColumnClass}>
                  <label className="form-label small text-secondary">B</label>
                  <input
                    type="number"
                    className="form-control"
                    value={entry.B}
                    onChange={(event) => onEntryChange?.(index, "B", event.target.value)}
                    min="0"
                    step="any"
                    disabled={disabled}
                  />
                </div>
                <div className={entryColumnClass}>
                  <label className="form-label small text-secondary">H</label>
                  <input
                    type="number"
                    className="form-control"
                    value={entry.H}
                    onChange={(event) => onEntryChange?.(index, "H", event.target.value)}
                    min="0"
                    step="any"
                    disabled={disabled}
                  />
                </div>
                <div className="col-md-3">
                  <label className="form-label small text-secondary">{weightLabel}</label>
                  <input
                    type="number"
                    className="form-control"
                    value={entry.weight}
                    onChange={(event) => onEntryChange?.(index, "weight", event.target.value)}
                    min="0"
                    step="any"
                    disabled={disabled}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        {safeCount === 1 && (
          <div className="small text-secondary mt-2">
            Single-entry measurements do not use remarks.
          </div>
        )}
      </div>
    </>
  );
};

export default MeasuredSizeSection;
