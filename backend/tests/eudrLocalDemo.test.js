const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { documentPath } = require('../services/eudrLocalDemo.service');

test('local demo evidence is opt-in, production-disabled, and cannot escape its directory', () => {
  const root = path.resolve('demo-evidence');
  const env = { EUDR_LOCAL_DEMO_ROOT: root, NODE_ENV: 'development' };
  assert.equal(documentPath('private/real.pdf', env), null);
  assert.equal(documentPath('local-eudr-demo/example.pdf', env), path.join(root, 'example.pdf'));
  for (const key of ['../secret.pdf', 'folder/secret.pdf', '..%2Fsecret.pdf', 'a.txt']) {
    assert.throws(() => documentPath('local-eudr-demo/' + key, env), /Invalid/);
  }
  assert.throws(() => documentPath('local-eudr-demo/a.pdf', {}), /disabled/);
  assert.throws(() => documentPath('local-eudr-demo/a.pdf', { ...env, NODE_ENV: 'production' }), /disabled/);
});
