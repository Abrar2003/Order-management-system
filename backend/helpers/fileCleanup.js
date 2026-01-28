const fs = require("fs");

const deleteFile = (filePath) => {
  if (!filePath) return;

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error("File cleanup failed:", err.message);
    } else {
      console.log("Temporary file deleted:", filePath);
    }
  });
};

module.exports = deleteFile;
