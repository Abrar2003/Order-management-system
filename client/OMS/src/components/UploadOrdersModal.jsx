import { useEffect, useMemo, useRef, useState } from "react";
import api from "../api/axios";
import PreviousOrderCheckModal from "./PreviousOrderCheckModal";
import {
  applyUploadedRows,
  createManualOrders,
  previewUploadOrders,
} from "../services/orders.service";
import { formatDateDDMMYYYY } from "../utils/date";
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

const getItemMasterBrand = (itemDoc = {}) =>
  toTrimmedString(
    itemDoc?.brand
    || itemDoc?.brand_name
    || (Array.isArray(itemDoc?.brands) && itemDoc.brands.length > 0 ? itemDoc.brands[0] : ""),
  );

const getItemMasterVendors = (itemDoc = {}) =>
  sortUniqueStrings(Array.isArray(itemDoc?.vendors) ? itemDoc.vendors : []);

const getItemPreferredVendor = (itemDoc = {}) => {
  const vendors = getItemMasterVendors(itemDoc);
  return vendors.length > 0 ? vendors[0] : "";
};

const buildItemMeta = ({
  itemCode = "",
  existingDescription = "",
  existingBrand = "",
  existingVendor = "",
} = {}) => {
  const normalizedCode = toTrimmedString(itemCode);
  const normalizedDescription = toTrimmedString(existingDescription);
  const normalizedBrand = toTrimmedString(existingBrand);
  const normalizedVendor = toTrimmedString(existingVendor);

  return {
    hasExistingDescription: Boolean(normalizedDescription),
    requiresDescription: Boolean(normalizedCode) && !normalizedDescription,
    autoDescription: normalizedDescription,
    autoBrand: normalizedBrand,
    autoVendor: normalizedVendor,
  };
};

