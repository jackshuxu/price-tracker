#!/usr/bin/env node

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { createServer } = require('../../tj/server.js');

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

function runNodeScript(scriptPath, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.once('error', reject);

    child.once('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${path.basename(scriptPath)} exited with ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
  });
}

async function callJson(url, init) {
  const res = await fetch(url, { cache: 'no-store', ...(init || {}) });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function main() {
  const args = parseArgs(process.argv);

  const host = String(args.host || '127.0.0.1');
  const apiPort = Number(args['api-port'] || 18081);
  const coordinatorPort = Number(args['coordinator-port'] || 12424);

  const root = path.resolve(__dirname, '..', '..');
  const crawlerPath = path.join(root, 'crawler.js');
  const indexerPath = path.join(root, 'indexer.js');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-pipeline-smoke-'));
  const snapshotFile = path.join(tempDir, 'snapshots.json');

  const snapshots = [
    {
      capturedAt: '2026-04-16T00:00:00.000Z',
      storeCode: '701',
      products: [
        {
          sku: 'SKU_PIPE_001',
          name: 'Organic Brown Eggs, 1 Dozen',
          price: 4.99,
          category: 'Dairy',
          size: '12 ct',
        },
        {
          sku: 'SKU_PIPE_002',
          name: 'Greek Yogurt Vanilla',
          price: 3.49,
          category: 'Dairy',
          size: '32 oz',
        },
      ],
    },
  ];

  fs.writeFileSync(snapshotFile, JSON.stringify(snapshots, null, 2), 'utf8');

  let app = null;

  try {
    await runNodeScript(
      crawlerPath,
      [
        '--host',
        host,
        '--port',
        String(coordinatorPort),
        '--strict-group',
        '--snapshot-file',
        snapshotFile,
        '--raw-gid',
        'tjraw',
        '--stores-gid',
        'tjstores',
        '--no-fallback',
      ],
      root,
    );

    await runNodeScript(
      indexerPath,
      [
        '--host',
        host,
        '--port',
        String(coordinatorPort),
        '--strict-group',
        '--input-gid',
        'tjraw',
        '--index-gid',
        'tjindex',
        '--price-gid',
        'tjprices',
      ],
      root,
    );

    app = await createServer({
      coordinatorHost: host,
      coordinatorPort,
      peers: [],
      strictGroup: true,
    });

    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(apiPort, host, () => resolve());
    });

    const base = `http://${host}:${apiPort}`;

    const health = await callJson(`${base}/health`);
    assert.strictEqual(health.status, 200);
    assert.strictEqual(Boolean(health.body && health.body.ok), true);

    const stores = await callJson(`${base}/stores`);
    assert.strictEqual(stores.status, 200);
    assert(Array.isArray(stores.body));
    assert(stores.body.some((s) => String(s.storeCode) === '701'));

    const search = await callJson(`${base}/search?q=egg&storeCode=701&limit=5`);
    assert.strictEqual(search.status, 200);
    assert(Array.isArray(search.body));
    assert(search.body.length >= 1);
    assert.strictEqual(String(search.body[0].sku), 'SKU_PIPE_001');

    const history = await callJson(`${base}/history/SKU_PIPE_001/701`);
    assert.strictEqual(history.status, 200);
    assert(Array.isArray(history.body));
    assert(history.body.length >= 1);

    console.log('[done] stage1 pipeline smoke passed');
  } catch (error) {
    console.error('[fail] stage1 pipeline smoke failed:', error.message || String(error));
    process.exitCode = 1;
  } finally {
    if (app) {
      try {
        await app.stop();
      } catch {
        // Best effort cleanup.
      }
    }

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup.
    }
  }
}

main();
