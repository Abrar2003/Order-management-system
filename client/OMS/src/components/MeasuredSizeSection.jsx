import {
  BOX_ENTRY_TYPES,
  BOX_PACKAGING_MODES,
  SIZE_ENTRY_LIMIT,
  getRemarkLabel,
  normalizeSizeCount,
} from "../utils/measuredSizeForm";

const SIZE_COUNT_OPTIONS = Array.from({ length: SIZE_ENTRY_LIMIT }, (_, index) =>
  String(index + 1),
);

const MeasuredSizeSection = ({
  sectionKey,
  title,
  countLabel,
  countValue,
  entries,
  remarkOptions,
  weightLabel,
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
  showModeSelector = false,
  onModeChange,
  disabled = false,
  onCountChange,
  onEntryChange,
}) => {
  const isCartonMode = mode === BOX_PACKAGING_MODES.CARTON;
  const safeCount = isCartonMode ? 2 : normalizeSizeCount(countValue, 1);
  const entryColumnClass = safeCount > 1 ? "col-md-2" : "col-md-3";

  return (
    <>
      <div className="col-md-2">
        {showModeSelector ? (
          <>
            <label className="form-label">Packaging Mode</label>
            <select
              className="form-select"
              value={mode}
              onChange={(event) => onModeChange?.(event.target.value)}
              disabled={disabled}
            >
              <option value={BOX_PACKAGING_MODES.INDIVIDUAL}>Individual Boxes</option>
              <option value={BOX_PACKAGING_MODES.CARTON}>Inner + Master Carton</option>
            </select>
            <label className="form-label mt-3">{countLabel}</label>
            {isCartonMode ? (
              <input type="text" className="form-control" value="2" disabled readOnly />
            ) : (
              <select
                className="form-select"
                value={String(safeCount)}
                onChange={(event) => onCountChange?.(event.target.value)}
                disabled={disabled}
              >
                {SIZE_COUNT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </>
        ) : (
          <>
            <label className="form-label">{countLabel}</label>
            <select
              className="form-select"
              value={String(safeCount)}
              onChange={(event) => onCountChange?.(event.target.value)}
              disabled={disabled}
            >
              {SIZE_COUNT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <div className="col-md-10">
        <label className="form-label">{title}</label>
        <div className="d-grid gap-2">
          {entries.slice(0, safeCount).map((entry, index) => (
            <div key={`${sectionKey}-${index}`} className="border rounded p-3">
              <div className="small text-secondary mb-2">
                {isCartonMode
                  ? index === 0
                    ? "Inner carton"
                    : "Master carton"
                  : safeCount === 1
                  ? "Single entry"
                  : `Entry ${index + 1}${entry.remark ? ` | ${getRemarkLabel(remarkOptions, entry.remark)}` : ""}`}
              </div>
              <div className="row g-2">
                {safeCount > 1 && (
                  <div className="col-md-3">
                    <label className="form-label small text-secondary">Remark</label>
                    {isCartonMode ? (
                      <input
                        type="text"
                        className="form-control"
                        value={getRemarkLabel(
                          remarkOptions,
                          index === 0 ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER,
                        )}
                        disabled
                        readOnly
                      />
                    ) : (
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
                    )}
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
                {isCartonMode && index === 0 && (
                  <div className="col-md-3">
                    <label className="form-label small text-secondary">Item Count In Inner</label>
                    <input
                      type="number"
                      className="form-control"
                      value={entry.item_count_in_inner}
                      onChange={(event) =>
                        onEntryChange?.(index, "item_count_in_inner", event.target.value)
                      }
                      min="0"
                      step="1"
                      disabled={disabled}
                    />
                  </div>
                )}
                {isCartonMode && index === 1 && (
                  <div className="col-md-3">
                    <label className="form-label small text-secondary">Box Count In Master</label>
                    <input
                      type="number"
                      className="form-control"
                      value={entry.box_count_in_master}
                      onChange={(event) =>
                        onEntryChange?.(index, "box_count_in_master", event.target.value)
                      }
                      min="0"
                      step="1"
                      disabled={disabled}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {safeCount === 1 && !isCartonMode && (
          <div className="small text-secondary mt-2">
            Single-entry measurements do not use remarks.
          </div>
        )}
        {isCartonMode && (
          <div className="small text-secondary mt-2">
            Master carton CBM is treated as the final effective box CBM.
          </div>
        )}
      </div>
    </>
  );
};

export default MeasuredSizeSection;
