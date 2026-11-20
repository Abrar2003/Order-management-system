const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { createRequire } = require("node:module");
const { io: client } = createRequire(require.resolve("../../client/OMS/package.json"))("socket.io-client");
const User = require("../models/user.model");
const Item = require("../models/item.model");
const QC = require("../models/qc.model");
const RolePermission = require("../models/rolePermission.model");
const relay = require("../services/itemDiscussionRelay.service");
const { signAccessToken } = require("../services/authToken.service");
const { createNotificationSocketServer } = require("../realtime/notificationSocket");
const { registerItemDiscussionSocket } = require("../realtime/itemDiscussionSocket");

const itemId = "507f1f77bcf86cd799439031";
const qcId = "507f1f77bcf86cd799439041";
const alpha = { vendor_id: "507f1f77bcf86cd799439021", name: "Alpha" };
const beta = { vendor_id: "507f1f77bcf86cd799439022", name: "Beta" };
const users = [
  { _id: "507f1f77bcf86cd799439011", role: "QC", name: "Alice", allowed_vendors: ["all"] },
  { _id: "507f1f77bcf86cd799439012", role: "QC", name: "Bob", allowed_vendors: ["all"] },
];
const chain = (value) => ({ select() { return this; }, populate() { return this; }, lean: async () => value });
const subscribe = (socket, topic = "autocad", extra = {}) => socket.timeout(3000).emitWithAck("discussion:subscribe", {
  id: "test-subscription", itemId, vendor: alpha.vendor_id, qcId: "", topic, ...extra,
});
const event = (socket, name) => once(socket, name, { signal: AbortSignal.timeout(3000) }).then(([value]) => value);

const fixture = async (t) => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "local-socket-test-secret";
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  let eligible = true;
  let itemVisible = true;
  let qcMatchesItem = true;
  t.mock.method(User, "findById", (id) => chain(users.find((user) => user._id === String(id))));
  t.mock.method(RolePermission, "findOne", () => chain(null));
  t.mock.method(QC, "find", ({ inspector }) => chain(eligible ? [{ inspector,
    order: { vendor: alpha, brand: "Brand" }, request_history: [{ inspector, status: "open" }],
  }] : []));
  t.mock.method(QC, "findById", () => ({ populate: async () => ({ inspector: users[0]._id,
    order: { vendor: alpha, brand: "Brand" }, item: { item_code: "ITEM-1" },
  }) }));
  t.mock.method(Item, "exists", async () => qcMatchesItem);
  t.mock.method(Item, "findOne", (match) => {
    assert.match(JSON.stringify(match), /Alpha/);
    return chain(itemVisible ? { _id: itemId, code: "ITEM-1" } : null);
  });
  const server = http.createServer();
  const io = createNotificationSocketServer({ server, allowedOrigins: ["http://localhost"], allowCredentials: true });
  const receive = registerItemDiscussionSocket(io);
  const published = [];
  t.mock.method(relay, "publishItemDiscussionEvent", async (payload) => { published.push(payload); await receive(payload); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];
  const connect = async (user = users[0], options = {}) => {
    const socket = client(url, { transports: ["websocket"], auth: { token: signAccessToken(user) }, forceNew: true,
      reconnection: false, ...options });
    sockets.push(socket);
    await once(socket, "connect", { signal: AbortSignal.timeout(3000) });
    return socket;
  };
  t.after(async () => { sockets.forEach((socket) => socket.disconnect()); await io.close(); });
  return { io, connect, receive, published, url, setEligible: (value) => { eligible = value; },
    setItemVisible: (value) => { itemVisible = value; }, setQcMatches: (value) => { qcMatchesItem = value; } };
};

test("live discussions require authentication, a valid topic, and the current vendor scope", async (t) => {
  const f = await fixture(t);
  const anonymous = client(f.url, { transports: ["websocket"], reconnection: false });
  const authenticationError = await event(anonymous, "connect_error");
  assert.match(authenticationError.message, /jwt|token/i);
  assert.equal(authenticationError.data.statusCode, 401);
  anonymous.disconnect();
  const socket = await f.connect();
  assert.equal((await subscribe(socket, "arbitrary-topic")).ok, false);
  assert.equal((await subscribe(socket, "autocad", { vendor: beta.vendor_id })).ok, false);
  assert.equal((await subscribe(socket)).ok, true);
  f.setItemVisible(false);
  assert.equal((await subscribe(socket)).ok, false);
});

