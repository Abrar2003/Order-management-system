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
  name: toText(item?.name),
  description: toText(item?.description),
  inspected_weight: {
    net: toNumberString(item?.inspected_weight?.net ?? item?.weight?.net, "0"),
    gross: toNumberString(item?.inspected_weight?.gross ?? item?.weight?.gross, "0"),
  },
  inspected_item_LBH: {
    L: toNumberString(item?.inspected_item_LBH?.L ?? item?.item_LBH?.L, "0"),
    B: toNumberString(item?.inspected_item_LBH?.B ?? item?.item_LBH?.B, "0"),
    H: toNumberString(item?.inspected_item_LBH?.H ?? item?.item_LBH?.H, "0"),
  },
  inspected_box_LBH: {
    L: toNumberString(item?.inspected_box_LBH?.L ?? item?.box_LBH?.L, "0"),
    B: toNumberString(item?.inspected_box_LBH?.B ?? item?.box_LBH?.B, "0"),
    H: toNumberString(item?.inspected_box_LBH?.H ?? item?.box_LBH?.H, "0"),
  },
  cbm: {
    top: toText(item?.cbm?.top, "0"),
    bottom: toText(item?.cbm?.bottom, "0"),
    total: toText(item?.cbm?.total, "0"),
    inspected_top: toText(item?.cbm?.inspected_top, "0"),
    inspected_bottom: toText(item?.cbm?.inspected_bottom, "0"),
    inspected_total: toText(item?.cbm?.inspected_total, "0"),
  },
  qc: {
    packed_size: Boolean(item?.qc?.packed_size),
    finishing: Boolean(item?.qc?.finishing),
    branding: Boolean(item?.qc?.branding),
    barcode: toNumberString(item?.qc?.barcode, "0"),
    last_inspected_date: toText(item?.qc?.last_inspected_date),
    quantities: {
      checked: toNumberString(item?.qc?.quantities?.checked, "0"),
      passed: toNumberString(item?.qc?.quantities?.passed, "0"),
      pending: toNumberString(item?.qc?.quantities?.pending, "0"),
    },
  },
  source: {
    from_orders: Boolean(item?.source?.from_orders),
    from_qc: Boolean(item?.source?.from_qc),
  },
});

const parseNonNegativeNumber = (value, label) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return parsed;
};

