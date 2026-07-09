import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import { getCompleteVendorCodes } from "../utils/vendorCodes";
import "../App.css";

const normalizeText = (value, fallback = "") => String(value ?? fallback).trim();

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

const normalizeKey = (value) => normalizeText(value).toLowerCase();

const getVendorCodeForBrand = (vendor, brand) => {
  const normalizedBrand = normalizeKey(brand);
  if (!normalizedBrand) return "";

  const match = getCompleteVendorCodes(vendor?.vendor_code).find(
    (entry) => normalizeKey(entry.brand) === normalizedBrand,
  );
  return normalizeText(match?.code);
};

const createInitialForm = (finish = {}) => ({
  vendor_id: normalizeText(finish?.vendor_id || finish?.vendorId),
  vendor: normalizeText(finish?.vendor),
  vendor_code: normalizeCode(finish?.vendor_code || finish?.vendorCode),
  color: normalizeText(finish?.color),
  color_code: normalizeCode(finish?.color_code || finish?.colorCode),
  image: null,
});

const getInitialItemCodes = (finish = {}) =>
  [
    ...new Set(
      (Array.isArray(finish?.item_codes) ? finish.item_codes : [])
        .map(normalizeText)
        .filter(Boolean),
    ),
  ];

const useDebouncedValue = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
};

