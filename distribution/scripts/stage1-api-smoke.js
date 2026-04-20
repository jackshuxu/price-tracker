#!/usr/bin/env node

const assert = require('node:assert');

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

async function callJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
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
  const apiPort = Number(args['api-port'] || 18080);
  const coordinatorPort = Number(args['coordinator-port'] || 12420);

  let app = null;

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

    await new Promise((resolve, reject) => {
      distribution.all.store.put(
        {
          storeCode: '701',
          name: "Trader Joe's Chicago Lincoln Park",
          city: 'Chicago',
          state: 'IL',
          address: '667 W Diversey Pkwy',
          zip: '60614',
        },
        { key: '701', gid: 'tjstores' },
        (e) => (e ? reject(e) : resolve()),
      );
    });

    await new Promise((resolve, reject) => {
      distribution.all.store.put(
        {
          term: 'egg',
          postings: [
            {
              docId: 'SKU_EGG_001|701',
              sku: 'SKU_EGG_001',
              storeCode: '701',
              name: 'Organic Brown Eggs, 1 Dozen',
              score: 2.25,
              tf: 2,
              lastSeen: '2026-04-16T00:00:00.000Z',
            },
          ],
        },
        { key: 'egg', gid: 'tjindex' },
        (e) => (e ? reject(e) : resolve()),
      );
    });

    await new Promise((resolve, reject) => {
      distribution.all.store.put(
        {
          sku: 'SKU_EGG_001',
          storeCode: '701',
          name: 'Organic Brown Eggs, 1 Dozen',
          latestPrice: 4.99,
          latestAt: '2026-04-16T00:00:00.000Z',
          history: [
            { capturedAt: '2026-04-15T00:00:00.000Z', price: 4.79 },
            { capturedAt: '2026-04-16T00:00:00.000Z', price: 4.99 },
          ],
          samples: 2,
        },
        { key: 'SKU_EGG_001|701', gid: 'tjprices' },
        (e) => (e ? reject(e) : resolve()),
      );
    });

    const base = `http://${host}:${apiPort}`;

    const health = await callJson(`${base}/health`);
    assert.strictEqual(health.status, 200);
    assert.strictEqual(Boolean(health.body && health.body.ok), true);

    const stores = await callJson(`${base}/stores?state=IL`);
    assert.strictEqual(stores.status, 200);
    assert(Array.isArray(stores.body));
    assert(stores.body.some((s) => String(s.storeCode) === '701'));

    const search = await callJson(`${base}/search?q=egg&storeCode=701&limit=5`);
    assert.strictEqual(search.status, 200);
    assert(Array.isArray(search.body));
    assert(search.body.length > 0);
    assert.strictEqual(String(search.body[0].sku), 'SKU_EGG_001');

    const history = await callJson(`${base}/history/SKU_EGG_001/701`);
    assert.strictEqual(history.status, 200);
    assert(Array.isArray(history.body));
    assert(history.body.length >= 1);

    console.log('[done] stage1 api smoke passed');
  } catch (error) {
    console.error('[fail] stage1 api smoke failed:', error.message || String(error));
    process.exitCode = 1;
  } finally {
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
