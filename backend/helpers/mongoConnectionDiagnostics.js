const dns = require("dns");

const parseDnsServers = (value) =>
  String(value || "")
    .split(/[,\s;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const applyMongoDnsServersFromEnv = (env = process.env) => {
  const dnsServers = parseDnsServers(env.MONGO_DNS_SERVERS);
  if (dnsServers.length === 0) return [];
  dns.setServers(dnsServers);
  console.log(`[mongo] Using DNS servers for SRV lookup: ${dnsServers.join(", ")}`);
  return dnsServers;
};

const getSrvLookupHost = (mongoUri) => {
  const match = String(mongoUri || "").match(/^mongodb\+srv:\/\/(?:[^@/]+@)?([^/?]+)/i);
  return match?.[1] ? `_mongodb._tcp.${match[1]}` : "";
};

const isSrvDnsError = (error, mongoUri) => {
  const uri = String(mongoUri || "");
  return (
    uri.startsWith("mongodb+srv://") &&
    (
      error?.syscall === "querySrv" ||
      String(error?.hostname || "").startsWith("_mongodb._tcp.") ||
      ["ENOTFOUND", "ECONNREFUSED", "ETIMEOUT", "EAI_AGAIN"].includes(error?.code)
    )
  );
};

const formatMongoConnectionError = (error, mongoUri) => {
  if (!isSrvDnsError(error, mongoUri)) {
    return error?.stack || error?.message || String(error);
  }

  const srvHost = error?.hostname || getSrvLookupHost(mongoUri);
  const dnsCheck = srvHost
    ? `Resolve-DnsName -Type SRV ${srvHost}`
    : "Resolve-DnsName -Type SRV _mongodb._tcp.<your-atlas-host>";
  const nodeDnsServers = dns.getServers();

  return [
    "MongoDB connection failed before the migration started.",
    "",
    `Atlas SRV DNS lookup failed${srvHost ? ` for ${srvHost}` : ""}.`,
    `Original error: ${error?.code || "UNKNOWN"} ${error?.message || String(error)}`,
    `Node DNS servers: ${nodeDnsServers.length > 0 ? nodeDnsServers.join(", ") : "none configured"}`,
    "",
    "This usually means the current network, DNS server, VPN, proxy, or firewall is blocking mongodb+srv DNS lookups.",
    "",
    "Try these checks:",
    `1. Run: ${dnsCheck}`,
    '2. If Windows resolves it but Node does not, retry with: $env:MONGO_DNS_SERVERS="8.8.8.8,1.1.1.1"',
    "3. If SRV lookups are blocked in this environment, replace MONGO_URI with Atlas's non-SRV mongodb:// seed-list connection string and re-run the script.",
    "",
    "No vendor records were backfilled.",
  ].join("\n");
};

module.exports = {
  applyMongoDnsServersFromEnv,
  formatMongoConnectionError,
};
