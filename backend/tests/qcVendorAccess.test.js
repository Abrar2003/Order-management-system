const test = require("node:test");
const assert = require("node:assert/strict");
const QC = require("../models/qc.model");
const Item = require("../models/item.model");
const { getQcVendorAccess, canViewQc, ownsQc } = require("../services/qcVendorAccess.service");
const scopeItems = require("../middlewares/qcItemVendorScope.middleware");
const { applyItemDataAccess } = require("../helpers/itemQuery");
const { applyDataAccessMatch } = require("../services/userDataAccess.service");
const { cacheRoute } = require("../middlewares/cache.middleware");

const qcId = "507f1f77bcf86cd799439011";
const otherId = "507f1f77bcf86cd799439012";
const alpha = { vendor_id: "507f1f77bcf86cd799439021", name: "Alpha" };
const beta = { vendor_id: "507f1f77bcf86cd799439022", name: "Beta" };
const user = { _id: qcId, role: "QC", allowed_vendors: ["all"] };
const request = (vendor = alpha, status = "open", inspector = qcId) => ({
  inspector, order: { vendor, brand: "Brand", status: "Pending" },
  request_history: [{ status, inspector }],
});
const mockRequests = (t, rows, onPopulate = () => {}) => {
  t.mock.method(QC, "find", (query) => {
    assert.equal(query.inspector, qcId);
    return { select() { return this; }, populate(options) { onPopulate(options); return this; }, lean: async () => rows };
  });
};
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("eligible vendors use only the current open request, deduplicate and sort", async (t) => {
  mockRequests(t, [request(beta), request(alpha), request(alpha),
    ...["inspected", "rejected", "transfered", "transferred", "shifted for later"].map((status) => request(beta, status)),
    { ...request(beta), request_history: [{ status: "open", inspector: qcId }, { status: "open", inspector: otherId }] },
    { ...request(beta), order: null }, { ...request(beta), request_history: [] },
  ], ({ match }) => {
    const serialized = JSON.stringify(match);
    assert.match(serialized, /archived/);
    assert.match(serialized, /Cancelled/);
  });
  assert.deepEqual(await getQcVendorAccess(user), [alpha, beta]);
  assert.deepEqual(await getQcVendorAccess({ ...user, _id: "invalid" }), []);
  assert.equal(await getQcVendorAccess({ role: "admin" }), null);
});

test("existing brand and vendor restrictions intersect with assigned vendors", async (t) => {
  mockRequests(t, [request(alpha), request(beta)]);
  assert.deepEqual(await getQcVendorAccess({ ...user, allowed_vendors: ["Alpha"] }), [alpha]);
  assert.deepEqual(await getQcVendorAccess({ ...user, allowed_brands: [{ name: "Other brand" }] }), []);
});

test("scope chooses one assigned vendor, rejects tampering, and fails closed without requests", async (t) => {
  let rows = [request(alpha), request(beta)];
  t.mock.method(QC, "find", () => ({ select() { return this; }, populate() { return this; }, lean: async () => rows }));
  for (const vendor of [undefined, "all", beta.vendor_id, "Beta"]) {
    const req = { user, query: { vendor }, params: {} };
    const res = response(); let next = false;
    await scopeItems(req, res, () => { next = true; });
    assert.equal(next, true);
    const expected = !vendor || vendor === "all" ? alpha : beta;
    assert.deepEqual(req.user.qc_vendor_scope, [expected]);
    assert.equal(req.vendorScope.selected_vendor_id, expected.vendor_id);
    assert.deepEqual(req.vendorScope.vendors, [alpha, beta]);
    for (const match of [applyItemDataAccess({}, req.user), applyDataAccessMatch({}, req.user)]) {
      assert.match(JSON.stringify(match), new RegExp(expected.vendor_id));
    }
  }
  for (const vendor of [otherId, { $ne: "" }]) {
    const res = response();
    await scopeItems({ user, query: { vendor }, params: {} }, res, () => assert.fail("unauthorized request continued"));
    assert.equal(res.statusCode, typeof vendor === "string" ? 403 : 400);
  }
  rows = [];
  const req = { user, query: {}, params: {} };
  await scopeItems(req, response(), () => {});
  assert.deepEqual(req.user.qc_vendor_scope, []);
  assert.deepEqual(applyItemDataAccess({}, req.user), { _id: null });
});

test("another inspector's QC is viewable only while a vendor request remains open", async (t) => {
  let rows = [request(alpha)];
  t.mock.method(QC, "find", () => ({ select() { return this; }, populate() { return this; }, lean: async () => rows }));
  const otherQc = { ...request(alpha, "open", otherId) };
  assert.equal(ownsQc(user, otherQc), false);
  assert.equal(await canViewQc(user, otherQc), true);
  assert.equal(await canViewQc(user, request(beta, "open", otherId)), false);
  rows = [];
  assert.equal(await canViewQc(user, otherQc), false);
  assert.equal(await canViewQc(user, request(alpha, "inspected")), true);
});

test("QC-scoped item and QC reads bypass cached responses", async () => {
  for (const prefix of ["items", "qc"]) {
    let continued = false;
    await cacheRoute(prefix)({ method: "GET", user }, response(), () => { continued = true; });
    assert.equal(continued, true);
  }
});

