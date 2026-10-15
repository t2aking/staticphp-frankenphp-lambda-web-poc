'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

function parseEndpoint(value) {
  const match = /^(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9_.-]+):(\d+)$/.exec(value || '');
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) {
    throw new Error('AWS_LAMBDA_HTTP_ENDPOINT must be host:port (IPv6: [address]:port)');
  }
  return { address: value, host: match[1].replace(/^\[|\]$/g, ''), port: Number(match[2]) };
}

function launch() {
  const started = performance.now();
  const log = (event, details = {}) => console.log(JSON.stringify({
    event, elapsed_ms: Math.round(performance.now() - started), ...details
  }));
  let endpoint, timeout, mode;
  try {
    mode = process.env.FRANKENPHP_MODE || 'normal';
    if (!['normal', 'worker'].includes(mode)) throw new Error('FRANKENPHP_MODE must be normal or worker');
    endpoint = parseEndpoint(process.env.AWS_LAMBDA_HTTP_ENDPOINT);
    timeout = Number(process.env.STARTUP_TIMEOUT_MS || 9000);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 9000) {
      throw new Error('STARTUP_TIMEOUT_MS must be an integer from 1 to 9000');
    }
  } catch (error) {
    log('configuration_error', { message: error.message });
    process.exitCode = 1;
    return;
  }
  const root = path.resolve(__dirname, '..');
  const binary = process.env.FRANKENPHP_BINARY || path.join(root, 'bin/frankenphp');
  const args = ['php-server', '--listen', endpoint.address, '--root', path.join(root, 'public'), '--access-log'];
  if (mode === 'worker') args.push('--worker', `${path.join(root, 'public/index.php')},1`);
  log('spawn', { binary, args, mode });
  const child = spawn(binary, args, {
    cwd: root,
    shell: false,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, FRANKENPHP_MODE: mode, HOME: '/tmp', XDG_CONFIG_HOME: '/tmp/config', XDG_DATA_HOME: '/tmp/data' }
  });
  let stopping = false, forcedCode, deadline, retry, killTimer, request;
  const clearProbes = () => {
    clearTimeout(deadline);
    clearTimeout(retry);
    request?.destroy();
  };
  const stop = (signal, code) => {
    if (stopping) return;
    stopping = true;
    forcedCode = code;
    clearProbes();
    log('stopping', { signal });
    child.kill(signal);
    // Lambda grants at most 1s after SIGTERM. Keep cleanup below that budget.
    killTimer = setTimeout(() => child.kill('SIGKILL'), 700);
  };
  const onTerm = () => stop('SIGTERM', 0);
  const onInt = () => stop('SIGINT', 0);
  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);
  child.once('error', error => {
    log('spawn_error', { message: error.message });
    stopping = true;
    forcedCode = 1;
    clearProbes();
  });
  child.once('close', (code, signal) => {
    stopping = true;
    clearProbes();
    clearTimeout(killTimer);
    process.removeListener('SIGTERM', onTerm);
    process.removeListener('SIGINT', onInt);
    log('child_exit', { code, signal });
    // An unsolicited zero exit is still a failed long-running server.
    process.exitCode = forcedCode ?? (code === 0 || code === null ? 1 : code);
  });
  deadline = setTimeout(() => {
    log('startup_timeout', { timeout_ms: timeout });
    stop('SIGTERM', 1);
  }, timeout);
  const probeHost = endpoint.host === '0.0.0.0' ? '127.0.0.1' : endpoint.host === '::' ? '::1' : endpoint.host;
  function probe() {
    if (stopping) return;
    let scheduled = false;
    const again = () => {
      if (scheduled || stopping) return;
      scheduled = true;
      retry = setTimeout(probe, 50);
    };
    request = http.get({ host: probeHost, port: endpoint.port, path: '/healthz', timeout: 300 }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; if (data.length > 4096) request.destroy(); });
      response.on('error', again);
      response.on('end', () => {
        let body;
        try { body = JSON.parse(data); } catch { return again(); }
        if (response.statusCode !== 200 || body.service !== 'staticphp-lambda-web-poc' || body.status !== 'ok' || body.mode !== mode) return again();
        clearTimeout(deadline);
        log('ready', { endpoint: endpoint.address, child_pid: child.pid, mode });
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', again);
  }
  probe();
}
module.exports = { launch, parseEndpoint };
