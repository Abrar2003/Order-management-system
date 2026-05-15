import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { formatDateDDMMYYYY } from "../utils/date";
import "../App.css";

const normalizeText = (value) => String(value ?? "").trim();
const formatValue = (value) => {
  if (value === null || value === undefined || value === "") return "Not Set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (value.length === 0) return "Not Set";
    return value.map((entry) => formatValue(entry)).join(", ");
  }
  if (value instanceof Date) return formatDateDDMMYYYY(value);
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, entryValue]) =>
      entryValue !== null && entryValue !== undefined && entryValue !== "",
    );
    if (entries.length === 0) return "Not Set";
    return entries.map(([key, entryValue]) => `${formatLabel(key)}: ${formatValue(entryValue)}`).join(" | ");
  }
  return String(value);
};
const formatLabel = (value) =>
  normalizeText(value)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
const formatNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "Not Set";
  return parsed.toFixed(3).replace(/\.?0+$/, "");
};
const formatActor = (actor = {}, dateKeys = []) => {
  const name = normalizeText(actor?.name);
  const dateKey = dateKeys.find((key) => actor?.[key]);
  const date = dateKey ? formatDateDDMMYYYY(actor[dateKey]) : "";
  if (!name && !date) return "Not Set";
  return date ? `${name || "Unknown"} (${date})` : name;
};
const getFieldDisplayValue = (field = {}) => {
  const valueType = normalizeText(field?.value_type).toLowerCase();
  if (valueType === "number") return formatNumber(field?.value_number);
  if (valueType === "boolean") return formatValue(field?.value_boolean);
  if (valueType === "date") return field?.value_date ? formatDateDDMMYYYY(field.value_date) : "Not Set";
  if (valueType === "array") return formatValue(field?.value_array);
  if (field?.raw_value !== null && field?.raw_value !== undefined && field?.raw_value !== "") {
    return formatValue(field.raw_value);
  }
  return formatValue(field?.value_text);
};
const getStatusLabel = (value) => {
  const normalized = normalizeText(value).toLowerCase().replace(/\s+/g, "_");
  if (normalized === "approved") return "Approved";
  if (normalized === "checked") return "Checked";
  if (normalized === "created") return "Created";
  return "Not Set";
};
const getStatusBadgeClass = (value) => {
  const normalized = normalizeText(value).toLowerCase().replace(/\s+/g, "_");
  if (normalized === "approved") return "text-bg-success";
  if (normalized === "checked") return "text-bg-info";
  if (normalized === "created") return "text-bg-warning";
  return "text-bg-secondary";
};
const getSizeRows = (primaryRows = [], fallbackRows = []) =>
  Array.isArray(primaryRows) && primaryRows.length > 0
    ? primaryRows
    : Array.isArray(fallbackRows)
      ? fallbackRows
      : [];
const normalizeRawValues = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== "")
    .map(([key, entryValue]) => ({
      label: formatLabel(key),
      value: formatValue(entryValue),
    }));
};

const DetailCard = ({ title, children }) => (
  <div className="card om-card h-100 product-database-detail-card">
    <div className="card-body">
      <h3 className="h6 mb-3">{title}</h3>
      {children}
    </div>
  </div>
);

const KeyValueGrid = ({ rows = [] }) => (
  <div className="product-database-detail-grid">
    {rows.map((row) => (
      <div key={row.label} className="product-database-detail-field">
        <div className="small text-secondary">{row.label}</div>
        <div className="fw-semibold">{row.value || "Not Set"}</div>
      </div>
    ))}
  </div>
);

