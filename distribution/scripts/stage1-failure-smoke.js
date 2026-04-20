#!/usr/bin/env node

const assert = require('node:assert');

const { createServer } = require('../../tj/server.js');
const idUtil = require('../../distribution/util/id.js');

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

function normalizeError(error) {
  if (!error) {
    return null;
  }
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'object') {
    const keys = Object.keys(error);
    if (keys.length === 0) {
      return null;
    }
    return new Error(`multi-error from nodes: ${keys.join(', ')}`);
  }
  return new Error(String(error));
}

function callWithCallback(fn) {
  return new Promise((resolve, reject) => {
    fn((error, value) => {
      const err = normalizeError(error);
      if (err) {
        reject(err);
        return;
      }
      resolve(value);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chooseKeyRoutedToNode(prefix, targetNid, nids) {
  for (let i = 0; i < 5000; i += 1) {
    const candidate = `${prefix}_${i}`;
    const kid = idUtil.getID(candidate);
    if (idUtil.naiveHash(kid, nids) === targetNid) {
      return candidate;
    }
  }
  throw new Error('unable to find key routed to target node');
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
  const apiPort = Number(args['api-port'] || 18082);
  const coordinatorPort = Number(args['coordinator-port'] || 12430);
  const peerPort = Number(args['peer-port'] || 12431);

  const liveNode = { ip: host, port: coordinatorPort };
  const peerNode = { ip: host, port: peerPort };
  const liveNid = idUtil.getNID(liveNode);
  const peerNid = idUtil.getNID(peerNode);
  const nids = [liveNid, peerNid];
  const storeKey = chooseKeyRoutedToNode('smoke_store', liveNid, nids);

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

    await callWithCallback((cb) => {
      distribution.all.store.put(
        {
          storeCode: storeKey,
          name: `Trader Joe's ${storeKey}`,
          city: 'Chicago',
          state: 'IL',
          address: '123 Smoke Test Ave',
          zip: '60614',
        },
        { key: storeKey, gid: 'tjstores' },
        cb,
      );
    });

    await callWithCallback((cb) => distribution.all.status.spawn(peerNode, cb));
    await sleep(900);

    const sidAfterSpawn = await callWithCallback((cb) => distribution.all.status.get('sid', cb));
    assert(Array.isArray(sidAfterSpawn));
    assert(sidAfterSpawn.length >= 2);

    await callWithCallback((cb) => {
      distribution.local.comm.send(
        [],
        { node: peerNode, service: 'status', method: 'stop' },
        cb,
      );
    });
    await sleep(700);

    const base = `http://${host}:${apiPort}`;

    const health = await callJson(`${base}/health`);
    assert.strictEqual(health.status, 200);
    assert.strictEqual(Boolean(health.body && health.body.ok), true);

    const emptySearch = await callJson(`${base}/search?q=&storeCode=${encodeURIComponent(storeKey)}`);
    assert.strictEqual(emptySearch.status, 200);
    assert(Array.isArray(emptySearch.body));
    assert.strictEqual(emptySearch.body.length, 0);

    const stores = await callJson(`${base}/stores`);
    assert.strictEqual(stores.status, 200);
    assert(Array.isArray(stores.body));
    assert(stores.body.some((s) => String(s.storeCode) === storeKey));

    const notFound = await callJson(`${base}/not-real`);
    assert.strictEqual(notFound.status, 404);

    const methodNotAllowed = await callJson(`${base}/search`, { method: 'POST' });
    assert.strictEqual(methodNotAllowed.status, 405);

    console.log('[done] stage1 failure smoke passed');
  } catch (error) {
    console.error('[fail] stage1 failure smoke failed:', error.message || String(error));
    process.exitCode = 1;
  } finally {
    if (app && app.runtime && app.runtime.distribution) {
      const distribution = app.runtime.distribution;
      try {
        await callWithCallback((cb) => {
          distribution.local.comm.send(
            [],
            { node: peerNode, service: 'status', method: 'stop' },
            cb,
          );
        });
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