const EditItemModal = ({ item, onClose, onUpdated }) => {
  const [form, setForm] = useState(() => buildInitialForm(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const itemCode = useMemo(() => toText(item?.code, "N/A"), [item?.code]);
  const brandLabel = useMemo(() => getBrandLabel(item), [item]);
  const vendorsLabel = useMemo(() => getVendorsLabel(item), [item]);
  const calculatedInspectedCbm = useMemo(
    () => calculateCbmFromLbh(form.inspected_box_LBH),
    [form.inspected_box_LBH],
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
        name: toText(form.name),
        description: toText(form.description),
        inspected_weight: {
          net: parseNonNegativeNumber(form.inspected_weight.net, "Inspected Weight Net"),
          gross: parseNonNegativeNumber(form.inspected_weight.gross, "Inspected Weight Gross"),
        },
        inspected_item_LBH: {
          L: parseNonNegativeNumber(form.inspected_item_LBH.L, "Inspected Item L"),
          B: parseNonNegativeNumber(form.inspected_item_LBH.B, "Inspected Item B"),
          H: parseNonNegativeNumber(form.inspected_item_LBH.H, "Inspected Item H"),
        },
        inspected_box_LBH: {
          L: parseNonNegativeNumber(form.inspected_box_LBH.L, "Inspected Box L"),
          B: parseNonNegativeNumber(form.inspected_box_LBH.B, "Inspected Box B"),
          H: parseNonNegativeNumber(form.inspected_box_LBH.H, "Inspected Box H"),
        },
        cbm: {
          top: toText(form.cbm.top || "0"),
          bottom: toText(form.cbm.bottom || "0"),
          total: toText(form.cbm.total || "0"),
          inspected_top: toText(form.cbm.inspected_top || "0"),
          inspected_bottom: toText(form.cbm.inspected_bottom || "0"),
          inspected_total: toText(form.cbm.inspected_total || "0"),
        },
        qc: {
          packed_size: Boolean(form.qc.packed_size),
          finishing: Boolean(form.qc.finishing),
          branding: Boolean(form.qc.branding),
          barcode: parseNonNegativeNumber(form.qc.barcode, "QC Barcode"),
          last_inspected_date: toText(form.qc.last_inspected_date),
          quantities: {
            checked: parseNonNegativeNumber(form.qc.quantities.checked, "QC Checked"),
            passed: parseNonNegativeNumber(form.qc.quantities.passed, "QC Passed"),
            pending: parseNonNegativeNumber(form.qc.quantities.pending, "QC Pending"),
          },
        },
        source: {
          from_orders: Boolean(form.source.from_orders),
          from_qc: Boolean(form.source.from_qc),
        },
      };

      await api.patch(`/items/${item?._id}`, payload);
      onUpdated?.();
      onClose?.();
    } catch (saveError) {
      setError(saveError?.response?.data?.message || saveError?.message || "Failed to update item.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Edit Item: {itemCode}</h5>
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
            </div>

            <div className="row g-2">
              <div className="col-md-6">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Description</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="row g-2">
              <div className="col-12">
                <h6 className="mb-1">Weight</h6>
              </div>
              <div className="col-md-6">
                <label className="form-label">Inspected Net</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="form-control"
                  value={form.inspected_weight.net}
                  onChange={(e) => updateField("inspected_weight.net", e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Inspected Gross</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="form-control"
                  value={form.inspected_weight.gross}
                  onChange={(e) => updateField("inspected_weight.gross", e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="row g-2">
              <div className="col-12">
                <h6 className="mb-1">LBH</h6>
              </div>
              <div className="col-md-6">
                <label className="form-label">Inspected Item LBH (L/B/H)</label>
                <div className="input-group">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="form-control"
                    value={form.inspected_item_LBH.L}
                    onChange={(e) => updateField("inspected_item_LBH.L", e.target.value)}
                    disabled={saving}
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="form-control"
                    value={form.inspected_item_LBH.B}
                    onChange={(e) => updateField("inspected_item_LBH.B", e.target.value)}
                    disabled={saving}
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="form-control"
                    value={form.inspected_item_LBH.H}
                    onChange={(e) => updateField("inspected_item_LBH.H", e.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>
              <div className="col-md-6">
                <label className="form-label">Inspected Box LBH (L/B/H)</label>
                <div className="input-group">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="form-control"
                    value={form.inspected_box_LBH.L}
                    onChange={(e) => updateField("inspected_box_LBH.L", e.target.value)}
                    disabled={saving}
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="form-control"
                    value={form.inspected_box_LBH.B}
                    onChange={(e) => updateField("inspected_box_LBH.B", e.target.value)}
                    disabled={saving}
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="form-control"
                    value={form.inspected_box_LBH.H}
                    onChange={(e) => updateField("inspected_box_LBH.H", e.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>
            </div>

            <div className="row g-2">
              <div className="col-12">
                <h6 className="mb-1">CBM</h6>
              </div>
              <div className="col-md-3">
                <label className="form-label">Top</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.cbm.top}
                  onChange={(e) => updateField("cbm.top", e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label">Bottom</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.cbm.bottom}
                  onChange={(e) => updateField("cbm.bottom", e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label">Total</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.cbm.total}
                  onChange={(e) => updateField("cbm.total", e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label">Calculated Inspected CBM</label>
                <input
                  type="text"
                  className="form-control"
                  value={calculatedInspectedCbm}
                  disabled
                  readOnly
                />
              </div>
              <div className="col-md-4">
                <label className="form-label">Inspected Top</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.cbm.inspected_top}
                  onChange={(e) => updateField("cbm.inspected_top", e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label">Inspected Bottom</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.cbm.inspected_bottom}
                  onChange={(e) => updateField("cbm.inspected_bottom", e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label">Inspected Total</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.cbm.inspected_total}
                  onChange={(e) => updateField("cbm.inspected_total", e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="row g-2">
              <div className="col-12">
                <h6 className="mb-1">QC</h6>
              </div>
              <div className="col-md-3">
                <div className="form-check mt-4">
                  <input
                    id="item-qc-packed-size"
                    className="form-check-input"
                    type="checkbox"
                    checked={form.qc.packed_size}
                    onChange={(e) => updateField("qc.packed_size", e.target.checked)}
                    disabled={saving}
                  />
                  <label htmlFor="item-qc-packed-size" className="form-check-label">
                    Packed Size Check
                  </label>
                </div>
              </div>
              <div className="col-md-3">
                <div className="form-check mt-4">
                  <input
                    id="item-qc-finishing"
                    className="form-check-input"
                    type="checkbox"
                    checked={form.qc.finishing}
                    onChange={(e) => updateField("qc.finishing", e.target.checked)}
                    disabled={saving}
                  />
                  <label htmlFor="item-qc-finishing" className="form-check-label">
                    Finishing Check
                  </label>
                </div>
              </div>
              <div className="col-md-3">
                <div className="form-check mt-4">
                  <input
                    id="item-qc-branding"
                    className="form-check-input"
                    type="checkbox"
                    checked={form.qc.branding}
                    onChange={(e) => updateField("qc.branding", e.target.checked)}
                    disabled={saving}
                  />
                  <label htmlFor="item-qc-branding" className="form-check-label">
                    Branding Check
                  </label>
                </div>
              </div>
              <div className="col-md-3">
                <label className="form-label">Barcode</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="form-control"
                  value={form.qc.barcode}
                  onChange={(e) => updateField("qc.barcode", e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label">Last Inspected Date</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="YYYY-MM-DD or DD/MM/YYYY"
                  value={form.qc.last_inspected_date}
                  onChange={(e) => updateField("qc.last_inspected_date", e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-8">
                <label className="form-label">QC Quantities (Checked / Passed / Pending)</label>
                <div className="input-group">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="form-control"
                    value={form.qc.quantities.checked}
                    onChange={(e) => updateField("qc.quantities.checked", e.target.value)}
                    disabled={saving}
                  />
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="form-control"
                    value={form.qc.quantities.passed}
                    onChange={(e) => updateField("qc.quantities.passed", e.target.value)}
                    disabled={saving}
                  />
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="form-control"
                    value={form.qc.quantities.pending}
                    onChange={(e) => updateField("qc.quantities.pending", e.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>
            </div>

            <div className="row g-2">
              <div className="col-12">
                <h6 className="mb-1">Source</h6>
              </div>
              <div className="col-md-3">
                <div className="form-check">
                  <input
                    id="item-source-orders"
                    className="form-check-input"
                    type="checkbox"
                    checked={form.source.from_orders}
                    onChange={(e) => updateField("source.from_orders", e.target.checked)}
                    disabled={saving}
                  />
                  <label htmlFor="item-source-orders" className="form-check-label">
                    From Orders
                  </label>
                </div>
              </div>
              <div className="col-md-3">
                <div className="form-check">
                  <input
                    id="item-source-qc"
                    className="form-check-input"
                    type="checkbox"
                    checked={form.source.from_qc}
                    onChange={(e) => updateField("source.from_qc", e.target.checked)}
                    disabled={saving}
                  />
                  <label htmlFor="item-source-qc" className="form-check-label">
                    From QC
                  </label>
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
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Item"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditItemModal;
