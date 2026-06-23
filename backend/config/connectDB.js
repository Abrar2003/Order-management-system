const mongoose = require("mongoose");
require("dotenv").config();

mongoose.set("transactionAsyncLocalStorage", true);

const connectDB = async () => {
  const mongoUri = String(process.env.MONGO_URI || "").trim();
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

  try {
    const hello = await conn.connection.db.admin().command({ hello: 1 });
    const supportsTransactions = Boolean(
      hello?.logicalSessionTimeoutMinutes != null &&
        (hello?.setName || hello?.msg === "isdbgrid"),
    );
    conn.connection.$supportsTransactions = supportsTransactions;
    console.log(
      `MongoDB transactions: ${supportsTransactions ? "supported" : "unsupported"}`,
    );
  } catch (error) {
    conn.connection.$supportsTransactions = null;
    console.warn("Could not determine MongoDB transaction support:", {
      error: error?.message || String(error),
    });
  }

  console.log(`Connected to MongoDB: ${conn.connection.host}`);
  return conn;
};

module.exports = connectDB;
