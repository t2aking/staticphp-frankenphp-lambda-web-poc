'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const target = new URL(base);
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'This comparison is for a fresh local container only');
const mode = process.env.EXPECT_MODE;
assert.ok(['normal', 'worker'].includes(mode), 'Set EXPECT_MODE=normal or worker');
(async () => {
  const samples = [];
  for (const [index, query] of ['?marker=first', '?marker=second', ''].entries()) {
    const started = performance.now();
    const response = await fetch(`${base}/state${query}`, {
      headers: { 'lambda-web-request-id': `compare-${index}` }, signal: AbortSignal.timeout(5000)
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, mode);
    assert.equal(body.state.marker, ['first', 'second', null][index]);
    if (!base.startsWith('https:')) assert.equal(body.request_id, `compare-${index}`);
    samples.push({ ...body.state, elapsed_ms: Math.round(performance.now() - started) });
    // Readiness probes must not change the demonstration counter.
    const health = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(5000) });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).mode, mode);
  }
  assert.deepEqual(samples.map(s => s.count), mode === 'worker' ? [1, 2, 3] : [1, 1, 1]);
  assert.equal(new Set(samples.map(s => s.boot_id)).size, mode === 'worker' ? 1 : 3);
  console.log(JSON.stringify({ mode, samples, status: 'passed' }));
})().catch(error => { console.error(error); process.exitCode = 1; });
