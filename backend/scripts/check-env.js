const path = require("path");
const { loadEnvFiles } = require("../config/loadEnv");

loadEnvFiles({
  cwd: path.resolve(__dirname, ".."),
});

const requiredVars = [
  "PORT",
  "MONGO_URI",
  "JWT_SECRET",
];

const googleVars = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "GOOGLE_REFRESH_TOKEN",
];

const wasabiVarAlternatives = {
  WASABI_ACCESS_KEY_ID: ["WASABI_ACCESS_KEY_ID", "WASABI_ACCESS_KEY"],
  WASABI_SECRET_ACCESS_KEY: [
    "WASABI_SECRET_ACCESS_KEY",
    "WASABI_ACCESS_SECRET_KEY",
  ],
  WASABI_BUCKET: ["WASABI_BUCKET", "WASABI_BUCKET_NAME"],
  WASABI_REGION: ["WASABI_REGION"],
  WASABI_ENDPOINT: ["WASABI_ENDPOINT"],
};

const isMissing = (key) => {
  const value = process.env[key];
  return value === undefined || String(value).trim() === "";
};

const missingRequired = requiredVars.filter(isMissing);

if (missingRequired.length > 0) {
  console.error("Environment check failed.");
  console.error(`Missing required variables: ${missingRequired.join(", ")}`);
  process.exit(1);
}

const missingGoogle = googleVars.filter(isMissing);
if (missingGoogle.length > 0 && missingGoogle.length < googleVars.length) {
  console.warn(
    `Partial Google config detected. Missing: ${missingGoogle.join(", ")}`,
  );
}

const isMissingAll = (keys = []) =>
  !(Array.isArray(keys) ? keys : []).some((key) => !isMissing(key));

const missingWasabi = Object.entries(wasabiVarAlternatives)
  .filter(([, keys]) => isMissingAll(keys))
  .map(([label]) => label);
if (
  missingWasabi.length > 0
  && missingWasabi.length < Object.keys(wasabiVarAlternatives).length
) {
  console.warn(
    `Partial Wasabi config detected. Missing: ${missingWasabi.join(", ")}`,
  );
}

if (
  String(process.env.NODE_ENV || "").trim().toLowerCase() === "production"
  && isMissing("CORS_ORIGIN")
) {
  console.warn(
    "CORS_ORIGIN is not set. Backend will accept requests from any origin.",
  );
}

console.log("Environment check passed.");
