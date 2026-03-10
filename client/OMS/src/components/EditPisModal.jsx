import { useMemo, useState } from "react";
import api from "../api/axios";
import { formatCbm } from "../utils/cbm";
import "../App.css";

const toText = (value, fallback = "") => String(value ?? fallback).trim();

const toNumberString = (value, fallback = "0") => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return String(parsed);
};

const parseNonNegativeNumber = (value, label) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return parsed;
};

const calculateCbmFromLbh = (box = {}) => {
  const length = Number(box?.L || 0);
  const breadth = Number(box?.B || 0);
  const height = Number(box?.H || 0);

  if (!Number.isFinite(length) || !Number.isFinite(breadth) || !Number.isFinite(height)) {
    return "0.000";
  }
  if (length <= 0 || breadth <= 0 || height <= 0) return "0.000";

  const cubicMeters = (length * breadth * height) / 1000000;
  return formatCbm(cubicMeters);
};

const getBrandLabel = (item = {}) =>
  toText(
    item?.brand
    || item?.brand_name
    || (Array.isArray(item?.brands) && item.brands.length > 0 ? item.brands[0] : "")
    || "N/A",
  );

const getVendorsLabel = (item = {}) =>
  Array.isArray(item?.vendors) && item.vendors.length > 0
    ? item.vendors.join(", ")
    : "N/A";

const buildInitialForm = (item = {}) => ({
  barcode: toText(item?.pis_barcode, ""),
  pis_weight: {
    net: toNumberString(item?.pis_weight?.net, "0"),
    gross: toNumberString(item?.pis_weight?.gross, "0"),
  },
  pis_item_LBH: {
    L: toNumberString(item?.pis_item_LBH?.L, "0"),
    B: toNumberString(item?.pis_item_LBH?.B, "0"),
    H: toNumberString(item?.pis_item_LBH?.H, "0"),
  },
  pis_box_LBH: {
    L: toNumberString(item?.pis_box_LBH?.L, "0"),
    B: toNumberString(item?.pis_box_LBH?.B, "0"),
    H: toNumberString(item?.pis_box_LBH?.H, "0"),
  },
});

const EditPisModal = ({ item, onClose, onUpdated }) => {
  const [form, setForm] = useState(() => buildInitialForm(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const itemCode = useMemo(() => toText(item?.code, "N/A"), [item?.code]);
  const itemDescription = useMemo(
    () => toText(item?.description || item?.name, "N/A"),
    [item?.description, item?.name],
  );
  const brandLabel = useMemo(() => getBrandLabel(item), [item]);
  const vendorsLabel = useMemo(() => getVendorsLabel(item), [item]);
  const calculatedPisCbm = useMemo(
    () => calculateCbmFromLbh(form.pis_box_LBH),
    [form.pis_box_LBH],
  );

  const updateField = (path, value) => {
    setForm((prev) => {
      const next = { ...prev };
      const chunks = path.split(".");
      let cursor = next;
      for (let i = 0; i < chunks.length - 1; i += 1) {
        cursor[chunks[i]] = { ...cursor[chunks[i]] };
        cursor = cursor[chunks[i]];
      }
      cursor[chunks[chunks.length - 1]] = value;
      return next;
    });
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");

      const payload = {
        pis_barcode: toText(form.barcode, ""),
        pis_weight: {
          net: parseNonNegativeNumber(form.pis_weight.net, "PIS Weight Net"),
          gross: parseNonNegativeNumber(form.pis_weight.gross, "PIS Weight Gross"),
        },
        pis_item_LBH: {
          L: parseNonNegativeNumber(form.pis_item_LBH.L, "PIS Item L"),
          B: parseNonNegativeNumber(form.pis_item_LBH.B, "PIS Item B"),
          H: parseNonNegativeNumber(form.pis_item_LBH.H, "PIS Item H"),
        },
        pis_box_LBH: {
          L: parseNonNegativeNumber(form.pis_box_LBH.L, "PIS Box L"),
          B: parseNonNegativeNumber(form.pis_box_LBH.B, "PIS Box B"),
          H: parseNonNegativeNumber(form.pis_box_LBH.H, "PIS Box H"),
        },
      };

      await api.patch(`/items/${item?._id}/pis`, payload);
      onUpdated?.();
      onClose?.();
    } catch (saveError) {
      setError(
        saveError?.response?.data?.message || saveError?.message || "Failed to update PIS values.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-lg" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Update PIS: {itemCode}</h5>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              disabled={saving}
              onClick={onClose}
            />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="row g-2">
              <div className="col-md-4">
                <label className="form-label">Code (Read Only)</label>
                <input type="text" className="form-control" value={itemCode} disabled />
              </div>
              <div className="col-md-4">
                <label className="form-label">Brand (Read Only)</label>
                <input type="text" className="form-control" value={brandLabel} disabled />
              </div>
              <div className="col-md-4">
                <label className="form-label">Vendors (Read Only)</label>
                <input type="text" className="form-control" value={vendorsLabel} disabled />
              </div>
              <div className="col-12">
                <label className="form-label">Description (Read Only)</label>
                <input type="text" className="form-control" value={itemDescription} disabled />
              </div>
            </div>

            <div className="row g-2">
              <div className="col-md-6">
                <label className="form-label">Barcode</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.barcode}
                  onChange={(e) => updateField("barcode", e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="row g-2">
              <div className="col-12">
                <h6 className="mb-1">PIS Weight</h6>
              </div>
              <div className="col-md-6">
                <label className="form-label">Net</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="form-control"
                  value={form.pis_weight.net}
                  onChange={(e) => updateField("pis_weight.net", e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Gross</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="form-control"
                  value={form.pis_weight.gross}
                  onChange={(e) => updateField("pis_weight.gross", e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="row g-2">
              <div className="col-12">
                <h6 className="mb-1">PIS LBH (cm)</h6>
              </div>
              <div className="col-md-6">
                <label className="form-label">Item LBH (L/B/H)</label>
                <div className="input-group">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="form-control"
                    value={form.pis_item_LBH.L}
                    onChange={(e) => updateField("pis_item_LBH.L", e.target.value)}
                    disabled={saving}
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="form-control"
                    value={form.pis_item_LBH.B}
                    onChange={(e) => updateField("pis_item_LBH.B", e.target.value)}
                    disabled={saving}
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="form-control"
                    value={form.pis_item_LBH.H}
                    onChange={(e) => updateField("pis_item_LBH.H", e.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>
              <div className="col-md-6">
                <label className="form-label">Box LBH (L/B/H)</label>
                <div className="input-group">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="form-control"
                    value={form.pis_box_LBH.L}
                    onChange={(e) => updateField("pis_box_LBH.L", e.target.value)}
                    disabled={saving}
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="form-control"
                    value={form.pis_box_LBH.B}
                    onChange={(e) => updateField("pis_box_LBH.B", e.target.value)}
                    disabled={saving}
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="form-control"
                    value={form.pis_box_LBH.H}
                    onChange={(e) => updateField("pis_box_LBH.H", e.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>
              <div className="col-md-6">
                <label className="form-label">Calculated PIS CBM</label>
                <input type="text" className="form-control" value={calculatedPisCbm} disabled />
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
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save PIS"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditPisModal;
