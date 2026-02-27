import { useEffect, useMemo, useRef, useState } from "react";
import api from "../api/axios";
import { createManualOrders, uploadOrders } from "../services/orders.service";
import "../App.css";

const createEmptyManualRow = (id) => ({
  id,
  order_id: "",
  item_code: "",
  description: "",
  brand: "",
  vendor: "",
  quantity: "",
  ETD: "",
  order_date: "",
});

const toTrimmedString = (value) => String(value ?? "").trim();

const normalizeCodeKey = (value) => toTrimmedString(value).toLowerCase();

const sortUniqueStrings = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map((value) => toTrimmedString(value)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

const getItemMasterDescription = (itemDoc = {}) =>
  toTrimmedString(itemDoc?.description || itemDoc?.name || "");

const buildItemMeta = ({ itemCode = "", existingDescription = "" } = {}) => {
  const normalizedCode = toTrimmedString(itemCode);
  const normalizedDescription = toTrimmedString(existingDescription);

  return {
    hasExistingDescription: Boolean(normalizedDescription),
    requiresDescription: Boolean(normalizedCode) && !normalizedDescription,
    autoDescription: normalizedDescription,
  };
};

const UploadOrdersModal = ({ onClose, onSuccess }) => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingReferenceData, setLoadingReferenceData] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("upload");
  const [nextRowId, setNextRowId] = useState(2);
  const [manualRows, setManualRows] = useState([createEmptyManualRow(1)]);
  const [brandOptions, setBrandOptions] = useState([]);
  const [vendorOptions, setVendorOptions] = useState([]);
  const [itemCodeOptions, setItemCodeOptions] = useState([]);
  const [itemMetaByRow, setItemMetaByRow] = useState({});
  const itemLookupCacheRef = useRef(new Map());

  const mergedBrandOptions = useMemo(
    () => sortUniqueStrings([...brandOptions, ...manualRows.map((row) => row?.brand)]),
    [brandOptions, manualRows],
  );
  const mergedVendorOptions = useMemo(
    () => sortUniqueStrings([...vendorOptions, ...manualRows.map((row) => row?.vendor)]),
    [manualRows, vendorOptions],
  );
  const mergedItemCodeOptions = useMemo(
    () => sortUniqueStrings([...itemCodeOptions, ...manualRows.map((row) => row?.item_code)]),
    [itemCodeOptions, manualRows],
  );

  useEffect(() => {
    if (mode !== "manual") return;

    let cancelled = false;

    const fetchManualReferenceData = async () => {
      try {
        setLoadingReferenceData(true);

        const [brandsRes, orderFiltersRes, itemsRes] = await Promise.all([
          api.get("/brands/"),
          api.get("/orders/filters", {
            params: {
              page: 1,
              limit: 1,
            },
          }),
          api.get("/items", {
            params: {
              page: 1,
              limit: 1,
            },
          }),
        ]);

        if (cancelled) return;

        const nextBrandOptions = sortUniqueStrings([
          ...(Array.isArray(brandsRes?.data?.data)
            ? brandsRes.data.data.map((brandDoc) => brandDoc?.name)
            : []),
          ...(Array.isArray(orderFiltersRes?.data?.filters?.brands)
            ? orderFiltersRes.data.filters.brands
            : []),
        ]);

        const nextVendorOptions = sortUniqueStrings([
          ...(Array.isArray(orderFiltersRes?.data?.filters?.vendors)
            ? orderFiltersRes.data.filters.vendors
            : []),
          ...(Array.isArray(itemsRes?.data?.filters?.vendors)
            ? itemsRes.data.filters.vendors
            : []),
        ]);

        const nextItemCodeOptions = sortUniqueStrings(
          Array.isArray(itemsRes?.data?.filters?.item_codes)
            ? itemsRes.data.filters.item_codes
            : [],
        );

        setBrandOptions(nextBrandOptions);
        setVendorOptions(nextVendorOptions);
        setItemCodeOptions(nextItemCodeOptions);
      } catch (referenceError) {
        console.error("Failed to fetch manual order reference data:", referenceError);
      } finally {
        if (!cancelled) {
          setLoadingReferenceData(false);
        }
      }
    };

    fetchManualReferenceData();

    return () => {
      cancelled = true;
    };
  }, [mode]);

  const handleUpload = async () => {
    if (!file) {
      setError("Please select an Excel file");
      return;
    }

    try {
      setLoading(true);
      setError("");
      await uploadOrders(file);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleManualRowChange = (rowId, field, value) => {
    setManualRows((prevRows) =>
      prevRows.map((row) =>
        row.id !== rowId
          ? row
          : (() => {
            if (field !== "item_code") {
              return {
                ...row,
                [field]: value,
              };
            }

            const previousMeta = itemMetaByRow[rowId] || buildItemMeta({ itemCode: row.item_code });
            const previousAutoDescription = toTrimmedString(previousMeta?.autoDescription);
            const currentDescription = toTrimmedString(row.description);
            const shouldClearDescription =
              Boolean(previousAutoDescription) && currentDescription === previousAutoDescription;

            return {
              ...row,
              item_code: value,
              description: shouldClearDescription ? "" : row.description,
            };
          })(),
      ),
    );

    if (field === "item_code") {
      setItemMetaByRow((prev) => ({
        ...prev,
        [rowId]: buildItemMeta({ itemCode: value }),
      }));
    }
  };

  const addManualRow = () => {
    setManualRows((prevRows) => [...prevRows, createEmptyManualRow(nextRowId)]);
    setNextRowId((prev) => prev + 1);
  };

  const removeManualRow = (rowId) => {
    setManualRows((prevRows) => {
      if (prevRows.length === 1) return prevRows;
      return prevRows.filter((row) => row.id !== rowId);
    });

    setItemMetaByRow((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, rowId)) return prev;
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  };

  const lookupItemByCode = async (itemCodeInput) => {
    const normalizedItemCode = toTrimmedString(itemCodeInput);
    const itemCodeKey = normalizeCodeKey(normalizedItemCode);
    if (!normalizedItemCode) return null;

    if (itemLookupCacheRef.current.has(itemCodeKey)) {
      return itemLookupCacheRef.current.get(itemCodeKey);
    }

    const response = await api.get("/items", {
      params: {
        search: normalizedItemCode,
        page: 1,
        limit: 50,
      },
    });

    const items = Array.isArray(response?.data?.data) ? response.data.data : [];
    const exactMatch =
      items.find((itemDoc) => normalizeCodeKey(itemDoc?.code) === itemCodeKey) || null;

    const resolvedItem = exactMatch
      ? {
        code: toTrimmedString(exactMatch.code),
        description: getItemMasterDescription(exactMatch),
      }
      : null;

    itemLookupCacheRef.current.set(itemCodeKey, resolvedItem);
    return resolvedItem;
  };

  const resolveRowsWithItemDescriptions = async (rowsInput = []) => {
    const sourceRows = Array.isArray(rowsInput) ? rowsInput : [];
    const resolvedEntries = await Promise.all(
      sourceRows.map(async (row) => {
        const itemCode = toTrimmedString(row?.item_code);
        if (!itemCode) {
          return {
            row: {
              ...row,
              item_code: "",
              description: toTrimmedString(row?.description),
            },
            meta: buildItemMeta({ itemCode: "" }),
          };
        }

        let existingDescription = "";
        try {
          const matchedItem = await lookupItemByCode(itemCode);
          existingDescription = toTrimmedString(matchedItem?.description);
        } catch (lookupError) {
          console.error("Item lookup failed:", lookupError);
        }

        const fallbackDescription = toTrimmedString(row?.description);

        return {
          row: {
            ...row,
            item_code: itemCode,
            description: existingDescription || fallbackDescription,
          },
          meta: buildItemMeta({
            itemCode,
            existingDescription,
          }),
        };
      }),
    );

    const nextMetaByRow = {};
    for (let i = 0; i < resolvedEntries.length; i += 1) {
      const entry = resolvedEntries[i];
      if (entry?.row?.id === undefined || entry?.row?.id === null) continue;
      nextMetaByRow[entry.row.id] = entry.meta;
    }

    return {
      rows: resolvedEntries.map((entry) => entry.row),
      metaByRow: nextMetaByRow,
    };
  };

  const handleManualItemCodeBlur = async (rowId) => {
    const targetRow = manualRows.find((row) => row.id === rowId);
    if (!targetRow) return;

    const sourceCodeKey = normalizeCodeKey(targetRow.item_code);
    if (!sourceCodeKey) {
      setItemMetaByRow((prev) => ({
        ...prev,
        [rowId]: buildItemMeta({ itemCode: "" }),
      }));
      return;
    }

    const { rows: resolvedRows, metaByRow } = await resolveRowsWithItemDescriptions([targetRow]);
    const resolvedRow = resolvedRows[0] || targetRow;
    const resolvedMeta = metaByRow[rowId] || buildItemMeta({ itemCode: targetRow.item_code });

    setManualRows((prevRows) =>
      prevRows.map((row) => {
        if (row.id !== rowId) return row;
        if (normalizeCodeKey(row.item_code) !== sourceCodeKey) return row;
        return {
          ...row,
          item_code: resolvedRow.item_code,
          description: resolvedRow.description,
        };
      }),
    );

    setItemMetaByRow((prev) => ({
      ...prev,
      [rowId]: resolvedMeta,
    }));
  };

  const getManualPayloadRows = (rowsInput = manualRows) =>
    (Array.isArray(rowsInput) ? rowsInput : [])
      .map((row) => ({
        order_id: toTrimmedString(row.order_id),
        item_code: toTrimmedString(row.item_code),
        description: toTrimmedString(row.description),
        brand: toTrimmedString(row.brand),
        vendor: toTrimmedString(row.vendor),
        quantity: row.quantity === "" ? null : Number(row.quantity),
        ETD: toTrimmedString(row.ETD),
        order_date: toTrimmedString(row.order_date),
      }))
      .filter((row) =>
        Object.values(row).some((value) => {
          if (value === null || value === undefined) return false;
          if (typeof value === "number") return Number.isFinite(value) && value !== 0;
          return String(value).trim() !== "";
        }),
      )
      .map((row) => ({
        ...row,
        ETD: row.ETD || undefined,
        order_date: row.order_date || undefined,
      }));

  const handleManualAdd = async () => {
    const { rows: resolvedRows, metaByRow } =
      await resolveRowsWithItemDescriptions(manualRows);
    setManualRows(resolvedRows);
    setItemMetaByRow((prev) => ({
      ...prev,
      ...metaByRow,
    }));

    const payloadRows = getManualPayloadRows(resolvedRows);

    if (payloadRows.length === 0) {
      setError("Please add at least one order row.");
      return;
    }

    const hasInvalidRequiredValues = payloadRows.some(
      (row) =>
        !row.order_id
        || !row.item_code
        || !row.description
        || !row.brand
        || !row.vendor
        || !Number.isFinite(Number(row.quantity))
        || Number(row.quantity) <= 0,
    );
    if (hasInvalidRequiredValues) {
      setError(
        "Each row must include PO, item code, description, brand, vendor, and quantity > 0.",
      );
      return;
    }

    try {
      setLoading(true);
      setError("");
      await createManualOrders(payloadRows);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || "Manual add failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    if (mode === "manual") {
      handleManualAdd();
      return;
    }
    handleUpload();
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Upload Orders</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="btn-group w-100" role="group" aria-label="Upload mode">
              <button
                type="button"
                className={`btn ${mode === "upload" ? "btn-primary" : "btn-outline-primary"}`}
                onClick={() => {
                  setMode("upload");
                  setError("");
                }}
              >
                Upload Excel
              </button>
              <button
                type="button"
                className={`btn ${mode === "manual" ? "btn-primary" : "btn-outline-primary"}`}
                onClick={() => {
                  setMode("manual");
                  setError("");
                }}
              >
                Manual Add
              </button>
            </div>

            {mode === "upload" ? (
              <input
                className="form-control"
                type="file"
                accept=".xlsx,.xls,.xlsm"
                onChange={(e) => setFile(e.target.files[0])}
              />
            ) : (
              <div className="d-grid gap-2">
                <div className="d-flex justify-content-between align-items-center">
                  <small className="text-muted">
                    Add one or more order rows manually. Existing item codes auto-fill description.
                    New item codes require description.
                  </small>
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={addManualRow}
                  >
                    + Add Row
                  </button>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>#</th>
                        <th>PO</th>
                        <th>Item Code</th>
                        <th>Description</th>
                        <th>Brand</th>
                        <th>Vendor</th>
                        <th>Qty</th>
                        <th>ETD</th>
                        <th>Order Date</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manualRows.map((row, index) => {
                        const itemMeta =
                          itemMetaByRow[row.id] || buildItemMeta({ itemCode: row.item_code });

                        return (
                          <tr key={row.id}>
                            <td>{index + 1}</td>
                            <td>
                              <input
                                type="text"
                                className="form-control form-control-sm"
                                value={row.order_id}
                                onChange={(e) => handleManualRowChange(row.id, "order_id", e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                className="form-control form-control-sm"
                                value={row.item_code}
                                list="manual-item-code-options"
                                onChange={(e) => handleManualRowChange(row.id, "item_code", e.target.value)}
                                onBlur={() => {
                                  handleManualItemCodeBlur(row.id);
                                }}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                className="form-control form-control-sm"
                                value={row.description}
                                readOnly={itemMeta.hasExistingDescription}
                                required={itemMeta.requiresDescription}
                                placeholder={
                                  itemMeta.hasExistingDescription
                                    ? "Auto-filled from item master"
                                    : "Enter description"
                                }
                                onChange={(e) => handleManualRowChange(row.id, "description", e.target.value)}
                              />
                              {itemMeta.hasExistingDescription && (
                                <div className="small text-success mt-1">
                                  Auto-filled from existing item code.
                                </div>
                              )}
                              {!itemMeta.hasExistingDescription && itemMeta.requiresDescription && (
                                <div className="small text-warning mt-1">
                                  New item code: description is required.
                                </div>
                              )}
                            </td>
                            <td>
                              <input
                                type="text"
                                className="form-control form-control-sm"
                                value={row.brand}
                                list="manual-brand-options"
                                placeholder="Select or type brand"
                                onChange={(e) => handleManualRowChange(row.id, "brand", e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                className="form-control form-control-sm"
                                value={row.vendor}
                                list="manual-vendor-options"
                                placeholder="Select or type vendor"
                                onChange={(e) => handleManualRowChange(row.id, "vendor", e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="1"
                                step="1"
                                className="form-control form-control-sm"
                                value={row.quantity}
                                onChange={(e) => handleManualRowChange(row.id, "quantity", e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="date"
                                className="form-control form-control-sm"
                                value={row.ETD}
                                onChange={(e) => handleManualRowChange(row.id, "ETD", e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="date"
                                className="form-control form-control-sm"
                                value={row.order_date}
                                onChange={(e) => handleManualRowChange(row.id, "order_date", e.target.value)}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-outline-danger btn-sm"
                                onClick={() => removeManualRow(row.id)}
                                disabled={manualRows.length === 1}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <datalist id="manual-item-code-options">
                  {mergedItemCodeOptions.map((itemCode) => (
                    <option key={itemCode} value={itemCode} />
                  ))}
                </datalist>
                <datalist id="manual-brand-options">
                  {mergedBrandOptions.map((brand) => (
                    <option key={brand} value={brand} />
                  ))}
                </datalist>
                <datalist id="manual-vendor-options">
                  {mergedVendorOptions.map((vendor) => (
                    <option key={vendor} value={vendor} />
                  ))}
                </datalist>
                {loadingReferenceData && (
                  <small className="text-muted">Loading brands, vendors, and item codes...</small>
                )}
              </div>
            )}

            {error && <div className="alert alert-danger py-2 mb-0">{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
              {loading ? (mode === "manual" ? "Saving..." : "Uploading...") : mode === "manual" ? "Save Orders" : "Upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UploadOrdersModal;
