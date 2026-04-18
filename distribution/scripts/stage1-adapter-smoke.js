#!/usr/bin/env node

const assert = require('node:assert');

const { createServer } = require('../../tj/server.js');
const { createAdapterServer } = require('../../ai/adapter.js');

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

async function callJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return {
    status: res.status,
    body,
    headers: res.headers,
  };
}

async function putRecord(distribution, gid, key, value) {
  await new Promise((resolve, reject) => {
    distribution.all.store.put(value, { key, gid }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);

  const host = String(args.host || '127.0.0.1');
  const apiPort = Number(args['api-port'] || 18084);
  const adapterPort = Number(args['adapter-port'] || 18090);
  const coordinatorPort = Number(args['coordinator-port'] || 12436);

  let app = null;
  let adapter = null;

  try {
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

    const distribution = app.runtime.distribution;

    await putRecord(distribution, 'tjstores', '701', {
      storeCode: '701',
      name: "Trader Joe's Chicago Lincoln Park",
      city: 'Chicago',
      state: 'IL',
      address: '667 W Diversey Pkwy',
      zip: '60614',
    });

    await putRecord(distribution, 'tjindex', 'egg', {
      term: 'egg',
      postings: [
        {
          docId: 'SKU_EGG_A|701',
          sku: 'SKU_EGG_A',
          storeCode: '701',
          name: 'Organic Brown Eggs, 1 Dozen',
          score: 2.25,
          tf: 2,
          lastSeen: '2026-04-16T00:00:00.000Z',
        },
        {
          docId: 'SKU_EGG_B|701',
          sku: 'SKU_EGG_B',
          storeCode: '701',
          name: 'Large Cage-Free Eggs, 12 ct',
          score: 1.95,
          tf: 2,
          lastSeen: '2026-04-16T00:00:00.000Z',
        },
      ],
    });

    await putRecord(distribution, 'tjprices', 'SKU_EGG_A|701', {
      sku: 'SKU_EGG_A',
      storeCode: '701',
      name: 'Organic Brown Eggs, 1 Dozen',
      latestPrice: 4.99,
      latestAt: '2026-04-16T00:00:00.000Z',
      history: [
        { capturedAt: '2026-04-15T00:00:00.000Z', price: 4.79 },
        { capturedAt: '2026-04-16T00:00:00.000Z', price: 4.99 },
      ],
      samples: 2,
    });

    await putRecord(distribution, 'tjprices', 'SKU_EGG_B|701', {
      sku: 'SKU_EGG_B',
      storeCode: '701',
      name: 'Large Cage-Free Eggs, 12 ct',
      latestPrice: 4.39,
      latestAt: '2026-04-16T00:00:00.000Z',
      history: [
        { capturedAt: '2026-04-15T00:00:00.000Z', price: 4.49 },
        { capturedAt: '2026-04-16T00:00:00.000Z', price: 4.39 },
      ],
      samples: 2,
    });

    adapter = createAdapterServer({
      host,
      port: adapterPort,
      backendBaseUrl: `http://${host}:${apiPort}`,
      enrichSearch: true,
      shelfHarmonyEnabled: true,
      enrichTopN: 2,
      backendTimeoutMs: 3000,
    });
    await adapter.start();

    const base = `http://${host}:${adapterPort}`;

    const health = await callJson(`${base}/health`);
    assert.strictEqual(health.status, 200);
    assert.strictEqual(Boolean(health.body && health.body.ok), true);
    assert.strictEqual(Boolean(health.body && health.body.upstreamHealthy), true);

    const search = await callJson(`${base}/search?q=egg&storeCode=701&limit=5`);
    assert.strictEqual(search.status, 200);
    assert(Array.isArray(search.body));
    assert(search.body.length >= 1);
    assert(search.body[0] && search.body[0].ai && search.body[0].ai.shelfHarmony);
    assert.strictEqual(search.headers.get('x-adapter-source'), 'search-enriched');

    const history = await callJson(`${base}/history/SKU_EGG_A/701`);
    assert.strictEqual(history.status, 200);
    assert(Array.isArray(history.body));

    const harmony = await callJson(`${base}/ai/shelf-harmony?sku=SKU_EGG_A&storeCode=701&q=egg`);
    assert.strictEqual(harmony.status, 200);
    assert(harmony.body && harmony.body.shelfHarmony);
    assert(Array.isArray(harmony.body.shelfHarmony.alternatives));

    const missingSku = await callJson(`${base}/ai/shelf-harmony?storeCode=701`);
    assert.strictEqual(missingSku.status, 400);

    console.log('[done] stage1 adapter smoke passed');
  } catch (error) {
    console.error('[fail] stage1 adapter smoke failed:', error.message || String(error));
    process.exitCode = 1;
  } finally {
    if (adapter) {
      try {
        await adapter.stop();
      } catch {
        // Best effort cleanup.
      }
    }

    if (app) {
      try {
        await app.stop();
      } catch {
        // Best effort cleanup.
      }
    }
  }
}

main();
