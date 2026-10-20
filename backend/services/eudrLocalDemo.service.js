const path = require('node:path');

// Demo evidence stays on this PC; production never serves local filesystem keys.
function documentPath(key, env = process.env) {
  if (!String(key).startsWith('local-eudr-demo/')) return null;
  if (env.NODE_ENV === 'production' || !env.EUDR_LOCAL_DEMO_ROOT || !path.isAbsolute(env.EUDR_LOCAL_DEMO_ROOT)) {
    throw Object.assign(new Error('Local demo evidence is disabled'), { statusCode: 404 });
  }
  const name = String(key).slice('local-eudr-demo/'.length);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(pdf|png)$/.test(name) || name.includes('..')) {
    throw Object.assign(new Error('Invalid local demo document'), { statusCode: 400 });
  }
  return path.join(env.EUDR_LOCAL_DEMO_ROOT, name);
}

module.exports = { documentPath };
