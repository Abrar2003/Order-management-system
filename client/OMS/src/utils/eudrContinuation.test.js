import test from 'node:test';
import assert from 'node:assert/strict';
import { eudrContinuation } from './eudrContinuation.js';

test('EUDR sign-in resumes only the configured application, never a supplied return URL', () => {
  const tool = 'http://localhost:5173/eudr-tool/';
  assert.equal(eudrContinuation('', tool), null);
  assert.equal(eudrContinuation('?returnTo=https://untrusted.example', tool), null);
  assert.equal(eudrContinuation('?continue=eudr&returnTo=https://untrusted.example', tool), tool + 'api/auth/launch');
  assert.equal(eudrContinuation('?continue=eudr', 'https://oms.ghouse-sourcing.com/eudr-tool'), 'https://oms.ghouse-sourcing.com/eudr-tool/api/auth/launch');
  assert.equal(eudrContinuation('?continue=eudr', 'javascript:alert(1)'), null);
});
