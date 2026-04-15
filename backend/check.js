require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('./models/order.model');

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const orders = await Order.find({
    shipment: { $exists: true, $ne: [] }
  }).select('order_id status shipment').lean();
  
  const statusCount = {};
  orders.forEach(o => {
    statusCount[o.status] = (statusCount[o.status] || 0) + 1;
  });
  console.log('Statuses for orders with shipments:', statusCount);
  
  const shippedOrders = orders.filter(o => o.status === 'Shipped');
  console.log('Shipped orders with shipments:', shippedOrders.length);
  
  const shippedWithoutContainer = shippedOrders.filter(o => 
    o.shipment.some(s => !s.container || s.container.trim() === '')
  );
  console.log('Shipped orders with some shipments without container:', shippedWithoutContainer.length);
  
  await mongoose.disconnect();
}

check().catch(console.error);