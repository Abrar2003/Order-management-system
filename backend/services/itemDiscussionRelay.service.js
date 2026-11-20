const { randomUUID } = require("node:crypto");
const { createRedisClient, isRedisJobsEnabled } = require("../config/redis");

const CHANNEL = "oms:item-discussions";
const origin = randomUUID();
let publisher, subscriber, receive;
const connect = async (client) => {
  if (client.status === "wait") await client.connect();
  return client;
};
const deliver = async (event) => {
  try { await receive?.(event); }
  catch (error) { console.warn("Discussion live delivery failed:", error.message); }
};

const publishItemDiscussionEvent = async (event) => {
  // Local readers still receive updates when Redis is disabled or temporarily unavailable.
  void deliver(event);
  if (!isRedisJobsEnabled()) return;
  try {
    publisher ||= createRedisClient({ label: "discussion-publisher" });
    await (await connect(publisher)).publish(CHANNEL, JSON.stringify({ ...event, origin }));
  } catch (error) { console.warn("Discussion relay publish failed:", error.message); }
};

const startItemDiscussionRelay = async (receiver) => {
  receive = receiver;
  if (!isRedisJobsEnabled() || subscriber) return;
  subscriber = createRedisClient({ label: "discussion-relay" });
  subscriber.on("message", (_channel, raw) => {
    try {
      const event = JSON.parse(raw);
      if (event.origin !== origin) void deliver(event);
    } catch (error) { console.warn("Discussion relay message failed:", error.message); }
  });
  // Reconcile anything missed while the cross-worker relay was disconnected.
  subscriber.on("ready", () => {
    subscriber.subscribe(CHANNEL).then(() => deliver({ type: "resync" }))
      .catch((error) => console.warn("Discussion relay subscription failed:", error.message));
  });
  await connect(subscriber);
  await subscriber.subscribe(CHANNEL);
};

const closeItemDiscussionRelay = async () => {
  const clients = [publisher, subscriber].filter(Boolean);
  publisher = subscriber = receive = null;
  await Promise.allSettled(clients.map((client) => client.quit().catch(() => client.disconnect())));
};

module.exports = { publishItemDiscussionEvent, startItemDiscussionRelay, closeItemDiscussionRelay };
