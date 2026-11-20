const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const discussionAccess = require("../middlewares/itemDiscussionAccess.middleware");
const { DISCUSSION_TOPICS } = require("../helpers/itemDiscussions");
const relay = require("../services/itemDiscussionRelay.service");

const TYPING_TTL = 5000;

const authorizeSubscription = async (socket, subscription) => {
  const req = {
    headers: { ...socket.handshake.headers,
      authorization: socket.handshake.headers.authorization || `Bearer ${socket.handshake.auth?.token || ""}` },
    params: { id: subscription.itemId, topic: subscription.topic || undefined },
    query: subscription.qcId ? { qc_id: subscription.qcId } : subscription.vendor ? { vendor: subscription.vendor } : {},
  };
  for (const middleware of discussionAccess) {
    await new Promise((resolve, reject) => {
      const res = { status(code) { this.statusCode = code; return this; }, json(body) {
        reject(Object.assign(new Error(body.message), { statusCode: this.statusCode }));
      } };
      Promise.resolve(middleware(req, res, resolve)).catch(reject);
    });
  }
  return req.user;
};

const registerItemDiscussionSocket = (io) => {
  const source = randomUUID();
  const stopTyping = (subscription) => {
    clearTimeout(subscription?.typingTimer);
    if (subscription) subscription.typingVersion = (subscription.typingVersion || 0) + 1;
    if (!subscription?.typing) return;
    subscription.typing = false;
    void relay.publishItemDiscussionEvent({ type: "typing", itemId: subscription.itemId, topic: subscription.topic,
      source: subscription.source, user: subscription.user, sequence: ++subscription.typingSequence, expiresAt: 0 });
  };
  const revoke = (socket, subscription, error) => {
    if (socket.data.discussion !== subscription) return;
    socket.data.discussion = null;
    stopTyping(subscription);
    socket.emit("discussion:access_revoked", { subscriptionId: subscription.id, message: error.message, statusCode: error.statusCode });
  };

  io.on("connection", (socket) => {
    socket.on("discussion:subscribe", async (payload, ack) => {
      if (typeof ack !== "function") return;
      if (!payload || typeof payload.id !== "string" || payload.id.length > 80 || !payload.id ||
        !mongoose.isObjectIdOrHexString(payload.itemId) ||
        (payload.topic !== "" && (typeof payload.topic !== "string" || !Object.hasOwn(DISCUSSION_TOPICS, payload.topic))) ||
        typeof payload.vendor !== "string" || payload.vendor.length > 200 ||
        typeof payload.qcId !== "string" || (payload.qcId && !mongoose.isObjectIdOrHexString(payload.qcId))) {
        return ack({ ok: false, message: "Invalid discussion subscription." });
      }
      const subscription = { id: payload.id, itemId: payload.itemId, topic: payload.topic,
        vendor: payload.vendor, qcId: payload.qcId, typingSequence: 0, source: `${source}:${socket.id}:${payload.id}` };
      stopTyping(socket.data.discussion);
      socket.data.discussion = subscription;
      try {
        const user = await authorizeSubscription(socket, subscription);
        if (!socket.connected || socket.data.discussion !== subscription) return;
        subscription.user = { id: String(user._id), name: user.name || "Unknown" };
        ack({ ok: true, userId: subscription.user.id });
      } catch (error) {
        revoke(socket, subscription, error);
        ack({ ok: false, message: error.message });
      }
    });
    socket.on("discussion:unsubscribe", (id) => {
      if (socket.data.discussion?.id !== id) return;
      stopTyping(socket.data.discussion);
      socket.data.discussion = null;
    });
    socket.on("discussion:typing", async (payload) => {
      const subscription = socket.data.discussion;
      if (!subscription?.user || !subscription.topic || payload?.subscriptionId !== subscription.id || typeof payload.typing !== "boolean") return;
      if (!payload.typing) return stopTyping(subscription);
      if (Date.now() - (subscription.lastTypingAt || 0) < 1500) return;
      subscription.lastTypingAt = Date.now();
      const typingVersion = subscription.typingVersion = (subscription.typingVersion || 0) + 1;
      try {
        const user = await authorizeSubscription(socket, subscription);
        if (socket.data.discussion !== subscription || !socket.connected || typingVersion !== subscription.typingVersion) return;
        subscription.user = { id: String(user._id), name: user.name || "Unknown" };
        subscription.typing = true;
        clearTimeout(subscription.typingTimer);
        subscription.typingTimer = setTimeout(() => stopTyping(subscription), TYPING_TTL);
        subscription.typingTimer.unref();
        void relay.publishItemDiscussionEvent({ type: "typing", itemId: subscription.itemId, topic: subscription.topic,
          source: subscription.source, user: subscription.user, sequence: ++subscription.typingSequence, expiresAt: Date.now() + TYPING_TTL });
      } catch (error) { revoke(socket, subscription, error); }
    });
    socket.on("disconnect", () => {
      stopTyping(socket.data.discussion);
      socket.data.discussion = null;
    });
  });

  return async (event) => {
    if (!["changed", "typing", "resync"].includes(event.type)) return;
    await Promise.all([...io.sockets.sockets.values()].map(async (socket) => {
      const subscription = socket.data.discussion;
      if (!subscription?.user || (event.type !== "resync" && subscription.itemId !== event.itemId) ||
        (event.type === "typing" && subscription.topic !== event.topic)) return;
      try {
        await authorizeSubscription(socket, subscription);
        if (socket.connected && socket.data.discussion === subscription) {
          socket.emit(`discussion:${event.type}`, { ...event, subscriptionId: subscription.id });
        }
      } catch (error) { revoke(socket, subscription, error); }
    }));
  };
};

module.exports = { registerItemDiscussionSocket };
