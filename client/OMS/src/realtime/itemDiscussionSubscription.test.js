import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { subscribeItemDiscussion } from "./itemDiscussionSubscription.js";

const fixture = (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 10000 });
  const listeners = new EventEmitter(), sent = [], changes = [], statuses = [], typers = [], auth = [];
  const socket = {
    connected: true,
    on: (name, fn) => listeners.on(name, fn), off: (name, fn) => listeners.off(name, fn),
    timeout() { return this; },
    emit(name, ...args) {
      sent.push([name, ...args]);
      if (name === "discussion:subscribe") args[1](null, { ok: true, userId: "me" });
    },
  };
  socket.volatile = socket;
  const subscription = subscribeItemDiscussion({ socket, itemId: "item-1", vendor: "vendor-1", qcId: "", topic: "autocad",
    onChange: () => changes.push(true), onStatus: (value) => statuses.push(value), onTyping: (value) => typers.push(value),
    onAuthExpired: () => auth.push(true),
  });
  t.after(() => subscription.close());
  const id = sent[0][1].id;
  const receive = (name, payload) => listeners.emit(name, { subscriptionId: id, itemId: "item-1", topic: "autocad", ...payload });
  return { socket, listeners, sent, changes, statuses, typers, subscription, id, receive, auth };
};

test("live changes coalesce and reconnect subscribes again before refreshing", (t) => {
  const f = fixture(t);
  assert.equal(f.statuses.at(-1), "Live");
  assert.equal(f.changes.length, 1);
  f.receive("discussion:changed"); f.receive("discussion:changed");
  f.receive("discussion:changed", { subscriptionId: "old-page" });
  t.mock.timers.tick(150);
  assert.equal(f.changes.length, 2);
  f.listeners.emit("disconnect");
  assert.equal(f.statuses.at(-1), "Reconnecting…");
  f.listeners.emit("connect");
  assert.equal(f.sent.filter(([name]) => name === "discussion:subscribe").length, 2);
  assert.equal(f.changes.length, 3);
});

test("typing is throttled, excludes draft text, and stops after inactivity or blur", (t) => {
  const f = fixture(t);
  f.subscription.setTyping(true); f.subscription.setTyping(true);
  const typing = () => f.sent.filter(([name]) => name === "discussion:typing");
  assert.deepEqual(typing().map(([, payload]) => payload), [{ subscriptionId: f.id, typing: true }]);
  t.mock.timers.tick(1800); f.subscription.setTyping(true);
  assert.equal(typing().length, 2);
  t.mock.timers.tick(2200);
  assert.equal(typing().at(-1)[1].typing, false);
  f.subscription.setTyping(true); f.subscription.setTyping(false);
  assert.equal(typing().at(-1)[1].typing, false);
});

test("typing displays other users once across tabs, ignores other topics, expires, and rejects out-of-order starts", (t) => {
  const f = fixture(t);
  const update = (source, id, sequence, expiresAt = Date.now() + 5000) => f.receive("discussion:typing", {
    source, user: { id, name: id === "bob" ? "Bob" : "Me" }, sequence, expiresAt,
  });
  update("my-tab", "me", 1); update("bob-tab-1", "bob", 1); update("bob-tab-2", "bob", 1);
  assert.deepEqual(f.typers.at(-1), ["Bob"]);
  update("bob-tab-1", "bob", 2, 0);
  assert.deepEqual(f.typers.at(-1), ["Bob"]);
  update("bob-tab-2", "bob", 2, 0);
  update("bob-tab-2", "bob", 1);
  assert.deepEqual(f.typers.at(-1), []);
  f.receive("discussion:typing", { source: "other", topic: "finish", user: { id: "bob", name: "Bob" }, sequence: 1, expiresAt: Date.now() + 5000 });
  assert.deepEqual(f.typers.at(-1), []);
  update("bob-tab-2", "bob", 3);
  t.mock.timers.tick(5000);
  assert.deepEqual(f.typers.at(-1), []);
});

test("closing removes only discussion listeners and never disconnects shared notifications", (t) => {
  const f = fixture(t), notification = () => {};
  f.listeners.on("notification:new", notification);
  f.subscription.setTyping(true);
  f.subscription.close();
  assert.equal(f.socket.connected, true);
  assert.deepEqual(f.listeners.eventNames(), ["notification:new"]);
  assert.deepEqual(f.sent.at(-1), ["discussion:unsubscribe", f.id]);
});

test("revocation clears typing and reloads through HTTP; expired authentication requests renewal", (t) => {
  const f = fixture(t);
  f.receive("discussion:typing", { source: "bob", user: { id: "bob", name: "Bob" }, sequence: 1, expiresAt: Date.now() + 5000 });
  f.receive("discussion:access_revoked", { statusCode: 401 });
  assert.deepEqual(f.typers.at(-1), []);
  assert.equal(f.statuses.at(-1), "Live access unavailable");
  assert.equal(f.changes.length, 2);
  assert.equal(f.auth.length, 1);
  f.subscription.setTyping(true);
  assert.equal(f.sent.filter(([name]) => name === "discussion:typing").length, 0);
});

test("expired reconnect authentication renews the session, and stale subscription acknowledgements are ignored", (t) => {
  const f = fixture(t), acknowledgements = [];
  f.listeners.emit("connect_error", { data: { statusCode: 401 } });
  assert.equal(f.auth.length, 1);
  f.socket.emit = (name, _payload, ack) => { if (name === "discussion:subscribe") acknowledgements.push(ack); };
  f.listeners.emit("connect");
  f.listeners.emit("disconnect");
  f.listeners.emit("connect");
  acknowledgements[1](null, { ok: true, userId: "me" });
  acknowledgements[0](new Error("Old request timed out"));
  assert.equal(f.statuses.at(-1), "Live");
});
