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

if (
  String(process.env.NODE_ENV || "").trim().toLowerCase() === "production"
  && isMissing("CORS_ORIGIN")
) {
  console.warn(
    "CORS_ORIGIN is not set. Backend will accept requests from any origin.",
  );
}

console.log("Environment check passed.");
