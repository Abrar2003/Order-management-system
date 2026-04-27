const Redis = require("ioredis");

const redisClients = new Set();
const lastLogAt = new Map();

const normalizeText = (value) => String(value ?? "").trim();

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase(),
  );
};

const parseInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const logThrottled = (key, level, message, payload = {}, intervalMs = 60000) => {
  const now = Date.now();
  const previous = Number(lastLogAt.get(key) || 0);
  if (previous && now - previous < intervalMs) return;
  lastLogAt.set(key, now);

  const logger = console[level] || console.log;
  logger(message, payload);
};

const parseRedisUrl = (redisUrl = "") => {
  const normalizedUrl = normalizeText(redisUrl);
  if (!normalizedUrl) return null;

  try {
    const parsed = new URL(normalizedUrl);
    const dbFromPath = parsed.pathname
      ? Number.parseInt(parsed.pathname.replace("/", ""), 10)
      : Number.NaN;

    return {
      host: parsed.hostname || "127.0.0.1",
      port: parseInteger(parsed.port, 6379),
      username: decodeURIComponent(parsed.username || ""),
      password: decodeURIComponent(parsed.password || ""),
      db: Number.isFinite(dbFromPath) ? dbFromPath : 0,
      tls: parsed.protocol === "rediss:" ? {} : undefined,
    };
  } catch (error) {
    logThrottled("redis-url-parse", "warn", "[redis] Invalid REDIS_URL", {
      message: error?.message || String(error),
    });
    return null;
  }
};

const getRedisConnectionOptions = ({ forBullMq = false, connectionName = "" } = {}) => {
  const urlOptions = parseRedisUrl(process.env.REDIS_URL);
  const useTls = parseBoolean(process.env.REDIS_TLS, Boolean(urlOptions?.tls));
  const baseOptions = urlOptions || {
    host: normalizeText(process.env.REDIS_HOST) || "127.0.0.1",
    port: parseInteger(process.env.REDIS_PORT, 6379),
    password: normalizeText(process.env.REDIS_PASSWORD),
    db: parseInteger(process.env.REDIS_DB, 0),
  };

  const options = {
    host: baseOptions.host || "127.0.0.1",
    port: parseInteger(baseOptions.port, 6379),
    db: parseInteger(baseOptions.db, 0),
    connectTimeout: parseInteger(process.env.REDIS_CONNECT_TIMEOUT_MS, 10000),
    commandTimeout: parseInteger(process.env.REDIS_COMMAND_TIMEOUT_MS, 5000),
    enableReadyCheck: true,
    enableOfflineQueue: forBullMq,
    maxRetriesPerRequest: forBullMq ? null : 2,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  };

  const username = normalizeText(baseOptions.username);
  const password = normalizeText(baseOptions.password || process.env.REDIS_PASSWORD);
  if (username) options.username = username;
  if (password) options.password = password;
  if (useTls) options.tls = {};
  if (connectionName) options.connectionName = connectionName;

  return options;
};

const attachRedisLogging = (client, label = "redis") => {
  client.on("ready", () => {
    const options = client.options || {};
    console.info(`[redis] ${label} connected`, {
      host: options.host,
      port: options.port,
      db: options.db,
      tls: Boolean(options.tls),
    });
  });

  client.on("error", (error) => {
    logThrottled(
      `${label}:error`,
      "warn",
      `[redis] ${label} error`,
      {
        message: error?.message || String(error),
        code: error?.code || undefined,
      },
    );
  });

  client.on("reconnecting", (delay) => {
    logThrottled(
      `${label}:reconnecting`,
      "info",
      `[redis] ${label} reconnecting`,
      { delay_ms: delay },
      30000,
    );
  });
};

const createRedisClient = ({ label = "client", forBullMq = false } = {}) => {
  const client = new Redis({
    ...getRedisConnectionOptions({
      forBullMq,
      connectionName: `oms-${label}`,
    }),
    lazyConnect: true,
  });

  attachRedisLogging(client, label);
  redisClients.add(client);

  client.once("end", () => {
    redisClients.delete(client);
  });

  return client;
};

const isRedisCacheEnabled = () =>
  parseBoolean(process.env.REDIS_CACHE_ENABLED, false);

const isRedisJobsEnabled = () =>
  parseBoolean(process.env.REDIS_JOBS_ENABLED, false);

const closeRedisClients = async () => {
  const clients = [...redisClients];
  redisClients.clear();

  await Promise.allSettled(
    clients.map(async (client) => {
      if (!client || client.status === "end") return;
      await client.quit().catch(() => client.disconnect());
    }),
  );
};

const checkRedisConnection = async ({
  label = "health",
  forBullMq = false,
  timeoutMs = 1500,
} = {}) => {
  const client = createRedisClient({ label, forBullMq });
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Redis connection check timed out")), timeoutMs);
  });

  try {
    await Promise.race([client.connect(), timeout]);
    await Promise.race([client.ping(), timeout]);
    await client.quit().catch(() => client.disconnect());
    return true;
  } catch (error) {
    logThrottled(`${label}:health`, "warn", "[redis] connection check failed", {
      label,
      message: error?.message || String(error),
      code: error?.code || undefined,
    });
    client.disconnect();
    redisClients.delete(client);
    return false;
  }
};

module.exports = {
  getRedisConnectionOptions,
  createRedisClient,
  isRedisCacheEnabled,
  isRedisJobsEnabled,
  checkRedisConnection,
  closeRedisClients,
};
