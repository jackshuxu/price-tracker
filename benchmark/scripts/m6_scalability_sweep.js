#!/usr/bin/env node

/**
 * M6 Scalability Sweep Benchmark
 *
 * Tests pipeline throughput (crawl → index → query) as the number of
 * distribution nodes grows. Spawns local worker processes on distinct ports
 * for each node count, or accepts a pre-provisioned --peers list for EC2.
 *
 * Metrics recorded per node count N:
 *   - crawlerTput:  snapshots ingested / sec
 *   - indexerTput:  documents indexed  / sec  (MapReduce)
 *   - allTput:      end-to-end docs    / sec  (crawl + index wall time)
 *   - queryP95Ms:   p95 query latency  (ms)
 *   - queryRps:     queries / sec
 *
 * Usage (local, spawns workers on localhost):
 *   node benchmark/scripts/m6_scalability_sweep.js
 *   node benchmark/scripts/m6_scalability_sweep.js --nodes 1,2,4,8 --stores 20
 *
 * Usage (EC2 cluster — coordinator here, workers pre-started on peers):
 *   node benchmark/scripts/m6_scalability_sweep.js \
 *     --peers 10.0.0.2:7070,10.0.0.3:7070,10.0.0.4:7070 \
 *     --nodes 1,2,3,4
 *
 * Output:
 *   benchmark/results/scalability_sweep/results.json
 *   benchmark/results/scalability_sweep/results.md
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');

const {
  callWithCallback,
  startCoordinator,
  stopCoordinator,
  getAllKeys,
  parsePeers,
} = require(path.join(ROOT, 'tj', 'runtime.js'));

const { createServer } = require(path.join(ROOT, 'tj', 'server.js'));

// ─── Defaults ─────────────────────────────────────────────────────────────────

const HOST              = '127.0.0.1';
const COORDINATOR_PORT  = 12520;   // coordinator is always this one local port
const API_PORT          = 18160;
const WORKER_BASE_PORT  = 12600;   // workers get 12600, 12601, 12602, ...
const DEFAULT_NODES     = [1, 2, 4, 8];
const DEFAULT_STORES    = 20;
const DEFAULT_PRODUCTS  = 50;      // products per store
const QUERY_WARMUP      = 3;
const QUERY_ITERATIONS  = 30;
const WORKER_BOOT_MS    = 3000;    // wait after spawning all workers
const WORKER_RETRY_MS   = 300;
const WORKER_MAX_TRIES  = 30;

const QUERY_TERMS = ['egg', 'banana', 'milk', 'bread', 'yogurt'];

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { continue; }
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

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseNodeList(raw, fallback) {
  if (!raw) { return fallback; }
  const parts = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  const nums = parts.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return nums.length ? nums.sort((a, b) => a - b) : fallback;
}

// ─── Stats helpers ────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (!sorted.length) { return null; }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(3));
}

function latencyStats(values) {
  if (!values.length) { return null; }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    avg: Number((sum / values.length).toFixed(3)),
  };
}

function tput(count, wallMs) {
  return Number((count / Math.max(wallMs, 1) * 1000).toFixed(3));
}

// ─── Corpus generation ────────────────────────────────────────────────────────

function buildSnapshots(storeCount, productsPerStore) {
  const TERMS = ['egg', 'banana', 'milk', 'bread', 'yogurt', 'almond', 'oat', 'coffee', 'granola', 'pasta'];
  const CATS  = ['Produce', 'Dairy', 'Bakery', 'Pantry', 'Frozen', 'Beverages'];
  const snapshots = [];

  for (let si = 0; si < storeCount; si += 1) {
    const storeCode = String(800 + si);
    const capturedAt = new Date(Date.now() - si * 60_000).toISOString();
    const products = [];

    for (let pi = 0; pi < productsPerStore; pi += 1) {
      const termA = TERMS[pi % TERMS.length];
      const termB = TERMS[(pi + si + 3) % TERMS.length];
      products.push({
        sku: `SKU_SC_${storeCode}_${String(pi + 1).padStart(4, '0')}`,
        name: `Organic ${termA} ${termB} Mix ${pi + 1}`,
        price: Number((1.49 + (((si * 29) + (pi * 7)) % 700) / 100).toFixed(2)),
        category: CATS[pi % CATS.length],
        size: `${8 + (pi % 24)} oz`,
        storeCode,
        capturedAt,
      });
    }

    snapshots.push({ capturedAt, storeCode, chain: 'trader_joes', products });
  }

  return snapshots;
}

// ─── Sub-process runner ───────────────────────────────────────────────────────

function runScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(process.execPath, [scriptPath, ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${path.basename(scriptPath)} exited ${code}\n${stderr.slice(0, 400)}`));
      }
    });
  });
}

// ─── Worker management (local mode) ──────────────────────────────────────────

function spawnWorker(ip, port) {
  const distPath = path.join(ROOT, 'distribution.js');
  const child = childProcess.spawn(
    process.execPath,
    [distPath, '--ip', ip, '--port', String(port)],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  return child;
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
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWorker(distribution, node, maxTries, retryMs) {
  for (let attempt = 0; attempt < maxTries; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await pingNode(distribution, node);
    if (ok) { return true; }
    // eslint-disable-next-line no-await-in-loop
    await sleep(retryMs);
  }
  return false;
}

async function killWorkers(workers) {
  for (const { child } of workers) {
    try { child.kill('SIGTERM'); } catch { /* best effort */ }
  }
  // Give OS a moment to reclaim ports before the next test round.
  await sleep(1500);
}

