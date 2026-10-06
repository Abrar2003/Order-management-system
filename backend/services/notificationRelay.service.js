const {
  createRedisClient,
  isRedisJobsEnabled,
} = require("../config/redis");

const CHANNEL = "oms:notifications";
let publisher = null;
let subscriber = null;

const connect = async (client) => {
  if (client.status === "wait") await client.connect();
  return client;
};

const publishNotificationEvent = async (event) => {
  if (!isRedisJobsEnabled()) return false;
  try {
    publisher = publisher || createRedisClient({ label: "notification-publisher" });
    await (await connect(publisher)).publish(CHANNEL, JSON.stringify(event));
    return true;
  } catch (error) {
    console.warn("Notification relay publish failed:", error?.message || String(error));
    return false;
  }
};

const startNotificationRelay = async (io) => {
  if (!io || !isRedisJobsEnabled() || subscriber) return;
  subscriber = createRedisClient({ label: "notification-relay" });
  await connect(subscriber);
  await subscriber.subscribe(CHANNEL);
  subscriber.on("message", (_channel, raw) => {
    try {
      const event = JSON.parse(raw);
      if (!event?.userId) return;
      const room = `notification:user:${event.userId}`;
      if (event.notification) io.to(room).emit("notification:new", event.notification);
      io.to(room).emit("notification:unread_count", { unreadCount: Number(event.unreadCount || 0) });
    } catch (error) {
      console.warn("Notification relay message failed:", error?.message || String(error));
    }
  });
};

const closeNotificationRelay = async () => {
  const clients = [publisher, subscriber].filter(Boolean);
  publisher = null;
  subscriber = null;
  await Promise.allSettled(clients.map((client) => client.quit().catch(() => client.disconnect())));
};

module.exports = { closeNotificationRelay, publishNotificationEvent, startNotificationRelay };
