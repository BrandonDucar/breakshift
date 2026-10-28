import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from './worker.mjs';

const request = (path, method = 'GET') => new Request(`https://bay.example${path}`, { method, headers: method === 'POST' ? { origin: 'https://bay.example', 'content-type': 'application/json' } : {}, ...(method === 'POST' ? { body: '{}' } : {}) });
const env = { MUSE_BUDGET: { idFromName() { throw Error('ANONYMOUS_REQUEST_REACHED_PRIVATE_BUDGET'); } } };

test('anonymous app status is open-link without account requirements or paid access', async () => {
  const status = await (await worker.fetch(request('/api/muse/status'), env)).json();
  assert.equal(status.appAccess, 'OPEN_LINK'); assert.equal(status.signInRequired, false);
  assert.equal(status.authenticated, false); assert.equal(status.enabled, false);
  assert.equal(status.remainingScans, 0, 'public entitlement is not the private shared balance');
  const health = await (await worker.fetch(request('/api/health'), env)).json();
  assert.equal(health.signInRequired, false); assert.equal(health.sessionScope, 'THIS_BROWSER');
  assert.equal(health.liveScansRequireTesterAccess, true);
});

test('public link never opens private audit, results or provider connectivity', async () => {
  for (const path of ['/api/muse/audit', '/api/muse/photo-result?id=private', '/api/muse/connectivity']) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 403); assert.equal((await response.json()).error, 'MUSE_TESTER_ACCESS_REQUIRED');
  }
});

test('anonymous paid scan attempts reject before budget access or provider work', async () => {
  for (const path of ['/api/muse/scan', '/api/muse/photo-scan', '/api/muse/perception-scan']) {
    const response = await worker.fetch(request(path, 'POST'), env);
    assert.equal(response.status, 403); assert.equal((await response.json()).error, 'MUSE_TESTER_ACCESS_REQUIRED');
  }
});

test('public build has open access state and no visible access-code form by default', async () => {
  const html = await readFile(new URL('../.cf-preview/index.html', import.meta.url), 'utf8');
  assert.match(html, /OPEN ACCESS · NO SIGN-IN REQUIRED/);
  assert.match(html, /id="tester-access-form" hidden/);
  assert.doesNotMatch(html, /<input[^>]+type="email"/);
  assert.doesNotMatch(html, /Enable live scans/);
});
