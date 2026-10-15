const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
async function start(overrides = {}) {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['index.js'], {
    cwd: root,
    env: { ...process.env, FRANKENPHP_MODE: 'normal', AWS_LAMBDA_HTTP_ENDPOINT: `127.0.0.1:${port}`,
      FRANKENPHP_BINARY: path.join(__dirname, 'fixtures/frankenphp'), ...overrides },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const done = once(child, 'close');
  return { child, done, output: () => output, port };
}
test('direct child HTTP listener stays alive, reports ready, receives SIGTERM', { timeout: 7000 }, async () => {
  const p = await start();
  try {
    for (let i = 0; i < 100 && !p.output().includes('"event":"ready"'); i++) {
      if (p.child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.match(p.output(), /"event":"ready"/);
    const response = await fetch(`http://127.0.0.1:${p.port}/healthz`);
    assert.equal((await response.json()).service, 'staticphp-lambda-web-poc');
    p.child.kill('SIGTERM');
    const [code] = await p.done;
    assert.equal(code, 0);
    assert.match(p.output(), /fixture received SIGTERM/);
  } finally { p.child.kill('SIGKILL'); }
});
test('child nonzero exit propagates', { timeout: 3000 }, async () => {
  const p = await start({ FAKE_MODE: 'exit' });
  assert.equal((await p.done)[0], 7);
});
test('missing binary fails without waiting for startup deadline', { timeout: 3000 }, async () => {
  const p = await start({ FRANKENPHP_BINARY: '/missing/frankenphp' });
  assert.equal((await p.done)[0], 1);
  assert.match(p.output(), /ENOENT/);
});
test('startup deadline terminates a child that never listens', { timeout: 3000 }, async () => {
  const p = await start({ FAKE_MODE: 'hang', STARTUP_TIMEOUT_MS: '150' });
  assert.equal((await p.done)[0], 1);
  assert.match(p.output(), /startup_timeout/);
});
test('invalid endpoint fails before spawn', { timeout: 3000 }, async () => {
  const p = await start({ AWS_LAMBDA_HTTP_ENDPOINT: 'http://localhost:3000' });
  assert.equal((await p.done)[0], 1);
  assert.match(p.output(), /host:port/);
});
test('worker mode launches exactly one worker and waits for matching readiness', { timeout: 5000 }, async () => {
  const p = await start({ FRANKENPHP_MODE: 'worker' });
  try {
    for (let i = 0; i < 100 && !p.output().includes('"event":"ready"'); i++) {
      if (p.child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.match(p.output(), /"event":"ready"/);
    assert.match(p.output(), /index\.php,1/);
    assert.match(p.output(), /"mode":"worker"/);
    p.child.kill('SIGTERM');
    assert.equal((await p.done)[0], 0);
  } finally { p.child.kill('SIGKILL'); }
});
test('invalid mode fails before spawning a child', { timeout: 3000 }, async () => {
  const p = await start({ FRANKENPHP_MODE: 'invalid' });
  assert.equal((await p.done)[0], 1);
  assert.match(p.output(), /FRANKENPHP_MODE/);
});
test('normal response cannot satisfy worker readiness', { timeout: 3000 }, async () => {
  const p = await start({ FRANKENPHP_MODE: 'worker', FAKE_MODE: 'wrong-mode', STARTUP_TIMEOUT_MS: '200' });
  assert.equal((await p.done)[0], 1);
  assert.match(p.output(), /startup_timeout/);
  assert.doesNotMatch(p.output(), /"event":"ready"/);
});
