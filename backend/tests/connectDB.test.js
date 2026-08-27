const assert = require("node:assert/strict");
const test = require("node:test");
const dns = require("node:dns");

const { configureMongoDnsServers } = require("../config/connectDB");

test("Mongo DNS override trims and applies comma-separated servers", () => {
  const original = dns.getServers();
  try {
    assert.deepEqual(
      configureMongoDnsServers(" 192.0.2.1, 2001:db8::1 "),
      ["192.0.2.1", "2001:db8::1"],
    );
    assert.deepEqual(dns.getServers(), ["192.0.2.1", "2001:db8::1"]);
  } finally {
    dns.setServers(original);
  }
});
