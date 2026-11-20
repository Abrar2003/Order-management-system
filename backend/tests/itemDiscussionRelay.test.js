const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const redis = require("../config/redis");

test("the Redis discussion relay delivers once locally and across workers, resyncs on recovery, and keeps local delivery during an outage", async (t) => {
  const clients = [], receivers = [[], []];
  let available = true;
  t.mock.method(redis, "isRedisJobsEnabled", () => true);
  t.mock.method(redis, "createRedisClient", () => {
    const client = new EventEmitter(); clients.push(client);
    Object.assign(client, {
      status: "wait",
      async connect() { this.status = "ready"; this.emit("ready"); },
      async subscribe(channel) { this.channel = channel; },
      async publish(channel, raw) {
        if (!available) throw new Error("Redis unavailable");
        clients.filter((other) => other.channel === channel).forEach((other) => other.emit("message", channel, raw));
      },
      async quit() { this.closed = true; },
    });
    return client;
  });
  const filename = require.resolve("../services/itemDiscussionRelay.service");
  const load = () => { delete require.cache[filename]; return require(filename); };
  const first = load(), second = load();
  t.after(async () => { await first.closeItemDiscussionRelay(); await second.closeItemDiscussionRelay(); delete require.cache[filename]; });
  await first.startItemDiscussionRelay((payload) => receivers[0].push(payload));
  await second.startItemDiscussionRelay((payload) => receivers[1].push(payload));
  receivers.forEach((rows) => rows.splice(0));
  const message = { type: "changed", itemId: "item", topic: "autocad" };
  await first.publishItemDiscussionEvent(message);
  assert.equal(receivers[0].length, 1); assert.equal(receivers[1].length, 1);
  assert.equal(receivers[1][0].itemId, "item");
  clients[1].emit("ready");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(receivers[1].at(-1).type, "resync");
  available = false;
  t.mock.method(console, "warn", () => {});
  await first.publishItemDiscussionEvent(message);
  assert.equal(receivers[0].length, 2);
  assert.equal(receivers[1].length, 2);
  await first.closeItemDiscussionRelay(); await second.closeItemDiscussionRelay();
  assert.ok(clients.every((client) => client.closed));
});

test("a single worker without Redis still delivers discussion events", async (t) => {
  t.mock.method(redis, "isRedisJobsEnabled", () => false);
  t.mock.method(redis, "createRedisClient", () => assert.fail("Redis should be disabled"));
  const filename = require.resolve("../services/itemDiscussionRelay.service");
  delete require.cache[filename];
  const relay = require(filename), received = [];
  t.after(async () => { await relay.closeItemDiscussionRelay(); delete require.cache[filename]; });
  await relay.startItemDiscussionRelay((payload) => received.push(payload));
  await relay.publishItemDiscussionEvent({ type: "changed", itemId: "item", topic: "finish" });
  assert.equal(received.length, 1);
});
