const mongoose = require("mongoose");
require("dotenv").config();

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://Odin:rlkn4AwxLwHCmgq6@cluster0.azottng.mongodb.net/OMS?appName=Cluster0";

async function main() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  const item = await db.collection("items").findOne({ code: "DL-1719" });
  console.log("DL-1719 item sizes:", JSON.stringify(item.inspected_item_sizes, null, 2));
  console.log("DL-1719 box sizes:", JSON.stringify(item.inspected_box_sizes, null, 2));
  await mongoose.disconnect();
}

main().catch(console.error);
