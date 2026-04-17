const fs = require("fs");
const fsp = require("fs/promises");

const deleteFile = (filePath) => {
  if (!filePath) return;

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error("File cleanup failed:", err.message);
    }
  });
};

const safeDeleteFile = async (filePath) => {
  if (!filePath) return false;

  try {
    await fsp.unlink(filePath);
    return true;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error("File cleanup failed:", error?.message || String(error));
    }
    return false;
  }
};

const ensureDirectory = async (dirPath) => {
  if (!dirPath) return;
  await fsp.mkdir(dirPath, { recursive: true });
};

module.exports = deleteFile;
module.exports.safeDeleteFile = safeDeleteFile;
module.exports.ensureDirectory = ensureDirectory;
