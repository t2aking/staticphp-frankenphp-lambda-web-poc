'use strict';
const assert = require('node:assert/strict');
const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
(async () => {
  for (const route of ['/', '/hello?test=1', '/healthz']) {
    const res = await fetch(new URL(route, base), {
      headers: { 'lambda-web-request-id': 'local-smoke-test' }, signal: AbortSignal.timeout(5000)
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-poc-runtime'), 'FrankenPHP');
    const body = await res.json();
    assert.equal(body.message, 'Hello from PHP!');
    assert.equal(body.sapi, 'frankenphp');
    assert.equal(body.zts, true);
    // AWS overwrites this request header; exact echo is tested locally only.
    if (!base.startsWith('https:')) assert.equal(body.request_id, 'local-smoke-test');
    console.log(JSON.stringify({ route, ...body }));
  }
  assert.equal((await fetch(new URL('/missing', base))).status, 404);
  assert.equal((await fetch(new URL('/hello', base), { method: 'POST' })).status, 405);
  const head = await fetch(new URL('/hello', base), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  console.log('Smoke test passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
