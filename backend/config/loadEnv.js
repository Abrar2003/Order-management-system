const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const normalizeEnvName = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized;
};

const getEnvFileNames = (envName) => {
  const normalizedEnv = normalizeEnvName(envName);
  const hasExplicitEnv = Boolean(normalizedEnv);
  const isTestingEnv = normalizedEnv === "test" || normalizedEnv === "testing";

  const fileNames = [".env"];
  if (!isTestingEnv) {
    fileNames.push(".env.local");
  }
  if (hasExplicitEnv) {
    fileNames.push(`.env.${normalizedEnv}`);
    fileNames.push(`.env.${normalizedEnv}.local`);
  }

  return fileNames;
};

const loadEnvFiles = ({
  cwd = process.cwd(),
  envName = process.env.NODE_ENV,
  preserveExistingEnv = false,
} = {}) => {
  const existingEnv = preserveExistingEnv ? { ...process.env } : null;
  const normalizedEnv = normalizeEnvName(envName);
  if (normalizedEnv) {
    process.env.NODE_ENV = normalizedEnv;
  }

  const loadedFiles = [];
  const fileNames = getEnvFileNames(normalizedEnv);

  for (const fileName of fileNames) {
    const envPath = path.resolve(cwd, fileName);
    if (!fs.existsSync(envPath)) continue;

    dotenv.config({
      path: envPath,
      override: true,
    });
    loadedFiles.push(envPath);
  }

  if (existingEnv) {
    for (const [key, value] of Object.entries(existingEnv)) {
      process.env[key] = value;
    }
  }

  return {
    env: normalizedEnv || "default",
    loadedFiles,
  };
};

module.exports = {
  normalizeEnvName,
  getEnvFileNames,
  loadEnvFiles,
};