const formatUploadChangeType = (value) => {
  const normalized = toTrimmedString(value).replace(/_/g, " ");
  if (!normalized) return "-";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const toUploadDateText = (value) => {
  const formatted = formatDateDDMMYYYY(value, "");
  return formatted || "-";
};

const isPreviousOrderCheckable = (row = {}) =>
  String(row?.change_type || "").trim().toLowerCase() === "new";

const formatPreviousOrderActionSummary = (action = {}) => {
  const previousOrderId = String(action?.previous_order_order_id || "").trim();
  if (!previousOrderId) return "";

  const strategy = String(action?.strategy || "").trim().toLowerCase();
  if (strategy === "replace_previous") {
    return action?.transfer_inspection_records
      ? `Replace ${previousOrderId} and transfer QC`
      : `Replace ${previousOrderId}`;
  }

  return `Keep both with ${previousOrderId}`;
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
  const [uploadPreviewSummary, setUploadPreviewSummary] = useState(null);
  const [uploadPreviewRows, setUploadPreviewRows] = useState([]);
  const [checkedUploadRows, setCheckedUploadRows] = useState({});
  const [activePreviousOrderRow, setActivePreviousOrderRow] = useState(null);
  const itemLookupCacheRef = useRef(new Map());

  const selectableUploadRows = useMemo(
    () =>
      uploadPreviewRows.filter(
        (row) => String(row?.change_type || "").trim().toLowerCase() === "new",
      ),
    [uploadPreviewRows],
  );
  const selectedUploadCount = selectableUploadRows.filter(
    (row) => checkedUploadRows[row.row_id],
  ).length;
  const allUploadRowsSelected =
    selectableUploadRows.length > 0
    && selectedUploadCount === selectableUploadRows.length;

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

        const itemsRes = await api.get("/items", {
          params: {
            page: 1,
            limit: 1,
          },
        });

        if (cancelled) return;

        const nextBrandOptions = sortUniqueStrings(
          Array.isArray(itemsRes?.data?.filters?.brands)
            ? itemsRes.data.filters.brands
            : [],
        );

        const nextVendorOptions = sortUniqueStrings(
          Array.isArray(itemsRes?.data?.filters?.vendors)
            ? itemsRes.data.filters.vendors
            : [],
        );

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

  const resetUploadPreview = () => {
    setUploadPreviewSummary(null);
    setUploadPreviewRows([]);
    setCheckedUploadRows({});
  };

  const toggleAllUploadRows = (checked) => {
    const nextState = {};
    selectableUploadRows.forEach((row) => {
      nextState[row.row_id] = checked;
    });
    setCheckedUploadRows(nextState);
  };

  const handleUploadPreview = async () => {
    if (!file) {
      setError("Please select an Excel file");
      return;
    }

    try {
      setLoading(true);
      setError("");
      resetUploadPreview();

      const response = await previewUploadOrders(file);
      const incomingRows = Array.isArray(response?.preview_rows)
        ? response.preview_rows
        : [];
      const normalizedRows = incomingRows.map((row, index) => {
        const fallbackId =
          `${toTrimmedString(row?.order_id)}__${toTrimmedString(row?.item_code)}__${index}`;
        return {
          ...row,
          row_id: toTrimmedString(row?.row_id) || fallbackId,
          change_type: toTrimmedString(row?.change_type).toLowerCase(),
          changed_fields: Array.isArray(row?.changed_fields)
            ? row.changed_fields
            : toTrimmedString(row?.changed_fields)
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean),
        };
      });

      const nextCheckedRows = {};
      normalizedRows.forEach((row) => {
        if (row.change_type === "new") {
          nextCheckedRows[row.row_id] = true;
        }
      });

      setUploadPreviewSummary(response?.summary || null);
      setUploadPreviewRows(normalizedRows);
      setCheckedUploadRows(nextCheckedRows);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to preview upload rows");
    } finally {
      setLoading(false);
    }
  };

  const handleApplyCheckedUploadRows = async () => {
    const rowsToApply = selectableUploadRows.filter((row) => checkedUploadRows[row.row_id]);
    if (rowsToApply.length === 0) {
      setError("Please check at least one row to update.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await applyUploadedRows({
        rows: rowsToApply,
        sourceFileName: file?.name || "",
      });
      const warnings = Array.isArray(response?.warnings) ? response.warnings : [];
      if (warnings.length > 0) {
        window.alert(["Upload completed with warnings:", ...warnings].join("\n"));
      }
      onSuccess?.();
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.message || err?.message || "Failed to update checked rows.");
    } finally {
      setLoading(false);
    }
  };

  const handlePreviousOrderActionSave = (nextAction) => {
    if (!activePreviousOrderRow?.row_id) return;

    setUploadPreviewRows((prevRows) =>
      prevRows.map((row) =>
        row.row_id !== activePreviousOrderRow.row_id
          ? row
          : {
            ...row,
            previous_order_action: nextAction,
          },
      ),
    );
    setActivePreviousOrderRow(null);
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
            const previousAutoBrand = toTrimmedString(previousMeta?.autoBrand);
            const previousAutoVendor = toTrimmedString(previousMeta?.autoVendor);
            const currentDescription = toTrimmedString(row.description);
            const currentBrand = toTrimmedString(row.brand);
            const currentVendor = toTrimmedString(row.vendor);
            const shouldClearDescription =
              Boolean(previousAutoDescription) && currentDescription === previousAutoDescription;
            const shouldClearBrand =
              Boolean(previousAutoBrand) && currentBrand === previousAutoBrand;
            const shouldClearVendor =
              Boolean(previousAutoVendor) && currentVendor === previousAutoVendor;

            return {
              ...row,
              item_code: value,
              description: shouldClearDescription ? "" : row.description,
              brand: shouldClearBrand ? "" : row.brand,
              vendor: shouldClearVendor ? "" : row.vendor,
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
        brand: getItemMasterBrand(exactMatch),
        vendors: getItemMasterVendors(exactMatch),
        vendor: getItemPreferredVendor(exactMatch),
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
        let existingBrand = "";
        let existingVendor = "";
        try {
          const matchedItem = await lookupItemByCode(itemCode);
          existingDescription = toTrimmedString(matchedItem?.description);
          existingBrand = toTrimmedString(matchedItem?.brand);
          existingVendor = toTrimmedString(matchedItem?.vendor);
        } catch (lookupError) {
          console.error("Item lookup failed:", lookupError);
        }

        const fallbackDescription = toTrimmedString(row?.description);
        const fallbackBrand = toTrimmedString(row?.brand);
        const fallbackVendor = toTrimmedString(row?.vendor);

        return {
          row: {
            ...row,
            item_code: itemCode,
            description: existingDescription || fallbackDescription,
            brand: fallbackBrand || existingBrand,
            vendor: fallbackVendor || existingVendor,
          },
          meta: buildItemMeta({
            itemCode,
            existingDescription,
            existingBrand,
            existingVendor,
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
          brand: resolvedRow.brand,
          vendor: resolvedRow.vendor,
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
              <div className="d-grid gap-3">
                <input
                  className="form-control"
                  type="file"
                  accept=".xlsx,.xls,.xlsm"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] || null);
                    setError("");
                    resetUploadPreview();
                  }}
                />

                {uploadPreviewSummary && (
                  <div className="card">
                    <div className="card-body d-grid gap-1">
                      <div className="small">Extracted: {Number(uploadPreviewSummary.extracted_rows || 0)}</div>
                      <div className="small">Valid Unique: {Number(uploadPreviewSummary.valid_unique_rows || 0)}</div>
                      <div className="small">Changed: {Number(uploadPreviewSummary.changed_rows || 0)}</div>
                      <div className="small">New: {Number(uploadPreviewSummary.new_rows || 0)}</div>
                      <div className="small">Modified: {Number(uploadPreviewSummary.modified_rows || 0)}</div>
                      <div className="small">Closed: {Number(uploadPreviewSummary.closed_rows || 0)}</div>
                      <div className="small">Selectable New Rows: {Number(uploadPreviewSummary.selectable_rows || 0)}</div>
                      <div className="small">Invalid: {Number(uploadPreviewSummary.invalid_rows || 0)}</div>
                      <div className="small">Duplicate In File: {Number(uploadPreviewSummary.duplicate_in_file_rows || 0)}</div>
                      <div className="small">Existing Unchanged: {Number(uploadPreviewSummary.already_exists_rows || 0)}</div>
                    </div>
                  </div>
                )}

                {uploadPreviewRows.length > 0 && (
                  <div className="card">
                    <div className="card-header d-flex justify-content-between align-items-center">
                      <strong>Upload Comparison Preview</strong>
                      <span className="small text-muted">
                        Selected: {selectedUploadCount} / {selectableUploadRows.length}
                      </span>
                    </div>
                    <div className="card-body p-0">
                      <div className="table-responsive" style={{ maxHeight: "320px" }}>
                        <table className="table table-sm table-hover align-middle mb-0">
                          <thead className="table-light">
                            <tr>
                              <th style={{ width: "42px" }}>
                                <input
                                  type="checkbox"
                                  className="form-check-input"
                                  checked={allUploadRowsSelected}
                                  onChange={(e) => toggleAllUploadRows(Boolean(e.target.checked))}
                                  disabled={loading || selectableUploadRows.length === 0}
                                />
                              </th>
                              <th>Type</th>
                              <th>Order ID</th>
                              <th>Item</th>
                              <th>Description</th>
                              <th>Brand</th>
                              <th>Vendor</th>
                              <th>Qty</th>
                              <th>ETD</th>
                              <th>Order Date</th>
                              <th>Existing Status</th>
                              <th>Changed Fields</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {uploadPreviewRows.map((row) => {
                              const isSelectable =
                                String(row?.change_type || "").trim().toLowerCase() === "new";
                              return (
                                <tr key={row.row_id}>
                                  <td>
                                    <input
                                      type="checkbox"
                                      className="form-check-input"
                                      checked={Boolean(checkedUploadRows[row.row_id])}
                                      disabled={!isSelectable || loading}
                                      onChange={(e) =>
                                        setCheckedUploadRows((prev) => ({
                                          ...prev,
                                          [row.row_id]: Boolean(e.target.checked),
                                        }))
                                      }
                                    />
                                  </td>
                                  <td>{formatUploadChangeType(row.change_type)}</td>
                                  <td>{row.order_id || "-"}</td>
                                  <td>{row.item_code || "-"}</td>
                                  <td>{row.description || "-"}</td>
                                  <td>{row.brand || "-"}</td>
                                  <td>{row.vendor || "-"}</td>
                                  <td>{row.quantity || "-"}</td>
                                  <td>{toUploadDateText(row.ETD)}</td>
                                  <td>{toUploadDateText(row.order_date)}</td>
                                  <td>{row.existing_order_status || "-"}</td>
                                  <td>
                                    {Array.isArray(row.changed_fields) && row.changed_fields.length > 0
                                      ? row.changed_fields.join(", ")
                                      : "-"}
                                  </td>
                                  <td>
                                    {isPreviousOrderCheckable(row) ? (
                                      <div className="d-grid gap-1">
                                        <button
                                          type="button"
                                          className="btn btn-outline-primary btn-sm"
                                          onClick={() => setActivePreviousOrderRow(row)}
                                          disabled={loading}
                                        >
                                          Check Prev Orders
                                        </button>
                                        {formatPreviousOrderActionSummary(
                                          row?.previous_order_action,
                                        ) && (
                                          <div className="small text-muted">
                                            {formatPreviousOrderActionSummary(
                                              row?.previous_order_action,
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      "-"
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="d-grid gap-2">
                <div className="d-flex justify-content-between align-items-center">
                  <small className="text-muted">
                    Add one or more order rows manually. Existing item codes auto-fill description
                    and may auto-fill brand/vendor. New item codes require description.
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
            {mode === "manual" ? (
              <button type="button" className="btn btn-primary" onClick={handleManualAdd} disabled={loading}>
                {loading ? "Saving..." : "Save Orders"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleUploadPreview}
                  disabled={loading}
                >
                  {loading ? "Processing..." : "Extract & Preview"}
                </button>
                <button
                  type="button"
                  className="btn btn-success"
                  onClick={handleApplyCheckedUploadRows}
                  disabled={loading || selectedUploadCount === 0}
                >
                  {loading ? "Updating..." : "Update Checked in DB"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {activePreviousOrderRow && (
        <PreviousOrderCheckModal
          row={activePreviousOrderRow}
          action={activePreviousOrderRow?.previous_order_action}
          onClose={() => setActivePreviousOrderRow(null)}
          onApply={handlePreviousOrderActionSave}
        />
      )}
    </div>
  );
};

export default UploadOrdersModal;
