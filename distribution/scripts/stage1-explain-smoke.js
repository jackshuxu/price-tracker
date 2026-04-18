#!/usr/bin/env node

const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

function startNextDevServer({ prototypeDir, host, port, env }) {
  const nextBin = path.join(prototypeDir, 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = spawn(process.execPath, [nextBin, 'dev', '-p', String(port), '-H', host], {
    cwd: prototypeDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      ...env,
    },
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(String(chunk));
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(String(chunk));
  });

  return child;
}

async function waitForEndpoint(url, timeoutMs) {
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      return res.status;
    } catch (error) {
      lastError = error;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(700);
  }

  throw new Error(`Timed out waiting for server endpoint: ${lastError ? lastError.message : 'no response'}`);
}

async function stopServer(child) {
  if (!child || child.killed) {
    return;
  }

  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      resolve();
    };

    child.once('close', () => finish());
    child.kill('SIGTERM');
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      finish();
    }, 6000);
  });
}

async function runEnabledCase({ prototypeDir, host, port }) {
  const child = startNextDevServer({
    prototypeDir,
    host,
    port,
    env: {
      TJ_API_EXPLAIN_ENABLED: '1',
      TJ_API_ALLOW_MOCK_FALLBACK: '1',
      TJ_API_ALLOW_EXTERNAL_FALLBACK: '0',
    },
  });

  try {
    const base = `http://${host}:${port}`;
    await waitForEndpoint(`${base}/api/tj/explain?sku=050116&storeCode=701`, 180000);

    const explain = await fetchJson(`${base}/api/tj/explain?sku=050116&storeCode=701`);
    assert.strictEqual(explain.status, 200);
    assert(explain.body && typeof explain.body === 'object');
    assert.strictEqual(typeof explain.body.sku, 'string');
    assert.strictEqual(typeof explain.body.storeCode, 'string');
    assert.strictEqual(typeof explain.body.trend, 'string');
    assert.strictEqual(typeof explain.body.narrative, 'string');

    const source = explain.headers.get('x-tj-data-source');
    assert(source === 'distribution' || source === 'mock' || source === 'none');
  } finally {
    await stopServer(child);
  }
}

async function runDisabledCase({ prototypeDir, host, port }) {
  const child = startNextDevServer({
    prototypeDir,
    host,
    port,
    env: {
      TJ_API_EXPLAIN_ENABLED: '0',
      TJ_API_ALLOW_MOCK_FALLBACK: '1',
      TJ_API_ALLOW_EXTERNAL_FALLBACK: '0',
    },
  });

  try {
    const base = `http://${host}:${port}`;
    await waitForEndpoint(`${base}/api/tj/search?q=egg&storeCode=701`, 180000);

    const explain = await fetchJson(`${base}/api/tj/explain?sku=050116&storeCode=701`);
    assert.strictEqual(explain.status, 404);
    assert(explain.body && typeof explain.body === 'object');
    assert.strictEqual(String(explain.body.error), 'Not found');
    assert.strictEqual(explain.headers.get('x-tj-data-source'), 'none');
  } finally {
    await stopServer(child);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const host = String(args.host || '127.0.0.1');
  const port = Number(args.port || 3015);

  const root = path.resolve(__dirname, '..', '..');
  const prototypeDir = path.join(root, 'prototype');

  try {
    await runEnabledCase({ prototypeDir, host, port });
    await runDisabledCase({ prototypeDir, host, port: port + 1 });
    console.log('[done] stage1 explain smoke passed');
  } catch (error) {
    console.error('[fail] stage1 explain smoke failed:', error.message || String(error));
    process.exitCode = 1;
  }
}

main();
