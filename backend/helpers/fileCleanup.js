const fs = require("fs");

const deleteFile = (filePath) => {
  if (!filePath) return;

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error("File cleanup failed:", err.message);
    }
  });
};

module.exports = deleteFile;