test("QC document context must match the requested item and cannot open a vendor catalogue", async (t) => {
  t.mock.method(QC, "findById", () => ({ populate: async () => ({ ...request(alpha, "inspected"), item: { item_code: "ITEM.1" } }) }));
  let itemMatches = false;
  t.mock.method(Item, "exists", ({ code }) => { assert.equal(code.test("ITEMx1"), false); return itemMatches; });
  const req = { user, query: { qc_id: qcId }, params: { id: otherId } };
  const denied = response();
  await scopeItems(req, denied, () => assert.fail("unrelated item continued"));
  assert.equal(denied.statusCode, 404);
  itemMatches = true;
  await scopeItems(req, response(), () => {});
  assert.deepEqual(req.user.qc_vendor_scope, [alpha]);
  mockRequests(t, []);
  const listReq = { user, query: { qc_id: qcId }, params: {} };
  await scopeItems(listReq, response(), () => {});
  assert.deepEqual(listReq.user.qc_vendor_scope, []);
});

test("non-QC discussion contexts also validate the linked QC record", async (t) => {
  t.mock.method(QC, "findById", () => ({ populate: async () => null }));
  const res = response();
  await scopeItems({ user: { ...user, role: "viewer" }, query: { qc_id: qcId }, params: { id: otherId } }, res, () => assert.fail("unverified QC context continued"));
  assert.equal(res.statusCode, 403);
});

test("item rows, counts, options and PO lookups all receive the server vendor restriction", async (t) => {
  const { getItems, getItemOrderPresence, getItemDetails } = require("../controllers/item.controller");
  const Order = require("../models/order.model");
  mockRequests(t, [request(alpha), request(beta)]);
  const req = { user, query: { vendor: beta.vendor_id }, params: { itemCode: "SHARED-ITEM" } };
  const res = response();
  await scopeItems(req, res, () => {});
  const matches = [];
  const chain = (match, value) => {
    matches.push(match);
    return { sort() { return this; }, skip() { return this; }, limit() { return this; }, select() { return this; }, populate() { return this; }, lean: async () => value };
  };
  t.mock.method(Item, "find", (match) => chain(match, []));
  t.mock.method(Item, "countDocuments", async (match) => { matches.push(match); return 0; });
  t.mock.method(Item, "distinct", async (field, match) => { matches.push(match); return field === "vendors" ? [alpha, beta] : []; });
  await getItems(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.vendor_scope.vendors, [alpha, beta]);
  assert.deepEqual(res.body.filters.vendors, ["Alpha", "Beta"]);
  assert.equal(matches.length, 7);
  t.mock.method(Order, "find", (match) => chain(match, []));
  await getItemOrderPresence(req, response());
  t.mock.method(Item, "findOne", (match) => chain(match, null));
  const detailsRes = response();
  await getItemDetails(req, detailsRes);
  assert.equal(detailsRes.statusCode, 404);
  for (const match of matches) {
    assert.match(JSON.stringify(match), new RegExp(beta.vendor_id));
    assert.doesNotMatch(JSON.stringify(match), new RegExp(alpha.vendor_id));
  }
});

test("latest reports for shared items exclude inaccessible and archived orders", async (t) => {
  const { __test__: { buildLatestInspectionReportLookup } } = require("../controllers/item.controller");
  t.mock.method(QC, "find", (match) => {
    assert.match(JSON.stringify(match), new RegExp(alpha.vendor_id));
    return {
      select() { return this; },
      populate({ match: orderMatch }) {
        assert.match(JSON.stringify(orderMatch), /archived/);
        assert.match(JSON.stringify(orderMatch), new RegExp(alpha.vendor_id));
        return this;
      },
      lean: async () => [
        { _id: "allowed", order: { _id: "order-1" }, item: { item_code: "SHARED" }, last_inspected_date: "2026-01-01" },
        { _id: "denied", order: null, item: { item_code: "SHARED" }, last_inspected_date: "2026-02-01" },
      ],
    };
  });
  const reports = await buildLatestInspectionReportLookup(["SHARED"], { ...user, qc_vendor_scope: [alpha] });
  assert.equal(reports.get("shared").qc_id, "allowed");
});

test("additional QC viewing does not authorize running another inspector's tests", async (t) => {
  const { prepareDropTestVideo } = require("../controllers/tests.controller");
  mockRequests(t, [request(alpha)]);
  const qc = request(alpha, "open", otherId);
  assert.equal(await canViewQc(user, qc), true);
  t.mock.method(QC, "findById", () => ({ populate: async () => qc }));
  const res = response();
  await prepareDropTestVideo({ user, params: { qcId }, body: {} }, res);
  assert.equal(res.statusCode, 404);
});

test("all item read routes install vendor scoping, including history and exports", () => {
  const router = require("../routers/items.routes");
  for (const path of ["/", "/export", "/:itemCode/details", "/:itemCode/order-presence", "/:itemCode/orders-history", "/:itemId/pis-file-url"]) {
    const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods.get)?.route;
    assert.ok(route?.stack.some((layer) => layer.handle === scopeItems), path);
  }
});
