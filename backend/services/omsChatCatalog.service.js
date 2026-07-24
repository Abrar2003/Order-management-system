const Order = require("../models/order.model");
const Item = require("../models/item.model");
const Qc = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const Sample = require("../models/sample.model");
const Brand = require("../models/brand.model");
const Vendor = require("../models/vendor.model");

const IST_OFFSET_MINUTES = 330;
const IST_TIMEZONE = "Asia/Kolkata";

const entry = (model, fields, access, description) => ({
  model,
  collection: model.collection.name,
  fields: Object.freeze([
    ...new Set([
      ...Object.keys(model.schema.paths),
      ...fields.filter((field) => field.startsWith("__oms_")),
    ]),
  ]),
  access,
  description,
});

const catalogEntries = [
  entry(
    Order,
    [
      "_id",
      "order_id",
      "item.item_code",
      "item.description",
      "brand",
      "vendor.vendor_id",
      "vendor.name",
      "vendor.country",
      "__oms_vendor_name",
      "ETD",
      "revised_ETD",
      "order_date",
      "status",
      "quantity",
      "total_po_cbm",
      "shipment._id",
      "shipment.container",
      "shipment.invoice_number",
      "shipment.stuffing_date",
      "shipment.quantity",
      "shipment.pending",
      "shipment.cases",
      "shipment.remaining_remarks",
      "shipment.checked.checked",
      "qc_record",
      "archived",
      "archived_remark",
      "archived_at",
      "archived_previous_status",
      "createdAt",
      "updatedAt",
    ],
    { brandFields: ["brand"], vendorFields: ["vendor"] },
    "Purchase-order lines, ETDs, status, quantities, shipment progress, and archive fields.",
  ),
  entry(
    Item,
    [
      "_id",
      "code",
      "name",
      "description",
      "brand",
      "brand_name",
      "brands",
      "vendors.vendor_id",
      "vendors.name",
      "vendors.country",
      "__oms_vendor_names",
      "country_of_origin",
      "pis_box_mode",
      "pis_barcode",
      "pis_master_barcode",
      "pis_inner_barcode",
      "__oms_has_pis_file",
      "pis_checked_flag",
      "barcode_exempted",
      "is_rectify_imported",
      "qc.packed_size",
      "qc.finishing",
      "qc.branding",
      "qc.barcode",
      "qc.master_barcode",
      "qc.inner_barcode",
      "qc.last_inspected_date",
      "qc.quantities.checked",
      "qc.quantities.passed",
      "qc.quantities.pending",
      "source.from_orders",
      "source.from_qc",
      "createdAt",
      "updatedAt",
    ],
    {
      brandFields: ["brand", "brand_name", "brands"],
      vendorFields: ["vendors"],
    },
    "Item master data, packaging-aware PIS/barcode state, files, and summarized QC state.",
  ),
  entry(
    Qc,
    [
      "_id",
      "order",
      "order_meta.order_id",
      "order_meta.brand",
      "order_meta.vendor.vendor_id",
      "order_meta.vendor.name",
      "order_meta.vendor.country",
      "__oms_vendor_name",
      "request_date",
      "request_type",
      "last_inspected_date",
      "item.item_code",
      "item.description",
      "barcode",
      "master_barcode",
      "inner_barcode",
      "packed_size",
      "finishing",
      "branding",
      "inspection_record",
      "quantities.client_demand",
      "quantities.quantity_requested",
      "quantities.vendor_provision",
      "quantities.qc_checked",
      "quantities.qc_passed",
      "quantities.pending",
      "quantities.qc_rejected",
      "checked.checked_at",
      "checked.checked_status",
      "createdAt",
      "updatedAt",
    ],
    {
      brandFields: ["order_meta.brand"],
      vendorFields: ["order_meta.vendor"],
    },
    "QC requests, order snapshots, quantities, images, barcode checks, and inspection relations.",
  ),
  entry(
    Inspection,
    [
      "_id",
      "qc",
      "inspection_date",
      "requested_date",
      "status",
      "vendor_requested",
      "vendor_offered",
      "checked",
      "passed",
      "pending_after",
      "cbm.box1",
      "cbm.box2",
      "cbm.box3",
      "cbm.total",
      "barcode",
      "master_barcode",
      "inner_barcode",
      "packed_size",
      "finishing",
      "branding",
      "inspected_box_mode",
      "kd",
      "goods_not_ready.ready",
      "goods_not_ready.reason",
      "createdAt",
      "updatedAt",
    ],
    { through: "qcs" },
    "Inspection visits, images, results, and quantity fields.",
  ),
  entry(
    Sample,
    [
      "_id",
      "code",
      "name",
      "description",
      "brand",
      "vendor.vendor_id",
      "vendor.name",
      "vendor.country",
      "__oms_vendor_names",
      "cbm",
      "shipment._id",
      "shipment.container",
      "shipment.invoice_number",
      "shipment.stuffing_date",
      "shipment.quantity",
      "shipment.pending",
      "shipment.cases",
      "shipment.remaining_remarks",
      "shipment.checked.checked",
      "converted_item.item",
      "converted_item.code",
      "converted_item.name",
      "converted_item.description",
      "converted_item.converted_at",
      "createdAt",
      "updatedAt",
    ],
    { brandFields: ["brand"], vendorFields: ["vendor"] },
    "Samples, files, shipment facts, CBM, and converted-item relations.",
  ),
  entry(
    Brand,
    ["_id", "name"],
    { brandDocument: true },
    "Brand details, logos, and calendar settings.",
  ),
  entry(
    Vendor,
    [
      "_id",
      "name",
      "country",
      "vendor_code.brand",
      "vendor_code.code",
      "brands.brand_id",
      "brands.brand_name",
      "default_shipping_time",
      "is_active",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
    {
      brandFields: ["brands.brand_name", "vendor_code.brand"],
      vendorFields: ["name"],
      excludeDeleted: true,
    },
    "Vendor identity, contacts, country, brand associations, codes, shipping time, and active/deleted state.",
  ),
];

const CATALOG = Object.freeze(
  Object.assign(
    Object.create(null),
    Object.fromEntries(catalogEntries.map((value) => [value.collection, value])),
  ),
);

const DENIED_COLLECTIONS = Object.freeze([
  "users",
  "auth_sessions",
  "rolepermissions",
  "security_activity_logs",
  "security_alerts",
  "user_security_baselines",
  "notifications",
  "emaillogs",
  "order_edit_logs",
  "qc_edit_logs",
  "pis_update_logs",
  "upload_logs",
  "inspectors",
  "oms_chat_conversations",
  "oms_chat_rate_buckets",
  "admin",
  "config",
  "local",
  "system.*",
]);

const getPreviousCalendarMonthRange = (now = new Date()) => {
  const shifted = new Date(now.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const startShifted = Date.UTC(year, month - 1, 1);
  const endShifted = Date.UTC(year, month, 1);
  const offsetMs = IST_OFFSET_MINUTES * 60 * 1000;

  return {
    start: new Date(startShifted - offsetMs),
    end: new Date(endShifted - offsetMs),
    timezone: IST_TIMEZONE,
  };
};

const formatIstDate = (value = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);

const buildCatalogPrompt = () =>
  catalogEntries
    .map(
      ({ collection, description, fields }) =>
        `- ${collection}: ${description}\n  Known readable fields: ${fields.join(", ")}`,
    )
    .join("\n");

const assertCatalogMatchesModels = () => {
  for (const { model, collection, fields } of catalogEntries) {
    if (!collection || collection !== model.collection.name) {
      throw new Error("OMS Assistant collection catalogue is out of sync");
    }
    for (const field of fields) {
      if (
        field === "_id"
        || field.startsWith("__oms_")
      ) {
        continue;
      }
      const direct = model.schema.path(field);
      const nestedUnderKnownPath = Object.keys(model.schema.paths).some(
        (path) => path === field || path.startsWith(`${field}.`) || field.startsWith(`${path}.`),
      );
      if (!direct && !nestedUnderKnownPath) {
        throw new Error(
          `OMS Assistant field catalogue is out of sync: ${collection}.${field}`,
        );
      }
    }
  }
};

assertCatalogMatchesModels();

module.exports = {
  CATALOG,
  DENIED_COLLECTIONS,
  IST_TIMEZONE,
  buildCatalogPrompt,
  formatIstDate,
  getPreviousCalendarMonthRange,
};
