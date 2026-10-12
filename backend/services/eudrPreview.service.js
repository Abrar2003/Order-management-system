const storage = require("./wasabiStorage.service");
const converter = require("./convertXlsxToPDF.service");
const { sha256 } = require("./eudrFiles.service");
const pending = new Map();

const officePreview = async (document) => {
  if (pending.has(document.key)) return pending.get(document.key);
  if (pending.size >= 2) throw Object.assign(new Error("Office preview service is busy. Retry shortly."), { statusCode: 503 });
  const job = (async () => {
    const source = await storage.getObjectBuffer(document.key);
    const hash = sha256(source.buffer);
    const key = `eudr-previews/${hash}/v1.pdf`;
    if (await storage.objectExists(key)) return (await storage.getObjectBuffer(key)).buffer;
    const buffer = await converter.convertOfficeToPdf({ buffer: source.buffer, originalName: document.name });
    await storage.uploadBuffer({ buffer, key, originalName: "preview.pdf", contentType: "application/pdf" });
    return buffer;
  })();
  pending.set(document.key, job);
  try { return await job; } finally { pending.delete(document.key); }
};
module.exports = { officePreview };
