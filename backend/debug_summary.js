require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('./models/order.model');

const normalizeShipmentInvoiceNumber = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "N/A";
  if (normalized === "n/a" || normalized === "na") return "N/A";
  return String(value || "").trim();
};

const mapOrdersToShipmentRows = (orders = []) =>
  orders.flatMap((order) => {
    const shipmentEntries = Array.isArray(order?.shipment)
      ? order.shipment
      : [];
    const parsedOrderQuantity = Number(order?.quantity);
    const normalizedOrderQuantity = Number.isFinite(parsedOrderQuantity)
      ? parsedOrderQuantity
      : 0;

    const baseRow = {
      _id: order?._id || null,
      order_id: order?.order_id || "",
      brand: order?.brand || "",
      vendor: order?.vendor || "",
      ETD: order?.ETD || null,
      order_date: order?.order_date || null,
      updatedAt: order?.updatedAt || null,
      item: {
        item_code: order?.item?.item_code || "",
        description: order?.item?.description || "",
      },
      item_code: order?.item?.item_code || "",
      description: order?.item?.description || "",
      order_quantity: normalizedOrderQuantity,
      shipment: shipmentEntries,
      status: order?.status || "",
    };

    if (shipmentEntries.length === 0) {
      return [
        {
          ...baseRow,
          shipment_id: null,
          stuffing_date: null,
          container: "",
          invoice_number: "N/A",
          quantity: normalizedOrderQuantity,
          pending: normalizedOrderQuantity,
          remaining_remarks: "",
        },
      ];
    }

    return shipmentEntries.map((entry, index) => {
      const parsedShipmentQuantity = Number(entry?.quantity);
      const parsedPending = Number(entry?.pending);

      return {
        ...baseRow,
        shipment_id: entry?._id || `${order?._id || "order"}-${index}`,
        stuffing_date: entry?.stuffing_date || null,
        container: entry?.container || "",
        invoice_number: normalizeShipmentInvoiceNumber(entry?.invoice_number),
        quantity: Number.isFinite(parsedShipmentQuantity)
          ? parsedShipmentQuantity
          : 0,
        pending: Number.isFinite(parsedPending) ? parsedPending : 0,
        remaining_remarks: entry?.remaining_remarks || "",
      };
    });
  });

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const SHIPMENT_VISIBLE_STATUSES = ['Inspection Done', 'Partial Shipped', 'Shipped', 'Under Inspection'];
  
  const searchContainer = 'OOCU-908523-1';
  const escaped = searchContainer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  const match = {
    archived: false,
    'item.item_code': { $exists: true, $ne: null },
    status: { $in: SHIPMENT_VISIBLE_STATUSES },
    'shipment.container': { $regex: escaped, $options: 'i' },
  };
  
  const orders = await Order.find(match)
    .select('order_id item brand vendor ETD status quantity shipment order_date updatedAt')
    .sort({ order_date: -1, updatedAt: -1, order_id: -1 })
    .lean();
  
  const rows = mapOrdersToShipmentRows(orders);
  
  const containerNeedle = searchContainer.toLowerCase();
  const containerFilteredRows = rows.filter((row) =>
    String(row?.container || "")
      .toLowerCase()
      .includes(containerNeedle),
  );
  
  const summary = containerFilteredRows.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row?.status === "Pending") acc.pending += 1;
      if (row?.status === "Under Inspection") acc.underInspection += 1;
      if (row?.status === "Inspection Done") acc.inspectionDone += 1;
      if (row?.status === "Partial Shipped") acc.partialShipped += 1;
      if (row?.status === "Shipped") acc.shipped += 1;
      return acc;
    },
    {
      total: 0,
      pending: 0,
      underInspection: 0,
      inspectionDone: 0,
      partialShipped: 0,
      shipped: 0,
    },
  );
  
  console.log('Summary:', summary);
  console.log('Total rows:', containerFilteredRows.length);
  
  // Show status breakdown
  const statuses = {};
  containerFilteredRows.forEach(r => {
    statuses[r.status] = (statuses[r.status] || 0) + 1;
  });
  console.log('Rows by status:', statuses);
  
  // Check specifically for items
  const with8824295 = containerFilteredRows.filter(r => r.item_code === '8824295');
  const with8825181 = containerFilteredRows.filter(r => r.item_code === '8825181');
  
  console.log('\nItem 8824295 rows:', with8824295.length);
  console.log('Item 8825181 rows:', with8825181.length);
  
  await mongoose.disconnect();
}

check().catch(console.error);