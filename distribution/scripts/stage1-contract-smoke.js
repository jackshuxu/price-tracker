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

function assertIsoString(value, label) {
  assert.strictEqual(typeof value, 'string', `${label} must be a string`);
  const ts = Date.parse(value);
  assert(Number.isFinite(ts), `${label} must be an ISO-like timestamp`);
}

function assertErrorShape(payload, expectedMessage) {
  assert(payload && typeof payload === 'object', 'error payload must be object');
  assert.strictEqual(typeof payload.error, 'string', 'error payload.error must be string');
  assert.strictEqual(payload.error, expectedMessage, `error message must be \"${expectedMessage}\"`);
}

async function main() {
  const args = parseArgs(process.argv);

  const host = String(args.host || '127.0.0.1');
  const apiPort = Number(args['api-port'] || 18083);
  const coordinatorPort = Number(args['coordinator-port'] || 12432);

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
          lat: 41.933,
          lng: -87.647,
        },
        { key: '701', gid: 'tjstores' },
        (e) => (e ? reject(e) : resolve()),
      );
    });

    await new Promise((resolve, reject) => {
      distribution.all.store.put(
        {
          term: 'egg',
          df: 1,
          totalDocs: 1,
          idf: 1,
          postings: [
            {
              docId: 'SKU_EGG_CONTRACT|701',
              sku: 'SKU_EGG_CONTRACT',
              storeCode: '701',
              name: 'Organic Brown Eggs, 1 Dozen',
              score: 2.25,
              tf: 2,
              lastSeen: '2026-04-16T00:00:00.000Z',
            },
          ],
          updatedAt: '2026-04-16T00:00:00.000Z',
        },
        { key: 'egg', gid: 'tjindex' },
        (e) => (e ? reject(e) : resolve()),
      );
    });

    await new Promise((resolve, reject) => {
      distribution.all.store.put(
        {
          sku: 'SKU_EGG_CONTRACT',
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
        { key: 'SKU_EGG_CONTRACT|701', gid: 'tjprices' },
        (e) => (e ? reject(e) : resolve()),
      );
    });

    const base = `http://${host}:${apiPort}`;

    const health = await callJson(`${base}/health`);
    assert.strictEqual(health.status, 200);
    assert(health.body && typeof health.body === 'object');
    assert.strictEqual(health.body.ok, true);
    assert(health.body.coordinator && typeof health.body.coordinator === 'object');
    assert.strictEqual(typeof health.body.coordinator.host, 'string');
    assert.strictEqual(typeof health.body.coordinator.port, 'number');
    assert(Array.isArray(health.body.peers));
    assertIsoString(health.body.now, 'health.now');

    const emptySearch = await callJson(`${base}/search?q=`);
    assert.strictEqual(emptySearch.status, 200);
    assert(Array.isArray(emptySearch.body));
    assert.strictEqual(emptySearch.body.length, 0);

    const search = await callJson(`${base}/search?q=egg&storeCode=701&limit=5`);
    assert.strictEqual(search.status, 200);
    assert(Array.isArray(search.body));
    assert(search.body.length >= 1);
    const searchRow = search.body[0];
    assert.strictEqual(typeof searchRow.sku, 'string');
    assert.strictEqual(typeof searchRow.storeCode, 'string');
    assert.strictEqual(typeof searchRow.name, 'string');
    assert.strictEqual(typeof searchRow.score, 'number');
    assert(Array.isArray(searchRow.matchedTerms));
    if (searchRow.latestAt !== null) {
      assertIsoString(searchRow.latestAt, 'search.latestAt');
    }

    const history = await callJson(`${base}/history/SKU_EGG_CONTRACT/701`);
    assert.strictEqual(history.status, 200);
    assert(Array.isArray(history.body));
    assert(history.body.length >= 1);
    const historyRow = history.body[0];
    assert.strictEqual(typeof historyRow.price, 'number');
    assertIsoString(historyRow.date, 'history.date');

    const stores = await callJson(`${base}/stores?state=IL`);
    assert.strictEqual(stores.status, 200);
    assert(Array.isArray(stores.body));
    assert(stores.body.length >= 1);
    const storeRow = stores.body[0];
    assert.strictEqual(typeof storeRow.storeCode, 'string');
    assert.strictEqual(typeof storeRow.name, 'string');
    assert.strictEqual(typeof storeRow.city, 'string');
    assert.strictEqual(typeof storeRow.state, 'string');
    assert.strictEqual(typeof storeRow.address, 'string');
    assert.strictEqual(typeof storeRow.zip, 'string');
    assert(storeRow.lat === null || typeof storeRow.lat === 'number');
    assert(storeRow.lng === null || typeof storeRow.lng === 'number');

    const notFound = await callJson(`${base}/not-found`);
    assert.strictEqual(notFound.status, 404);
    assertErrorShape(notFound.body, 'Not found');

    const methodNotAllowed = await callJson(`${base}/search?q=egg`, { method: 'POST' });
    assert.strictEqual(methodNotAllowed.status, 405);
    assertErrorShape(methodNotAllowed.body, 'Method not allowed');

    console.log('[done] stage1 contract smoke passed');
  } catch (error) {
    console.error('[fail] stage1 contract smoke failed:', error.message || String(error));
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
