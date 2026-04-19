#!/usr/bin/env node

/**
 * M6 Component Performance Benchmark
 *
 * Measures latency (p50/p95/p99) and throughput for each system component
 * across two synthetic corpora of different sizes.
 *
 * Components measured:
 *   - Crawler:   snapshot ingestion throughput (snapshots/sec)
 *   - Storage:   raw KV put/get latency and ops/sec
 *   - Indexer:   MapReduce document throughput (docs/sec)
 *   - Search:    query latency (p50/p95/p99) and throughput (rps)
 *
 * Corpus 1 (small):  10 stores  ×  50 products  =   500 docs
 * Corpus 2 (medium): 50 stores  × 100 products  = 5 000 docs
 *
 * Usage:
 *   node benchmark/scripts/m6_component_perf.js [--iterations N] [--out path.json]
 *
 * Requires the distributed backend to be present at the repo root
 * (tj/server.js, tj/runtime.js, crawler.js, indexer.js).
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');

const {
  callWithCallback,
  startCoordinator,
  stopCoordinator,
  getAllKeys,
} = require(path.join(ROOT, 'tj', 'runtime.js'));

const { createServer } = require(path.join(ROOT, 'tj', 'server.js'));

// ─── Configuration ────────────────────────────────────────────────────────────

const HOST = '127.0.0.1';

const CORPORA = [
  {
    id: 'corpus1',
    label: 'Corpus 1 — small',
    stores: 10,
    productsPerStore: 50,
    coordinatorPort: 12510,
    apiPort: 18150,
    kvSampleSize: 100,
  },
  {
    id: 'corpus2',
    label: 'Corpus 2 — medium',
    stores: 50,
    productsPerStore: 100,
    coordinatorPort: 12511,
    apiPort: 18151,
    kvSampleSize: 200,
  },
];

const QUERY_WARMUP = 5;
const DEFAULT_QUERY_ITERATIONS = 40;
const QUERY_TERMS = ['egg', 'banana', 'milk', 'bread', 'yogurt', 'almond', 'oat', 'coffee', 'granola', 'pasta'];

// ─── Utilities ────────────────────────────────────────────────────────────────

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
    min: Number(sorted[0].toFixed(3)),
    max: Number(sorted[sorted.length - 1].toFixed(3)),
  };
}

function throughput(count, wallMs) {
  return Number((count / Math.max(wallMs, 0.001) * 1000).toFixed(3));
}

// ─── Corpus generation ────────────────────────────────────────────────────────

function buildSnapshots(storeCount, productsPerStore) {
  const TERMS = ['egg', 'banana', 'milk', 'bread', 'yogurt', 'almond', 'oat', 'coffee', 'granola', 'pasta'];
  const CATS  = ['Produce', 'Dairy', 'Bakery', 'Pantry', 'Frozen', 'Beverages'];
  const snapshots = [];

  for (let si = 0; si < storeCount; si += 1) {
    const storeCode = String(701 + si);
    const capturedAt = new Date(Date.now() - si * 60_000).toISOString();
    const products = [];

    for (let pi = 0; pi < productsPerStore; pi += 1) {
      const termA = TERMS[pi % TERMS.length];
      const termB = TERMS[(pi + si + 3) % TERMS.length];
      const cat   = CATS[pi % CATS.length];
      products.push({
        sku: `SKU_CP_${storeCode}_${String(pi + 1).padStart(4, '0')}`,
        name: `Organic ${termA} ${termB} Blend ${pi + 1}`,
        price: Number((1.49 + (((si * 29) + (pi * 7)) % 700) / 100).toFixed(2)),
        category: cat,
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
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; process.stderr.write(d); });
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

// ─── KV storage benchmark ─────────────────────────────────────────────────────

async function benchmarkStorage(distribution, gid, sampleSize) {
  // Register the gid (reuse the 'all' group definition)
  const group = await new Promise((resolve, reject) => {
    distribution.local.groups.get('all', (e, g) => (e ? reject(e) : resolve(g)));
  });
  await callWithCallback((cb) => distribution.local.groups.put({ gid }, group, cb));
  try {
    await callWithCallback((cb) => distribution.all.groups.put({ gid }, group, cb));
  } catch {
    // Best-effort broadcast; single-node is fine.
  }

  const keys = Array.from({ length: sampleSize }, (_, i) => `bench_kv_${i}`);

  // ── Put ──
  const putLatencies = [];
  for (const key of keys) {
    const val = { key, payload: `value-${key}`.repeat(8) };
    const t0 = process.hrtime.bigint();
    // eslint-disable-next-line no-await-in-loop
    await callWithCallback((cb) => distribution.all.store.put(val, { key, gid }, cb));
    putLatencies.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }

  // ── Get ──
  const getLatencies = [];
  for (const key of keys) {
    const t0 = process.hrtime.bigint();
    // eslint-disable-next-line no-await-in-loop
    await callWithCallback((cb) => distribution.all.store.get({ key, gid }, cb));
    getLatencies.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }

  const putWallMs = putLatencies.reduce((a, b) => a + b, 0);
  const getWallMs = getLatencies.reduce((a, b) => a + b, 0);

  return {
    sampleSize,
    put: {
      latencyMs: latencyStats(putLatencies),
      throughputOpsPerSec: throughput(sampleSize, putWallMs),
    },
    get: {
      latencyMs: latencyStats(getLatencies),
      throughputOpsPerSec: throughput(sampleSize, getWallMs),
    },
  };
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

// ─── Search benchmark ─────────────────────────────────────────────────────────

async function benchmarkSearch(apiPort, warmup, iterations) {
  const base = `http://${HOST}:${apiPort}`;
  const queries = QUERY_TERMS.map((t) => `/search?q=${t}&limit=10`);

  for (let i = 0; i < warmup; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await callJson(`${base}${queries[i % queries.length]}`);
  }

  const latencies = [];
  const wallStart = Date.now();

  for (let i = 0; i < iterations; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await callJson(`${base}${queries[i % queries.length]}`);
    latencies.push(r.elapsedMs);
  }

  const wallMs = Math.max(1, Date.now() - wallStart);
  return {
    iterations,
    latencyMs: latencyStats(latencies),
    throughputRps: throughput(iterations, wallMs),
  };
}

// ─── Per-corpus benchmark ─────────────────────────────────────────────────────

async function benchmarkCorpus(corpus, snapshotFile, queryIterations) {
  const crawlerPath = path.join(ROOT, 'crawler.js');
  const indexerPath = path.join(ROOT, 'indexer.js');
  const { coordinatorPort, apiPort } = corpus;

  console.log(`[component-perf]   starting coordinator (port ${coordinatorPort})...`);
  let runtime = await startCoordinator({
    host: HOST,
    port: coordinatorPort,
    peers: [],
    strictGroup: true,
  });
  const distribution = runtime.distribution;

  // ── Storage ──────────────────────────────────────────────────────────────
  console.log(`[component-perf]   benchmarking KV storage (${corpus.kvSampleSize} ops)...`);
  const storageResult = await benchmarkStorage(distribution, 'bench_kv_perf', corpus.kvSampleSize);

  await stopCoordinator(distribution);
  console.log(`[component-perf]   coordinator stopped (port ${coordinatorPort})`);

  // ── Crawler ───────────────────────────────────────────────────────────────
  console.log(`[component-perf]   running crawler (${corpus.stores} stores)...`);
  const crawlerWallStart = Date.now();
  await runScript(crawlerPath, [
    '--host', HOST,
    '--port', String(coordinatorPort),
    '--strict-group',
    '--snapshot-file', snapshotFile,
    '--raw-gid', 'tjraw',
    '--stores-gid', 'tjstores',
    '--no-fallback',
  ]);
  const crawlerWallMs = Date.now() - crawlerWallStart;

  // ── Indexer (MapReduce) ───────────────────────────────────────────────────
  const totalDocs = corpus.stores * corpus.productsPerStore;
  console.log(`[component-perf]   running indexer (${totalDocs} docs)...`);
  const indexerWallStart = Date.now();
  await runScript(indexerPath, [
    '--host', HOST,
    '--port', String(coordinatorPort),
    '--strict-group',
    '--input-gid', 'tjraw',
    '--index-gid', 'tjindex',
    '--price-gid', 'tjprices',
  ]);
  const indexerWallMs = Date.now() - indexerWallStart;

  // ── Search ────────────────────────────────────────────────────────────────
  console.log(`[component-perf]   benchmarking search (${queryIterations} queries)...`);
  const app = await createServer({
    coordinatorHost: HOST,
    coordinatorPort,
    peers: [],
    strictGroup: true,
  });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(apiPort, HOST, resolve);
  });

  const searchResult = await benchmarkSearch(apiPort, QUERY_WARMUP, queryIterations);
  await app.stop();

  return {
    corpus: {
      id: corpus.id,
      label: corpus.label,
      stores: corpus.stores,
      productsPerStore: corpus.productsPerStore,
      totalDocs,
    },
    storage: storageResult,
    crawler: {
      wallMs: crawlerWallMs,
      snapshotsIngested: corpus.stores,
      throughputSnapshotsPerSec: throughput(corpus.stores, crawlerWallMs),
      avgLatencyMsPerSnapshot: Number((crawlerWallMs / corpus.stores).toFixed(3)),
    },
    indexer: {
      wallMs: indexerWallMs,
      docsProcessed: totalDocs,
      throughputDocsPerSec: throughput(totalDocs, indexerWallMs),
      avgLatencyMsPerDoc: Number((indexerWallMs / totalDocs).toFixed(3)),
    },
    search: searchResult,
  };
}

// ─── Report generation ────────────────────────────────────────────────────────

function buildMarkdown(report) {
  const lines = [
    '# M6 Component Performance Benchmark',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Warmup: ${report.methodology.queryWarmup} queries · Iterations: ${report.methodology.queryIterations}`,
    '',
  ];

  for (const c of report.corpora) {
    lines.push(`## ${c.corpus.label}`);
    lines.push('');
    lines.push(`Corpus: ${c.corpus.stores} stores × ${c.corpus.productsPerStore} products = **${c.corpus.totalDocs} docs**`);
    lines.push('');
    lines.push('| Component | Throughput | p50 latency | p95 latency | p99 latency |');
    lines.push('| --- | --- | --- | --- | --- |');
    lines.push(
      `| Crawler | ${c.crawler.throughputSnapshotsPerSec} snapshots/sec` +
      ` | ${c.crawler.avgLatencyMsPerSnapshot} ms/snapshot | — | — |`,
    );
    lines.push(
      `| Storage (put) | ${c.storage.put.throughputOpsPerSec} ops/sec` +
      ` | ${c.storage.put.latencyMs.p50} ms | ${c.storage.put.latencyMs.p95} ms | ${c.storage.put.latencyMs.p99} ms |`,
    );
    lines.push(
      `| Storage (get) | ${c.storage.get.throughputOpsPerSec} ops/sec` +
      ` | ${c.storage.get.latencyMs.p50} ms | ${c.storage.get.latencyMs.p95} ms | ${c.storage.get.latencyMs.p99} ms |`,
    );
    lines.push(
      `| Indexer (MR) | ${c.indexer.throughputDocsPerSec} docs/sec` +
      ` | ${c.indexer.avgLatencyMsPerDoc} ms/doc | — | — |`,
    );
    lines.push(
      `| Search | ${c.search.throughputRps} rps` +
      ` | ${c.search.latencyMs.p50} ms | ${c.search.latencyMs.p95} ms | ${c.search.latencyMs.p99} ms |`,
    );
    lines.push('');
  }

  lines.push('## Notes');
  lines.push('');
  lines.push('- Each corpus runs on a fresh coordinator; KV data persists to `store/` keyed by node identity (IP:port).');
  lines.push('- Crawler and indexer are timed as child processes (wall-clock end-to-end).');
  lines.push('- Storage benchmark uses direct `distribution.all.store` put/get calls on a scratch gid.');
  lines.push('- Search benchmark fires HTTP requests at the live query server with 5-request warmup.');
  lines.push('');

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const queryIterations = parsePositiveInt(args.iterations, DEFAULT_QUERY_ITERATIONS);
  const resultsDir = path.join(__dirname, '..', 'results');
  fs.mkdirSync(resultsDir, { recursive: true });

  const outJson = path.resolve(String(args.out || path.join(resultsDir, 'm6_component_perf.latest.json')));
  const outMd   = outJson.replace(/\.json$/, '.md');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm6-component-perf-'));

  try {
    const corporaResults = [];

    for (let ci = 0; ci < CORPORA.length; ci += 1) {
      const corpus = CORPORA[ci];
      console.log(`\n[component-perf] === ${corpus.label} ===`);

      const snapshotFile = path.join(tmpDir, `snapshots_${ci}.json`);
      const snapshots = buildSnapshots(corpus.stores, corpus.productsPerStore);
      fs.writeFileSync(snapshotFile, JSON.stringify(snapshots), 'utf8');

      // eslint-disable-next-line no-await-in-loop
      const result = await benchmarkCorpus(corpus, snapshotFile, queryIterations);
      corporaResults.push(result);

      console.log(`[component-perf]   crawler:  ${result.crawler.throughputSnapshotsPerSec} snapshots/sec (${result.crawler.wallMs}ms total)`);
      console.log(`[component-perf]   storage:  put p95=${result.storage.put.latencyMs.p95}ms  get p95=${result.storage.get.latencyMs.p95}ms`);
      console.log(`[component-perf]   indexer:  ${result.indexer.throughputDocsPerSec} docs/sec (${result.indexer.wallMs}ms total)`);
      console.log(`[component-perf]   search:   p50=${result.search.latencyMs.p50}ms p95=${result.search.latencyMs.p95}ms  ${result.search.throughputRps} rps`);
    }

    const report = {
      generatedAt: new Date().toISOString(),
      methodology: {
        queryWarmup: QUERY_WARMUP,
        queryIterations,
        note: [
          'Crawler and indexer measured as wall-clock subprocess duration.',
          'Storage measured via sequential distribution.all.store put then get.',
          'Search measured via sequential HTTP GET against live query server.',
        ].join(' '),
      },
      corpora: corporaResults,
    };

    fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(outMd, buildMarkdown(report), 'utf8');

    console.log(`\n[component-perf] JSON → ${outJson}`);
    console.log(`[component-perf] MD   → ${outMd}`);
  } catch (error) {
    console.error('[component-perf] fatal:', error.message || String(error));
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
