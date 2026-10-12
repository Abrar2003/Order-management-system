const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const Zip = require("adm-zip");
const upload = require("../config/multer.config");
const storage = require("../services/wasabiStorage.service");
const converter = require("../services/convertXlsxToPDF.service");
const { officePreview } = require("../services/eudrPreview.service");

test("EUDR-only uploads accept common documents and reject macro/executable formats without broadening generic uploads", async (t) => {
  const app = express();
  app.post("/eudr", upload.eudrSingle("file"), (req, res) => res.json({ name: req.file.originalname }));
  app.post("/generic", upload.safeSingle("file"), (req, res) => res.json({ name: req.file.originalname }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = async (name, route = "eudr", type = "application/octet-stream") => {
    const body = new FormData(); body.append("file", new Blob(["test"], { type }), name);
    return fetch(`${base}/${route}`, { method: "POST", body });
  };
  for (const extension of ["pdf", "png", "jpeg", "jpg", "webp", "doc", "docx", "xls", "xlsx", "csv", "txt"]) assert.equal((await send(`test.${extension}`)).status, 200, extension);
  for (const extension of ["exe", "html", "svg", "docm", "xlsm", "pptx"]) assert.equal((await send(`test.${extension}`)).status, 400, extension);
  assert.equal((await send("test.docx", "generic")).status, 400);
  assert.equal((await send("test.pdf", "eudr", "text/html")).status, 400);
});

test("Office conversion disables active content, isolates profiles, checks output and always cleans temporary files", async () => {
  let temp;
  const runOffice = async (args, options) => {
    temp = options.sandboxDir;
    const config = await fs.readFile(path.join(temp, "profile/user/registrymodifications.xcu"), "utf8");
    assert.match(config, /DisableMacrosExecution.*true/); assert.match(config, /DisableActiveContent.*true/);
    assert.match(config, /Office.Calc\/Content\/Update.*<value>1<\/value>/); assert.match(config, /Office.Writer\/Content\/Update.*<value>2<\/value>/);
    assert.ok(args.some((arg) => arg.startsWith("-env:UserInstallation=")));
    await fs.writeFile(path.join(temp, "output/document.pdf"), "%PDF-1.7 test preview");
  };
  assert.match((await converter.convertOfficeToPdf({ buffer: Buffer.from("test"), originalName: "test.txt", runOffice })).toString(), /^%PDF/);
  assert.equal(await fs.stat(temp).catch(() => null), null);
  await assert.rejects(converter.convertOfficeToPdf({ buffer: Buffer.from("unconvertible"), originalName: "test.doc", runOffice: async (_args, options) => { temp = options.sandboxDir; } }), /corrupt, encrypted or password-protected/);
  assert.equal(await fs.stat(temp).catch(() => null), null);
  await assert.rejects(converter.convertOfficeToPdf({ buffer: Buffer.from("test"), originalName: "test.txt", runOffice: async (_args, options) => { temp = options.sandboxDir; throw new Error("timeout"); } }), /timeout/);
  assert.equal(await fs.stat(temp).catch(() => null), null);
  await assert.rejects(converter.convertOfficeToPdf({ buffer: Buffer.from("test"), originalName: "test.docm" }), /Unsupported/);
  await assert.rejects(converter.convertOfficeToPdf({ buffer: Buffer.from("bad zip"), originalName: "test.docx" }), /invalid/);
  const zip = new Zip(); zip.addFile("word/vbaProject.bin", Buffer.from("macro"));
  await assert.rejects(converter.convertOfficeToPdf({ buffer: zip.toBuffer(), originalName: "test.docx" }), /active content/);
});

test("Office preview jobs deduplicate, remain bounded, retain private derived files, and recover from failure", async (t) => {
  let release; const gate = new Promise((resolve) => { release = resolve; });
  let reads = 0; let converts = 0; const uploaded = [];
  t.mock.method(storage, "getObjectBuffer", async () => { reads += 1; await gate; return { buffer: Buffer.from("original office bytes") }; });
  t.mock.method(storage, "objectExists", async () => false);
  t.mock.method(storage, "uploadBuffer", async (options) => { uploaded.push(options); });
  t.mock.method(converter, "convertOfficeToPdf", async () => { converts += 1; return Buffer.from("%PDF-1.7 derived preview"); });
  const one = officePreview({ key: "one", name: "one.doc" });
  const same = officePreview({ key: "one", name: "one.doc" });
  const two = officePreview({ key: "two", name: "two.xls" });
  await assert.rejects(officePreview({ key: "three", name: "three.xls" }), /busy/);
  assert.equal(reads, 2); release();
  assert.deepEqual(await one, await same); await two;
  assert.equal(converts, 2); assert.match(uploaded[0].key, /^eudr-previews\/[a-f0-9]{64}\/v1\.pdf$/); assert.equal(uploaded[0].contentType, "application/pdf");
  t.mock.method(converter, "convertOfficeToPdf", async () => { throw new Error("corrupt"); });
  await assert.rejects(officePreview({ key: "bad", name: "bad.doc" }), /corrupt/);
  t.mock.method(converter, "convertOfficeToPdf", async () => Buffer.from("%PDF retry"));
  assert.match((await officePreview({ key: "bad", name: "bad.doc" })).toString(), /retry/);
});
