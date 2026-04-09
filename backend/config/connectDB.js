const mongoose = require("mongoose");
require("dotenv").config();

const connectDB = async () => {
  const mongoUri = String(process.env.MONGO_URI || "").trim();
  console.log(mongoUri ? "MONGO_URI is configured" : "MONGO_URI is not configured", mongoUri);
  if (!mongoUri) {
    throw new Error("MONGO_URI is not configured");
  }

  const selectionTimeout = Number.parseInt(
    String(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || "10000"),
    10,
  );

  const conn = await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: Number.isFinite(selectionTimeout)
      ? selectionTimeout
      : 10000,
  });

  console.log(`Connected to MongoDB: ${conn.connection.host}`);
  return conn;
};

module.exports = connectDB;