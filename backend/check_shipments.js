require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('./models/order.model');

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
  
  console.log('Total orders found:', orders.length);
  
  orders.forEach(o => {
    const shipmentCount = o.shipment?.length || 0;
    const rowCount = shipmentCount > 0 ? shipmentCount : 1;
    console.log(`  - PO: ${o.order_id}, Item: ${o.item.item_code}, Status: ${o.status}, Shipments: ${shipmentCount}, Rows: ${rowCount}`);
  });
  
  const totalRows = orders.reduce((sum, o) => {
    const shipmentCount = o.shipment?.length || 0;
    return sum + (shipmentCount > 0 ? shipmentCount : 1);
  }, 0);
  
  console.log('\nTotal shipment rows that should be created:', totalRows);
  
  await mongoose.disconnect();
}

check().catch(console.error);