const UploadFinishModal = ({ initialFinish = null, onClose, onSaved }) => {
  const isEditing = Boolean(initialFinish?._id);
  const [form, setForm] = useState(() => createInitialForm(initialFinish));
  const [saving, setSaving] = useState(false);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState("");
  const [vendorError, setVendorError] = useState("");
  const [itemError, setItemError] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [vendorOptions, setVendorOptions] = useState([]);
  const [vendorItems, setVendorItems] = useState([]);
  const [selectedItemCodes, setSelectedItemCodes] = useState(() =>
    getInitialItemCodes(initialFinish),
  );

  const debouncedVendor = useDebouncedValue(form.vendor, 300);
  const uniqueCode = useMemo(
    () => normalizeCode(`${form.vendor_code}-${form.color_code}`),
    [form.color_code, form.vendor_code],
  );

  const selectedVendor = useMemo(
    () =>
      vendorOptions.find((vendor) => String(vendor?._id || "") === String(form.vendor_id || "")) || null,
    [form.vendor_id, vendorOptions],
  );

  useEffect(() => {
    setForm(createInitialForm(initialFinish));
    setSelectedItemCodes(getInitialItemCodes(initialFinish));
    setItemSearch("");
    setVendorItems([]);
    setItemError("");
  }, [initialFinish]);

  useEffect(() => {
    let isMounted = true;

    const fetchVendorOptions = async () => {
      try {
        setLoadingVendors(true);
        setVendorError("");
        const response = await api.get("/finishes/vendor-options");
        if (!isMounted) return;
        setVendorOptions(Array.isArray(response?.data?.data) ? response.data.data : []);
      } catch (fetchError) {
        if (!isMounted) return;
        setVendorOptions([]);
        setVendorError(
          fetchError?.response?.data?.message
            || "Failed to load vendors.",
        );
      } finally {
        if (isMounted) {
          setLoadingVendors(false);
        }
      }
    };

    fetchVendorOptions();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const normalizedVendor = normalizeText(debouncedVendor);
    let isMounted = true;

    setVendorItems([]);
    setItemError("");

    if (!normalizedVendor) {
      setLoadingItems(false);
      return undefined;
    }

    const fetchVendorItems = async () => {
      try {
        setLoadingItems(true);
        const response = await api.get("/finishes/vendor-items", {
          params: {
            vendor: normalizedVendor,
          },
        });
        if (!isMounted) return;
        setVendorItems(Array.isArray(response?.data?.items) ? response.data.items : []);
      } catch (fetchError) {
        if (!isMounted) return;
        setVendorItems([]);
        setItemError(
          fetchError?.response?.data?.message
            || "Failed to load items for this vendor.",
        );
      } finally {
        if (isMounted) {
          setLoadingItems(false);
        }
      }
    };

    fetchVendorItems();
    return () => {
      isMounted = false;
    };
  }, [debouncedVendor]);

  const visibleItems = useMemo(() => {
    const normalizedSearch = normalizeText(itemSearch).toLowerCase();
    if (!normalizedSearch) return vendorItems;

    return vendorItems.filter((item) => {
      const haystack = [
        item?.code,
        item?.name,
        item?.description,
        item?.brand,
      ]
        .map((value) => normalizeText(value).toLowerCase())
        .join(" ");
      return haystack.includes(normalizedSearch);
    });
  }, [itemSearch, vendorItems]);

  const selectedBrands = useMemo(() => {
    const brandByCode = new Map(
      vendorItems.map((item) => [
        normalizeText(item?.code),
        normalizeText(item?.brand),
      ]),
    );

    return [
      ...new Set(
        selectedItemCodes
          .map((code) => brandByCode.get(normalizeText(code)))
          .filter(Boolean),
      ),
    ].sort((left, right) => left.localeCompare(right));
  }, [selectedItemCodes, vendorItems]);

  const selectedBrand = selectedBrands.length === 1 ? selectedBrands[0] : "";

  useEffect(() => {
    if (isEditing) return;

    const nextVendorCode = getVendorCodeForBrand(selectedVendor, selectedBrand);
    setForm((prev) =>
      prev.vendor_code === nextVendorCode
        ? prev
        : { ...prev, vendor_code: nextVendorCode },
    );
  }, [isEditing, selectedBrand, selectedVendor]);

  const vendorCodeHint = useMemo(() => {
    if (!form.vendor_id) return "Select a vendor.";
    if (selectedItemCodes.length === 0) return "Select items to fill vendor code.";
    if (selectedBrands.length > 1) return "Select items from one brand.";
    if (selectedBrand && !normalizeCode(form.vendor_code)) {
      return `No vendor code found for ${selectedBrand}.`;
    }
    return selectedBrand ? `Brand: ${selectedBrand}` : "";
  }, [form.vendor_code, form.vendor_id, selectedBrand, selectedBrands.length, selectedItemCodes.length]);

  const selectedItemCodeSet = useMemo(
    () => new Set(selectedItemCodes),
    [selectedItemCodes],
  );

  const allVisibleSelected = useMemo(
    () =>
      visibleItems.length > 0 &&
      visibleItems.every((item) => selectedItemCodeSet.has(item.code)),
    [selectedItemCodeSet, visibleItems],
  );

  const updateField = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleVendorChange = (vendorId) => {
    const vendor = vendorOptions.find((option) => String(option?._id || "") === String(vendorId || ""));
    setForm((prev) => ({
      ...prev,
      vendor_id: vendor?._id || "",
      vendor: vendor?.name || "",
      vendor_code: "",
    }));
    setItemSearch("");
    setSelectedItemCodes([]);
    setVendorItems([]);
    setItemError("");
  };

  const toggleItemSelection = (itemCode) => {
    const normalizedCode = normalizeText(itemCode);
    if (!normalizedCode) return;

    setSelectedItemCodes((prev) =>
      prev.includes(normalizedCode)
        ? prev.filter((code) => code !== normalizedCode)
        : [...prev, normalizedCode],
    );
  };

  const toggleAllVisible = () => {
    const visibleCodes = visibleItems
      .map((item) => normalizeText(item?.code))
      .filter(Boolean);

    if (visibleCodes.length === 0) return;

    setSelectedItemCodes((prev) => {
      const prevSet = new Set(prev);
      if (visibleCodes.every((code) => prevSet.has(code))) {
        return prev.filter((code) => !visibleCodes.includes(code));
      }

      const nextSet = new Set(prev);
      visibleCodes.forEach((code) => nextSet.add(code));
      return [...nextSet];
    });
  };

  const handleSubmit = async () => {
    try {
      setSaving(true);
      setError("");

      const formData = new FormData();
      if (isEditing) {
        formData.append("finish_id", initialFinish._id);
      }
      formData.append("vendor_id", normalizeText(form.vendor_id));
      formData.append("vendor", normalizeText(form.vendor));
      formData.append("vendor_code", normalizeCode(form.vendor_code));
      formData.append("color", normalizeText(form.color));
      formData.append("color_code", normalizeCode(form.color_code));
      formData.append("item_codes", JSON.stringify(selectedItemCodes));
      if (form.image instanceof File) {
        formData.append("image", form.image);
      }

      const response = await api.post("/finishes", formData);
      onSaved?.(
        response?.data?.message || "Finish saved successfully.",
      );
      onClose?.();
    } catch (saveError) {
      setError(
        saveError?.response?.data?.message
          || saveError?.message
          || "Failed to save finish.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{isEditing ? "Edit Finish" : "Upload Finish"}</h5>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              disabled={saving}
              onClick={onClose}
            />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label">Vendor</label>
                <select
                  className="form-select"
                  value={form.vendor_id}
                  onChange={(event) => handleVendorChange(event.target.value)}
                  disabled={saving || loadingVendors}
                >
                  <option value="">
                    {loadingVendors ? "Loading vendors..." : "Select vendor"}
                  </option>
                  {vendorOptions.map((vendor) => (
                    <option key={vendor._id} value={vendor._id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
                {vendorError && (
                  <div className="text-danger small mt-1">{vendorError}</div>
                )}
              </div>

              <div className="col-md-3">
                <label className="form-label">Vendor Code</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.vendor_code}
                  onChange={(event) => updateField("vendor_code", event.target.value)}
                  placeholder="Enter vendor code"
                  disabled={saving || !normalizeText(form.vendor_id || form.vendor)}
                />
                {vendorCodeHint && (
                  <div className="text-secondary small mt-1">{vendorCodeHint}</div>
                )}
              </div>

              <div className="col-md-3">
                <label className="form-label">Color Code</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.color_code}
                  onChange={(event) => updateField("color_code", event.target.value)}
                  placeholder="e.g. BLK"
                  disabled={saving}
                />
              </div>

              <div className="col-md-6">
                <label className="form-label">Color</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.color}
                  onChange={(event) => updateField("color", event.target.value)}
                  placeholder="Enter finish color"
                  disabled={saving}
                />
              </div>

              <div className="col-md-6">
                <label className="form-label">Finish Image</label>
                <input
                  type="file"
                  className="form-control"
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  disabled={saving}
                  onChange={(event) => updateField("image", event.target.files?.[0] || null)}
                />
              </div>

              <div className="col-12">
                <label className="form-label">Unique Code Preview</label>
                <div className="finish-code-preview">
                  {uniqueCode || "Enter vendor code and color code"}
                </div>
              </div>
            </div>

            <div className="row g-3">
              <div className="col-12">
                <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
                  <div>
                    <h6 className="mb-1">Vendor Items</h6>
                    <div className="text-secondary small">
                      Select the items that should receive this finish.
                    </div>
                  </div>
                  <div className="d-flex flex-wrap gap-2 align-items-center">
                    <span className="om-summary-chip">
                      Loaded: {vendorItems.length}
                    </span>
                    <span className="om-summary-chip">
                      Selected: {selectedItemCodes.length}
                    </span>
                  </div>
                </div>
              </div>

              <div className="col-md-8">
                <label className="form-label">Search In Vendor Items</label>
                <input
                  type="text"
                  className="form-control"
                  value={itemSearch}
                  onChange={(event) => setItemSearch(event.target.value)}
                  placeholder="Search code, name, description, brand"
                  disabled={saving || loadingItems || !normalizeText(form.vendor_id || form.vendor)}
                />
              </div>

              <div className="col-md-4 d-flex align-items-end">
                <button
                  type="button"
                  className="btn btn-outline-primary w-100"
                  onClick={toggleAllVisible}
                  disabled={saving || visibleItems.length === 0}
                >
                  {allVisibleSelected ? "Unselect Visible" : "Select Visible"}
                </button>
              </div>

              <div className="col-12">
                <div className="finish-item-picker">
                  {!normalizeText(form.vendor_id || form.vendor) ? (
                    <div className="finish-item-picker-empty">
                      Select a vendor to load matching items.
                    </div>
                  ) : loadingItems ? (
                    <div className="finish-item-picker-empty">Loading items...</div>
                  ) : itemError ? (
                    <div className="finish-item-picker-empty text-danger">{itemError}</div>
                  ) : visibleItems.length === 0 ? (
                    <div className="finish-item-picker-empty">
                      No items found for this vendor.
                    </div>
                  ) : (
                    <div className="d-grid gap-2">
                      {visibleItems.map((item) => {
                        const itemCode = normalizeText(item?.code);
                        const isSelected = selectedItemCodeSet.has(itemCode);
                        const existingFinishCodes = (Array.isArray(item?.finish) ? item.finish : [])
                          .map((entry) => normalizeText(entry?.unique_code))
                          .filter(Boolean);

                        return (
                          <label
                            key={itemCode || item?._id}
                            className={`finish-item-row${isSelected ? " is-selected" : ""}`}
                          >
                            <input
                              type="checkbox"
                              className="form-check-input mt-0"
                              checked={isSelected}
                              onChange={() => toggleItemSelection(itemCode)}
                              disabled={saving}
                            />
                            <div className="finish-item-row-body">
                              <div className="d-flex flex-wrap gap-2 align-items-center">
                                <span className="fw-semibold">{itemCode || "N/A"}</span>
                                <span className="om-summary-chip">{item?.brand || "N/A"}</span>
                              </div>
                              <div className="finish-item-meta">
                                {normalizeText(item?.description || item?.name, "No description")}
                              </div>
                              {existingFinishCodes.length > 0 && (
                                <div className="finish-item-meta">
                                  Existing Finish: {existingFinishCodes.join(", ")}
                                </div>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {error && <div className="alert alert-danger mb-0">{error}</div>}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={
                saving
                || !normalizeText(form.vendor_id || form.vendor)
                || !normalizeCode(form.vendor_code)
                || !normalizeText(form.color)
                || !normalizeCode(form.color_code)
                || selectedItemCodes.length === 0
              }
            >
              {saving ? "Saving..." : isEditing ? "Update Finish" : "Save Finish"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UploadFinishModal;