// ─── Store cleanup ────────────────────────────────────────────────────────────

async function clearGid(distribution, gid) {
  const keys = await getAllKeys(distribution, gid);
  for (const key of keys) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await callWithCallback((cb) => distribution.all.store.del({ key, gid }, cb));
    } catch { /* idempotent */ }
  }
  return keys.length;
}

async function clearAllGids(distribution) {
  const gids = ['tjraw', 'tjindex', 'tjprices', 'tjstores'];
  for (const gid of gids) {
    // eslint-disable-next-line no-await-in-loop
    await clearGid(distribution, gid);
  }
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function callJson(url) {
  const t0 = process.hrtime.bigint();
  const res = await fetch(url, { cache: 'no-store' });
  const text = await res.text();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, elapsedMs: Number(ms.toFixed(3)) };
}

// ─── Per-node-count measurement ───────────────────────────────────────────────

async function measureAtNodeCount(nodeCount, peers, snapshotFile, storeCount, productCount) {
  const crawlerPath = path.join(ROOT, 'crawler.js');
  const indexerPath = path.join(ROOT, 'indexer.js');
  const totalDocs   = storeCount * productCount;

  console.log(`[scalability]   starting coordinator with ${nodeCount} node(s)...`);
  const runtime = await startCoordinator({
    host: HOST,
    port: COORDINATOR_PORT,
    peers,
    strictGroup: false,
  });
  const distribution = runtime.distribution;

  // Clear any leftover data from a previous round.
  await clearAllGids(distribution);

  // Crawler/indexer subprocesses each call startCoordinator() on this port; release
  // it before spawning them or the child hits EADDRINUSE.
  await stopCoordinator(distribution);

  // ── Crawler ───────────────────────────────────────────────────────────────
  console.log(`[scalability]   crawling ${storeCount} stores...`);
  const crawlerWallStart = Date.now();
  await runScript(crawlerPath, [
    '--host', HOST,
    '--port', String(COORDINATOR_PORT),
    '--snapshot-file', snapshotFile,
    '--raw-gid', 'tjraw',
    '--stores-gid', 'tjstores',
    '--no-fallback',
  ]);
  const crawlerWallMs = Date.now() - crawlerWallStart;

  // ── Indexer (MapReduce) ───────────────────────────────────────────────────
  console.log(`[scalability]   indexing ${totalDocs} docs via MapReduce...`);
  const indexerWallStart = Date.now();
  await runScript(indexerPath, [
    '--host', HOST,
    '--port', String(COORDINATOR_PORT),
    '--input-gid', 'tjraw',
    '--index-gid', 'tjindex',
    '--price-gid', 'tjprices',
  ]);
  const indexerWallMs = Date.now() - indexerWallStart;

  const allWallMs = crawlerWallMs + indexerWallMs;

  // ── Query ─────────────────────────────────────────────────────────────────
  console.log(`[scalability]   benchmarking queries...`);
  const app = await createServer({
    coordinatorHost: HOST,
    coordinatorPort: COORDINATOR_PORT,
    peers,
    strictGroup: false,
  });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(API_PORT, HOST, resolve);
  });

  const base = `http://${HOST}:${API_PORT}`;
  const queries = QUERY_TERMS.map((t) => `/search?q=${t}&limit=10`);

  for (let i = 0; i < QUERY_WARMUP; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await callJson(`${base}${queries[i % queries.length]}`);
  }

  const queryLatencies = [];
  const queryWallStart = Date.now();
  for (let i = 0; i < QUERY_ITERATIONS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await callJson(`${base}${queries[i % queries.length]}`);
    queryLatencies.push(r.elapsedMs);
  }
  const queryWallMs = Math.max(1, Date.now() - queryWallStart);

  await app.stop();

  return {
    nodes: nodeCount,
    storeCount,
    totalDocs,
    crawler: {
      wallMs: crawlerWallMs,
      throughputSnapshotsPerSec: tput(storeCount, crawlerWallMs),
    },
    indexer: {
      wallMs: indexerWallMs,
      throughputDocsPerSec: tput(totalDocs, indexerWallMs),
    },
    allComponents: {
      wallMs: allWallMs,
      throughputDocsPerSec: tput(totalDocs, allWallMs),
    },
    search: {
      latencyMs: latencyStats(queryLatencies),
      throughputRps: tput(QUERY_ITERATIONS, queryWallMs),
    },
  };
}