const SizeTable = ({ rows = [], type = "item" }) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return <div className="text-secondary small">No sizes stored.</div>;
  }

  return (
    <div className="table-responsive">
      <table className="table table-sm align-middle mb-0">
        <thead>
          <tr>
            <th>Remark</th>
            <th>L</th>
            <th>B</th>
            <th>H</th>
            <th>{type === "item" ? "Net Weight" : "Gross Weight"}</th>
            {type === "box" && <th>Carton Counts</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${type}-${index}-${row?.remark || row?.box_type || "entry"}`}>
              <td>{formatLabel(row?.remark || row?.box_type || `Entry ${index + 1}`)}</td>
              <td>{formatNumber(row?.L)}</td>
              <td>{formatNumber(row?.B)}</td>
              <td>{formatNumber(row?.H)}</td>
              <td>{formatNumber(type === "item" ? row?.net_weight : row?.gross_weight)}</td>
              {type === "box" && (
                <td>
                  Inner: {formatNumber(row?.item_count_in_inner)} / Master:{" "}
                  {formatNumber(row?.box_count_in_master)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ProductDatabaseDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchDetails = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.get(`/items/item-database/${id}`);
      setRow(response?.data?.data || null);
    } catch (fetchError) {
      setRow(null);
      setError(fetchError?.response?.data?.message || "Failed to fetch Product Database details.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const productDatabase = row?.product_database || {};
  const specGroups = useMemo(() => {
    const fields = Array.isArray(productDatabase?.product_specs?.fields)
      ? productDatabase.product_specs.fields
      : [];
    return fields.reduce((groups, field) => {
      const groupLabel = normalizeText(field?.group_label) || "Product Specs";
      const existing = groups.get(groupLabel) || [];
      existing.push(field);
      groups.set(groupLabel, existing);
      return groups;
    }, new Map());
  }, [productDatabase?.product_specs?.fields]);
  const rawValueRows = useMemo(
    () => normalizeRawValues(productDatabase?.product_specs?.raw_values),
    [productDatabase?.product_specs?.raw_values],
  );

  return (
    <>
      <Navbar />
      <div className="container-fluid py-4 om-page product-database-details-page">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
          <div>
            <button
              type="button"
              className="btn btn-link p-0 mb-2"
              onClick={() => navigate("/item-database")}
            >
              Back to Item Database
            </button>
            <h2 className="h4 mb-1">Product Database Details</h2>
            <div className="text-secondary small">
              {row?.item_code || "Item"} {row?.brand ? `| ${row.brand}` : ""}
            </div>
          </div>
          {row && (
            <span className={`badge ${getStatusBadgeClass(row.product_database_status)}`}>
              {getStatusLabel(row.product_database_status)}
            </span>
          )}
        </div>

        {loading && <div className="card om-card"><div className="card-body text-center">Loading...</div></div>}
        {error && <div className="alert alert-danger">{error}</div>}

        {!loading && row && (
          <div className="row g-4">
            <div className="col-xl-6">
              <DetailCard title="Item Summary">
                <KeyValueGrid
                  rows={[
                    { label: "Item Code", value: row.item_code },
                    { label: "Brand", value: row.brand || (row.brands || []).join(", ") },
                    { label: "Vendor", value: row.vendor },
                    { label: "Current Running POs", value: String(row.current_running_pos || 0) },
                    { label: "PO IDs", value: (row.current_running_po_ids || []).join(", ") || "Not Set" },
                    {
                      label: "Last Inspected Date",
                      value: row.last_inspected_date ? formatDateDDMMYYYY(row.last_inspected_date) : "Not Set",
                    },
                  ]}
                />
              </DetailCard>
            </div>

            <div className="col-xl-6">
              <DetailCard title="Basic Product Data">
                <KeyValueGrid
                  rows={[
                    { label: "Description", value: productDatabase.description },
                    { label: "Country Of Origin", value: productDatabase.country_of_origin },
                    { label: "Product Type", value: productDatabase.product_type?.label || productDatabase.product_type?.key },
                    { label: "Template Version", value: productDatabase.product_type?.version ? `v${productDatabase.product_type.version}` : "Not Set" },
                    { label: "Last Updated", value: productDatabase.updated_at ? formatDateDDMMYYYY(productDatabase.updated_at) : "Not Set" },
                  ]}
                />
              </DetailCard>
            </div>

            <div className="col-xl-6">
              <DetailCard title="Barcodes">
                <KeyValueGrid
                  rows={[
                    { label: "Single / Master Barcode", value: productDatabase.pd_master_barcode || productDatabase.pd_barcode },
                    { label: "Inner Barcode", value: productDatabase.pd_inner_barcode },
                  ]}
                />
              </DetailCard>
            </div>

            <div className="col-xl-6">
              <DetailCard title="Product Database Activity">
                <KeyValueGrid
                  rows={[
                    { label: "Created By", value: formatActor(productDatabase.pd_created_by, ["created_at"]) },
                    { label: "Checked By", value: formatActor(productDatabase.pd_checked_by, ["checked_at"]) },
                    { label: "Approved By", value: formatActor(productDatabase.pd_approved_by, ["approved_at"]) },
                    { label: "Last Changed By", value: formatActor(productDatabase.pd_last_changed_by, ["changed_at", "updated_at"]) },
                  ]}
                />
              </DetailCard>
            </div>

            <div className="col-12">
              <DetailCard title="Item Sizes">
                <SizeTable
                  rows={getSizeRows(
                    productDatabase.pd_item_sizes,
                    productDatabase.product_specs?.item_sizes,
                  )}
                  type="item"
                />
              </DetailCard>
            </div>

            <div className="col-12">
              <DetailCard title="Box Sizes">
                <div className="small text-secondary mb-2">
                  Packaging Mode: {formatLabel(productDatabase.pd_box_mode || productDatabase.product_specs?.box_mode || "individual")}
                </div>
                <SizeTable
                  rows={getSizeRows(
                    productDatabase.pd_box_sizes,
                    productDatabase.product_specs?.box_sizes,
                  )}
                  type="box"
                />
              </DetailCard>
            </div>

            {[...specGroups.entries()].map(([groupLabel, fields]) => (
              <div className="col-xl-6" key={groupLabel}>
                <DetailCard title={groupLabel}>
                  <KeyValueGrid
                    rows={fields.map((field) => ({
                      label: field?.label || formatLabel(field?.key),
                      value: getFieldDisplayValue(field),
                    }))}
                  />
                </DetailCard>
              </div>
            ))}

            {specGroups.size === 0 && (
              <div className="col-12">
                <DetailCard title="Product Specs">
                  <div className="text-secondary small">No product spec fields stored.</div>
                </DetailCard>
              </div>
            )}

            {rawValueRows.length > 0 && (
              <div className="col-12">
                <DetailCard title="Raw Product Values">
                  <KeyValueGrid rows={rawValueRows} />
                </DetailCard>
              </div>
            )}

            <div className="col-12">
              <DetailCard title="Product Database History">
                {Array.isArray(productDatabase.pd_history) && productDatabase.pd_history.length > 0 ? (
                  <div className="table-responsive">
                    <table className="table table-sm align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Action</th>
                          <th>From</th>
                          <th>To</th>
                          <th>Changed Fields</th>
                          <th>User</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productDatabase.pd_history.map((entry, index) => (
                          <tr key={`${entry?.action || "history"}-${entry?.timestamp || index}`}>
                            <td>{formatLabel(entry?.action)}</td>
                            <td>{getStatusLabel(entry?.previous_status)}</td>
                            <td>{getStatusLabel(entry?.next_status)}</td>
                            <td>{Array.isArray(entry?.changed_fields) && entry.changed_fields.length > 0 ? entry.changed_fields.map(formatLabel).join(", ") : "Not Set"}</td>
                            <td>{entry?.actor?.name || "Unknown"}</td>
                            <td>{entry?.timestamp ? formatDateDDMMYYYY(entry.timestamp) : "Not Set"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-secondary small">No Product Database history stored.</div>
                )}
              </DetailCard>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default ProductDatabaseDetails;