test("authorized viewers get live invalidations, while unrelated items and unsubscribed viewers do not", async (t) => {
  const f = await fixture(t), alice = await f.connect(), bob = await f.connect(users[1]);
  await subscribe(alice); await subscribe(bob, "finish");
  const received = [];
  bob.on("discussion:changed", (payload) => received.push(payload));
  const notification = event(alice, "discussion:changed"), bobNotification = event(bob, "discussion:changed");
  await f.receive({ type: "changed", itemId, topic: "autocad" });
  assert.equal((await notification).topic, "autocad");
  await bobNotification;
  assert.equal(received.length, 1);
  await f.receive({ type: "changed", itemId: qcId, topic: "autocad" });
  bob.emit("discussion:unsubscribe", "test-subscription");
  await subscribe(bob, "invalid-topic"); // Round-trip on this socket waits for the prior unsubscribe.
  await f.receive({ type: "changed", itemId, topic: "finish" });
  assert.equal(received.length, 1);
  const notice = event(bob, "notification:new");
  f.io.to(`notification:user:${users[1]._id}`).emit("notification:new", { title: "Still connected" });
  assert.equal((await notice).title, "Still connected");
});

test("typing uses the authenticated name, stays in its topic, and clears on disconnect", async (t) => {
  const f = await fixture(t), alice = await f.connect(), bob = await f.connect(users[1]);
  await subscribe(alice); await subscribe(bob);
  const typing = event(bob, "discussion:typing");
  alice.emit("discussion:typing", { subscriptionId: "test-subscription", typing: true, user: { name: "Forged" }, text: "Private draft" });
  const payload = await typing;
  assert.deepEqual(payload.user, { id: users[0]._id, name: "Alice" });
  assert.equal(payload.text, undefined);
  assert.ok(payload.expiresAt > Date.now());
  const stopped = event(bob, "discussion:typing");
  alice.disconnect();
  assert.equal((await stopped).expiresAt, 0);
  await subscribe(bob, "finish");
  const otherTopic = [];
  bob.on("discussion:typing", (value) => otherTopic.push(value));
  await f.receive({ type: "typing", itemId, topic: "autocad", user: payload.user, expiresAt: Date.now() + 5000 });
  assert.equal(otherTopic.length, 0);
});

test("reassignment/completion revokes an existing subscription before either updates or typing are delivered", async (t) => {
  const f = await fixture(t), socket = await f.connect();
  await subscribe(socket);
  const changed = [];
  socket.on("discussion:changed", (value) => changed.push(value));
  f.setEligible(false);
  const revoked = event(socket, "discussion:access_revoked");
  await f.receive({ type: "changed", itemId, topic: "autocad" });
  assert.equal((await revoked).statusCode, 403);
  assert.equal(changed.length, 0);
  socket.emit("discussion:typing", { subscriptionId: "test-subscription", typing: true });
  await subscribe(socket);
  assert.equal(f.published.length, 0);
});

test("QC detail context retains own-record access, validates the item link, and rejects another inspector after revocation", async (t) => {
  const f = await fixture(t), alice = await f.connect(), bob = await f.connect(users[1]);
  f.setEligible(false);
  assert.equal((await subscribe(alice, "autocad", { qcId })).ok, true);
  assert.equal((await subscribe(bob, "autocad", { qcId })).ok, false);
  f.setQcMatches(false);
  assert.equal((await subscribe(alice, "autocad", { qcId })).ok, false);
});

test("WebSocket connections reject an untrusted browser origin", async (t) => {
  const f = await fixture(t);
  const socket = client(f.url, { transports: ["websocket"], auth: { token: signAccessToken(users[0]) },
    extraHeaders: { Origin: "https://untrusted.example" }, reconnection: false });
  assert.match((await event(socket, "connect_error")).message, /websocket/i);
  socket.disconnect();
});
