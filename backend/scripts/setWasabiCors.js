require("../config/loadEnv").loadEnvFiles({ cwd: process.cwd() });

const {
  isConfigured,
  getBucketCors,
  putBucketCors,
} = require("../services/wasabiStorage.service");

const normalizeOrigin = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith("localhost:") || normalized.startsWith("127.0.0.1:")) {
    return `http://${normalized}`;
  }
  return `https://${normalized}`;
};

const parseOrigins = (argv = []) => {
  const cliOrigins = argv
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const envOrigins = String(process.env.WASABI_CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const rawOrigins = cliOrigins.length > 0
    ? cliOrigins
    : envOrigins.length > 0
      ? envOrigins
      : ["http://localhost:5173", "https://oms.ghouse-sourcing.com"];

  return [...new Set(rawOrigins.map(normalizeOrigin).filter(Boolean))];
};

const main = async () => {
  if (!isConfigured()) {
    throw new Error("Wasabi storage is not configured");
  }

  const origins = parseOrigins(process.argv.slice(2));
  if (origins.length === 0) {
    throw new Error("No valid origins were provided");
  }

  console.log("Applying Wasabi bucket CORS for origins:");
  origins.forEach((origin) => console.log(`- ${origin}`));

  const nextRules = await putBucketCors({
    allowedOrigins: origins,
    allowedMethods: ["GET", "HEAD"],
    allowedHeaders: ["*"],
    exposeHeaders: ["ETag", "Content-Length", "Content-Type"],
    maxAgeSeconds: 3600,
  });

  console.log("Bucket CORS updated successfully.");
  console.log(JSON.stringify(nextRules, null, 2));

  const currentRules = await getBucketCors();
  console.log("Verified bucket CORS:");
  console.log(JSON.stringify(currentRules, null, 2));
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
