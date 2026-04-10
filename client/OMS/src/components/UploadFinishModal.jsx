import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import "../App.css";

const normalizeText = (value, fallback = "") => String(value ?? fallback).trim();

const normalizeCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

const useDebouncedValue = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
};

const UploadFinishModal = ({ onClose, onSaved }) => {
  const [form, setForm] = useState({
    vendor: "",
    vendor_code: "",
    color: "",
    color_code: "",
    image: null,
  });
  const [saving, setSaving] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState("");
  const [itemError, setItemError] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [vendorItems, setVendorItems] = useState([]);
  const [selectedItemCodes, setSelectedItemCodes] = useState([]);

  const debouncedVendor = useDebouncedValue(form.vendor, 300);
  const uniqueCode = useMemo(
    () => normalizeCode(`${form.vendor_code}-${form.color_code}`),
    [form.color_code, form.vendor_code],
  );

  useEffect(() => {
    const normalizedVendor = normalizeText(debouncedVendor);
    let isMounted = true;

    setSelectedItemCodes([]);
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
            <h5 className="modal-title">Upload Finish</h5>
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
                <input
                  type="text"
                  className="form-control"
                  value={form.vendor}
                  onChange={(event) => updateField("vendor", event.target.value)}
                  placeholder="Enter vendor name"
                  disabled={saving}
                />
              </div>

              <div className="col-md-3">
                <label className="form-label">Vendor Code</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.vendor_code}
                  onChange={(event) => updateField("vendor_code", event.target.value)}
                  placeholder="e.g. VEN01"
                  disabled={saving}
                />
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
                  disabled={saving || loadingItems || !normalizeText(form.vendor)}
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
                  {!normalizeText(form.vendor) ? (
                    <div className="finish-item-picker-empty">
                      Enter a vendor to load matching items.
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
                || !normalizeText(form.vendor)
                || !normalizeCode(form.vendor_code)
                || !normalizeText(form.color)
                || !normalizeCode(form.color_code)
                || selectedItemCodes.length === 0
              }
            >
              {saving ? "Saving..." : "Save Finish"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UploadFinishModal;
