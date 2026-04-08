#!/usr/bin/env node

const assert = require('node:assert');

const createDistribution = require('../../distribution.js');

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

async function main() {
  const args = parseArgs(process.argv);
  const host = String(args.host || '127.0.0.1');
  const port1 = Number(args.port1 || 12400);
  const port2 = Number(args.port2 || 12401);
  const port3 = Number(args.port3 || 12402);

  const distribution = createDistribution({ ip: host, port: port1 });
  globalThis.distribution = distribution;

  const stage1Gids = ['tjraw', 'tjindex', 'tjprices', 'tjstores'];
  let serverStarted = false;

  try {
    await callWithCallback((cb) => distribution.node.start(cb));
    serverStarted = true;
    console.log(`[ok] node started on ${host}:${port1}`);

    const sidBefore = await callWithCallback((cb) => distribution.all.status.get('sid', cb));
    assert(Array.isArray(sidBefore));
    assert(sidBefore.length >= 1);
    console.log(`[ok] status sid count before spawn: ${sidBefore.length}`);

    const routeMap = await callWithCallback((cb) => distribution.all.routes.get('status', cb));
    assert(routeMap && typeof routeMap === 'object');
    console.log('[ok] all.routes.get(status) returned route map');

    const interval = await callWithCallback((cb) => distribution.all.gossip.at(25, () => {}, cb));
    await callWithCallback((cb) => distribution.all.gossip.del(interval, cb));
    console.log('[ok] gossip at/del round-trip');

    await callWithCallback((cb) => distribution.all.status.spawn({ ip: host, port: port2 }, cb));
    await callWithCallback((cb) => distribution.all.status.spawn({ ip: host, port: port3 }, cb));
    await sleep(800);
    const sidAfter = await callWithCallback((cb) => distribution.all.status.get('sid', cb));
    assert(Array.isArray(sidAfter));
    assert(sidAfter.length >= 3);
    console.log(`[ok] spawn worked, sid count after spawn: ${sidAfter.length}`);

    for (const gid of stage1Gids) {
      const key = `_smoke_${gid}`;
      const payload = { gid, ok: true, ts: Date.now() };
      await callWithCallback((cb) => distribution.all.store.put(payload, { key, gid }, cb));
      const readBack = await callWithCallback((cb) => distribution.all.store.get({ key, gid }, cb));
      assert(readBack && readBack.gid === gid);
      console.log(`[ok] store put/get for gid ${gid}`);
    }

    const group = await callWithCallback((cb) => distribution.local.groups.get('all', cb));
    await callWithCallback((cb) => distribution.all.store.reconf(group, cb));
    await callWithCallback((cb) => distribution.all.mem.reconf(group, cb));
    console.log('[ok] store/mem reconf completed');

    await callWithCallback((cb) => distribution.all.store.put({ title: 'apple mango' }, { key: 'doc1', gid: 'all' }, cb));
    await callWithCallback((cb) => distribution.all.store.put({ title: 'apple orange' }, { key: 'doc2', gid: 'all' }, cb));

    const mrResult = await callWithCallback((cb) => {
      distribution.all.mr.exec(
        {
          map: (key, value) => {
            const terms = String(value.title || '')
              .toLowerCase()
              .split(/\s+/)
              .filter(Boolean);
            return terms.map((t) => ({ [t]: 1 }));
          },
          reduce: (key, values) => ({ [key]: values.reduce((acc, n) => acc + Number(n || 0), 0) }),
        },
        cb,
      );
    });
    assert(Array.isArray(mrResult));
    assert(mrResult.length > 0);
    console.log(`[ok] mr result count: ${mrResult.length}`);

    console.log('[done] stage1 smoke passed');
  } catch (error) {
    console.error('[fail] stage1 smoke failed:', error.message);
    process.exitCode = 1;
  } finally {
    try {
      const spawnedPorts = [port2, port3];
      for (const peerPort of spawnedPorts) {
        await callWithCallback((cb) => {
          distribution.local.comm.send(
            [],
            { node: { ip: host, port: peerPort }, service: 'status', method: 'stop' },
            cb,
          );
        });
      }
    } catch (error) {
      // ignore cleanup failure
    }

    if (serverStarted && distribution.node.server) {
      const server = distribution.node.server;
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
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
        server.close(() => finish());
        setTimeout(() => finish(), 1500);
      });
    }
  }
}

main().then(() => {
  process.exit(process.exitCode || 0);
});
