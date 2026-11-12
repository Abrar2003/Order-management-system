const documents = require("../services/orderReferenceDocuments.service");
const { userHasPermission } = require("../services/permission.service");
const { assertBrandVendorAssociations, assertUserDataAccess } = require("../services/userDataAccess.service");
const { resolveVendorFromInput } = require("../helpers/vendorRef");

const handle = (action) => async (req, res) => {
  try {
    await action(req, res);
  } catch (error) {
    if (!error.statusCode) console.error("Order reference documents failed", error);
    res.status(error.statusCode || 502).json({
      message: error.statusCode ? error.message : "Could not complete the document request. Retry shortly.",
      ...(error.statusCode && error.code ? { code: error.code } : {}),
    });
  }
};

const scopedGroup = async (req) => documents.groupKey(
  await documents.activeOrder(req.params.id, req.user),
);

exports.prepare = handle(async (req, res) => {
  const { order_row_id: orderRow, po, files } = req.body || {};
  const permission = orderRow ? "edit" : "create";
  if (!await userHasPermission(req.user, "orders", permission)) {
    return res.status(403).json({ message: "You cannot upload order reference documents here." });
  }
  let target;
  if (orderRow) {
    target = await documents.activeOrder(orderRow, req.user);
  } else {
    const { order_id, brand, vendor } = po || {};
    if (![order_id, brand, vendor].every((value) => typeof value === "string" && value.trim())) {
      return res.status(400).json({ message: "Enter the PO number, brand, and vendor before uploading." });
    }
    await assertBrandVendorAssociations([{ brand, vendor }]);
    const vendorRef = await resolveVendorFromInput(vendor);
    assertUserDataAccess(req.user, { brands: [brand], vendors: [vendorRef] });
    target = { order_id, brand, vendor: vendorRef };
  }
  const upload = await documents.prepareUpload({ po: target, orderRow, files, user: req.user });
  res.status(201).json(upload);
});

exports.list = handle(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await documents.listBatches(await scopedGroup(req), req.user));
});

exports.commit = handle(async (req, res) => {
  await documents.appendBatch(req.params.id, req.body?.upload_id, req.user);
  res.status(204).end();
});

exports.link = handle(async (req, res) => {
  const url = await documents.fileLink(await scopedGroup(req), req.params.fileId, req.query.download === "1");
  res.set("Cache-Control", "no-store");
  res.redirect(302, url);
});

exports.comment = handle(async (req, res) => {
  const comment = await documents.addComment(await scopedGroup(req), req.params.fileId, req.body?.text, req.user);
  res.status(201).json(comment);
});