// ─── Report generation ────────────────────────────────────────────────────────

function buildMarkdown(report) {
  const { rows } = report;
  const lines = [
    '# M6 Scalability Sweep Results',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Corpus: ${report.configuration.storeCount} stores × ${report.configuration.productsPerStore} products = **${report.configuration.totalDocs} docs** per run`,
    '',
    '## Throughput vs Nodes',
    '',
    '| Nodes | Crawler (snapshots/sec) | Indexer (docs/sec) | All Components (docs/sec) | Query p95 (ms) | Query (rps) |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const r of rows) {
    lines.push(
      `| ${r.nodes}` +
      ` | ${r.crawler.throughputSnapshotsPerSec}` +
      ` | ${r.indexer.throughputDocsPerSec}` +
      ` | ${r.allComponents.throughputDocsPerSec}` +
      ` | ${r.search.latencyMs ? r.search.latencyMs.p95 : '—'}` +
      ` | ${r.search.throughputRps} |`,
    );
  }

  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- Local mode spawns N-1 worker processes on ports 12600+.');
  lines.push('- Each round clears tjraw/tjindex/tjprices/tjstores before running.');
  lines.push('- Crawler and indexer are timed as child processes (wall-clock).');
  lines.push('- Query benchmark runs sequentially after indexing completes.');
  lines.push('');

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args     = parseArgs(process.argv);
  const nodeCounts = parseNodeList(args.nodes, DEFAULT_NODES);
  const storeCount = parsePositiveInt(args.stores, DEFAULT_STORES);
  const productCount = parsePositiveInt(args['products-per-store'], DEFAULT_PRODUCTS);
  const useLocalWorkers = !args.peers;

  // Pre-provisioned peers (EC2 mode): use subsets of the provided list.
  const allPeers = args.peers ? parsePeers(String(args.peers)) : [];

  const resultsDir = path.join(__dirname, '..', 'results', 'scalability_sweep');
  fs.mkdirSync(resultsDir, { recursive: true });

  const outJson = path.join(resultsDir, 'results.json');
  const outMd   = path.join(resultsDir, 'results.md');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm6-scalability-'));

  console.log('[scalability] === M6 Scalability Sweep ===');
  console.log(`[scalability] node counts : ${nodeCounts.join(', ')}`);
  console.log(`[scalability] corpus      : ${storeCount} stores × ${productCount} products = ${storeCount * productCount} docs`);
  console.log(`[scalability] mode        : ${useLocalWorkers ? 'local (spawning workers)' : 'EC2 (pre-provisioned peers)'}`);

  const snapshotFile = path.join(tmpDir, 'snapshots.json');
  const snapshots = buildSnapshots(storeCount, productCount);
  fs.writeFileSync(snapshotFile, JSON.stringify(snapshots), 'utf8');

  const rows = [];

  try {
    for (const nodeCount of nodeCounts) {
      console.log(`\n[scalability] ── N = ${nodeCount} node(s) ──`);

      let localWorkers = [];
      let peers = [];

      if (useLocalWorkers) {
        // Spawn N-1 worker processes on localhost.
        const workerCount = nodeCount - 1;

        if (workerCount > 0) {
          console.log(`[scalability]   spawning ${workerCount} local worker(s)...`);

          // Need a throwaway coordinator just to ping workers.
          const probe = await startCoordinator({
            host: HOST,
            port: COORDINATOR_PORT,
            peers: [],
            strictGroup: false,
          });

          for (let w = 0; w < workerCount; w += 1) {
            const wPort = WORKER_BASE_PORT + w;
            const child = spawnWorker(HOST, wPort);
            localWorkers.push({ child, node: { ip: HOST, port: wPort } });
          }

          // Wait for each worker to come online.
          for (const { node } of localWorkers) {
            // eslint-disable-next-line no-await-in-loop
            const ok = await waitForWorker(probe.distribution, node, WORKER_MAX_TRIES, WORKER_RETRY_MS);
            if (!ok) {
              console.warn(`[scalability]   WARNING: worker ${node.ip}:${node.port} did not respond; proceeding`);
            } else {
              peers.push(node);
            }
          }

          await stopCoordinator(probe.distribution);
          console.log(`[scalability]   ${peers.length} worker(s) ready`);
        }
      } else {
        // EC2 mode: use the first nodeCount-1 entries from the provided peer list.
        peers = allPeers.slice(0, nodeCount - 1);
        console.log(`[scalability]   using ${peers.length} pre-provisioned peer(s)`);
      }

      let row;
      try {
        // eslint-disable-next-line no-await-in-loop
        row = await measureAtNodeCount(nodeCount, peers, snapshotFile, storeCount, productCount);
      } catch (err) {
        console.error(`[scalability]   ERROR at N=${nodeCount}: ${err.message}`);
        row = { nodes: nodeCount, error: err.message };
      }

      rows.push(row);

      if (!row.error) {
        console.log(`[scalability]   crawler:  ${row.crawler.throughputSnapshotsPerSec} snapshots/sec`);
        console.log(`[scalability]   indexer:  ${row.indexer.throughputDocsPerSec} docs/sec`);
        console.log(`[scalability]   overall:  ${row.allComponents.throughputDocsPerSec} docs/sec`);
        console.log(`[scalability]   search:   p95=${row.search.latencyMs ? row.search.latencyMs.p95 : '?'}ms  ${row.search.throughputRps} rps`);
      }

      if (useLocalWorkers && localWorkers.length) {
        // eslint-disable-next-line no-await-in-loop
        await killWorkers(localWorkers);
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      configuration: {
        nodeCounts,
        storeCount,
        productsPerStore: productCount,
        totalDocs: storeCount * productCount,
        mode: useLocalWorkers ? 'local' : 'ec2',
      },
      methodology: {
        queryWarmup: QUERY_WARMUP,
        queryIterations: QUERY_ITERATIONS,
        workerBootMs: useLocalWorkers ? WORKER_BOOT_MS : null,
        note: 'Crawler and indexer are wall-clock subprocess timings. Query uses sequential HTTP GET after indexing.',
      },
      rows,
    };

    fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(outMd, buildMarkdown(report), 'utf8');

    console.log(`\n[scalability] JSON → ${outJson}`);
    console.log(`[scalability] MD   → ${outMd}`);
  } catch (error) {
    console.error('[scalability] fatal:', error.message || String(error));
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
