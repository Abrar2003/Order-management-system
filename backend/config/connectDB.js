const dns = require("dns");
const mongoose = require("mongoose");
require("dotenv").config();

let publicDnsConfigured = false;

const isTruthy = (value) =>
  String(value || "")
    .trim()
    .toLowerCase() === "true";

const configureMongoDns = () => {
  if (publicDnsConfigured || !isTruthy(process.env.FORCE_PUBLIC_DNS)) {
    return;
  }

  const configuredServers = String(process.env.MONGO_DNS_SERVERS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const servers = configuredServers.length > 0
    ? configuredServers
    : ["1.1.1.1", "8.8.8.8"];

  dns.setServers(servers);
  publicDnsConfigured = true;
  console.log(`Using public DNS resolvers for MongoDB: ${servers.join(", ")}`);
};

const resolveMongoUri = ({ preferDirect = false } = {}) => {
  const primaryMongoUri = String(process.env.MONGO_URI || "").trim();
  const directMongoUri = String(process.env.MONGO_URI_DIRECT || "").trim();

  if (preferDirect && directMongoUri) {
    return directMongoUri;
  }

  return primaryMongoUri || directMongoUri;
};

const connectDB = async ({ preferDirect = false } = {}) => {
  configureMongoDns();

  const mongoUri = resolveMongoUri({ preferDirect });
  if (!mongoUri) {
    throw new Error("MONGO_URI is not configured");
  }

  const selectionTimeout = Number.parseInt(
    String(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || "10000"),
    10,
  );

  try {
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: Number.isFinite(selectionTimeout)
        ? selectionTimeout
        : 10000,
    });

    console.log(`Connected to MongoDB: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    const directMongoUri = String(process.env.MONGO_URI_DIRECT || "").trim();
    const isSrvLookupError =
      mongoUri.startsWith("mongodb+srv://")
      && (
        error?.syscall === "querySrv"
        || /querysrv/i.test(String(error?.message || ""))
      );

    if (!preferDirect && isSrvLookupError && directMongoUri) {
      console.warn(
        "MongoDB SRV lookup failed. Retrying with MONGO_URI_DIRECT.",
      );
      return connectDB({ preferDirect: true });
    }

    if (isSrvLookupError && !directMongoUri) {
      error.message = `${error.message}\nSet MONGO_URI_DIRECT to a non-SRV MongoDB URI if your network blocks SRV DNS lookups.`;
    }

    throw error;
  }
};

module.exports = connectDB;
