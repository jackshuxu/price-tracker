#!/usr/bin/env node

const createDistribution = require('../distribution.js');

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

function parseNodeSpec(spec) {
  if (!spec || typeof spec !== 'string') {
    return null;
  }

  const idx = spec.lastIndexOf(':');
  if (idx <= 0 || idx === spec.length - 1) {
    return null;
  }

  const ip = spec.slice(0, idx).trim();
  const port = Number(spec.slice(idx + 1).trim());
  if (!ip || !Number.isInteger(port) || port <= 0) {
    return null;
  }

  return { ip, port };
}

function parsePeers(raw) {
  if (!raw) {
    return [];
  }

  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseNodeSpec)
    .filter(Boolean);
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

function nodeKey(node) {
  return `${node.ip}:${node.port}`;
}

async function pingNode(distribution, node) {
  try {
    await callWithCallback((cb) => {
      distribution.local.comm.send(
        ['sid'],
        { node, gid: 'local', service: 'status', method: 'get' },
        cb,
      );
    });
    return true;
  } catch (error) {
    return false;
  }
}

async function discoverReachablePeers(distribution, peers) {
  const reachable = [];
  for (const peer of peers) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await pingNode(distribution, peer);
    if (ok) {
      reachable.push(peer);
    }
  }
  return reachable;
}

function buildGroup(distribution, selfNode, peers) {
  const group = {};
  const allNodes = [selfNode, ...peers];

  for (const node of allNodes) {
    const sid = distribution.util.id.getSID(node);
    group[sid] = { ip: node.ip, port: node.port };
  }

  return group;
}

async function putGroupEverywhere(distribution, gid, group, strict) {
  await callWithCallback((cb) => distribution.local.groups.put({ gid }, group, cb));

  try {
    await callWithCallback((cb) => distribution.all.groups.put({ gid }, group, cb));
  } catch (error) {
    if (strict) {
      throw error;
    }
  }
}

async function ensureStage1Gids(distribution, group, strict) {
  const gids = ['all', 'tjraw', 'tjindex', 'tjprices', 'tjstores'];

  for (const gid of gids) {
    // eslint-disable-next-line no-await-in-loop
    await putGroupEverywhere(distribution, gid, group, strict);
  }
}

async function startCoordinator(options) {
  const host = String(options.host || '127.0.0.1');
  const port = Number(options.port || 12400);
  const strict = Boolean(options.strictGroup);

  const distribution = createDistribution({ ip: host, port });
  globalThis.distribution = distribution;

  await callWithCallback((cb) => distribution.node.start(cb));

  const selfNode = { ip: host, port };
  const rawPeers = Array.isArray(options.peers) ? options.peers : [];
  const peers = rawPeers.filter((peer) => nodeKey(peer) !== nodeKey(selfNode));
  const reachablePeers = await discoverReachablePeers(distribution, peers);

  const group = buildGroup(distribution, selfNode, reachablePeers);
  await putGroupEverywhere(distribution, 'all', group, strict);
  await ensureStage1Gids(distribution, group, strict);

  return {
    distribution,
    selfNode,
    group,
    reachablePeers,
  };
}

async function stopCoordinator(distribution) {
  if (!distribution || !distribution.node || !distribution.node.server) {
    return;
  }

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

async function getAllKeys(distribution, gid) {
  const keys = await callWithCallback((cb) => distribution.all.store.get({ key: null, gid }, cb));
  return Array.from(new Set((keys || []).map((k) => String(k))));
}

async function mapLimit(items, limit, worker) {
  const size = Math.max(1, Number(limit) || 1);
  const results = new Array(items.length);
  let cursor = 0;

  async function runOne() {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      // eslint-disable-next-line no-await-in-loop
      results[idx] = await worker(items[idx], idx);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(size, items.length || 1); i += 1) {
    workers.push(runOne());
  }

  await Promise.all(workers);
  return results;
}

module.exports = {
  parseArgs,
  parseNodeSpec,
  parsePeers,
  normalizeError,
  callWithCallback,
  startCoordinator,
  stopCoordinator,
  getAllKeys,
  mapLimit,
};
