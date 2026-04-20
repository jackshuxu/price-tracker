#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

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

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function percentile(values, p) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(3));
}

async function callJson(url) {
  const started = process.hrtime.bigint();
  const res = await fetch(url, { cache: 'no-store' });
  const text = await res.text();
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return {
    status: res.status,
    body,
    elapsedMs,
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

async function seedDataset(distribution) {
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
        docId: 'SKU_BENCH_EGG_A|701',
        sku: 'SKU_BENCH_EGG_A',
        storeCode: '701',
        name: 'Organic Brown Eggs, 1 Dozen',
        score: 2.3,
        tf: 2,
        lastSeen: '2026-04-16T00:00:00.000Z',
      },
      {
        docId: 'SKU_BENCH_EGG_B|701',
        sku: 'SKU_BENCH_EGG_B',
        storeCode: '701',
        name: 'Large Cage-Free Eggs, 12 ct',
        score: 2.0,
        tf: 2,
        lastSeen: '2026-04-16T00:00:00.000Z',
      },
    ],
  });

  await putRecord(distribution, 'tjindex', 'banana', {
    term: 'banana',
    postings: [
      {
        docId: 'SKU_BENCH_BANANA_A|701',
        sku: 'SKU_BENCH_BANANA_A',
        storeCode: '701',
        name: 'Organic Bananas',
        score: 1.7,
        tf: 2,
        lastSeen: '2026-04-16T00:00:00.000Z',
      },
    ],
  });

  await putRecord(distribution, 'tjprices', 'SKU_BENCH_EGG_A|701', {
    sku: 'SKU_BENCH_EGG_A',
    storeCode: '701',
    name: 'Organic Brown Eggs, 1 Dozen',
    latestPrice: 4.99,
    latestAt: '2026-04-16T00:00:00.000Z',
    history: [
      { capturedAt: '2026-04-14T00:00:00.000Z', price: 4.59 },
      { capturedAt: '2026-04-15T00:00:00.000Z', price: 4.79 },
      { capturedAt: '2026-04-16T00:00:00.000Z', price: 4.99 },
    ],
    samples: 3,
  });

  await putRecord(distribution, 'tjprices', 'SKU_BENCH_EGG_B|701', {
    sku: 'SKU_BENCH_EGG_B',
    storeCode: '701',
    name: 'Large Cage-Free Eggs, 12 ct',
    latestPrice: 4.39,
    latestAt: '2026-04-16T00:00:00.000Z',
    history: [
      { capturedAt: '2026-04-14T00:00:00.000Z', price: 4.69 },
      { capturedAt: '2026-04-15T00:00:00.000Z', price: 4.49 },
      { capturedAt: '2026-04-16T00:00:00.000Z', price: 4.39 },
    ],
    samples: 3,
  });

  await putRecord(distribution, 'tjprices', 'SKU_BENCH_BANANA_A|701', {
    sku: 'SKU_BENCH_BANANA_A',
    storeCode: '701',
    name: 'Organic Bananas',
    latestPrice: 1.99,
    latestAt: '2026-04-16T00:00:00.000Z',
    history: [
      { capturedAt: '2026-04-14T00:00:00.000Z', price: 2.19 },
      { capturedAt: '2026-04-15T00:00:00.000Z', price: 2.09 },
      { capturedAt: '2026-04-16T00:00:00.000Z', price: 1.99 },
    ],
    samples: 3,
  });
}

async function measureEndpoint(url, warmup, iterations) {
  for (let i = 0; i < warmup; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await callJson(url);
  }

  const latencies = [];
  const statuses = {};
  const started = Date.now();

  for (let i = 0; i < iterations; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await callJson(url);
    latencies.push(result.elapsedMs);
    const key = String(result.status);
    statuses[key] = (statuses[key] || 0) + 1;
  }

  const elapsedSec = Math.max(0.001, (Date.now() - started) / 1000);

  return {
    iterations,
    statuses,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: Number(Math.max(...latencies).toFixed(3)),
      min: Number(Math.min(...latencies).toFixed(3)),
      avg: Number((latencies.reduce((sum, v) => sum + v, 0) / latencies.length).toFixed(3)),
    },
    throughputRps: Number((iterations / elapsedSec).toFixed(3)),
  };
}

async function main() {
  const args = parseArgs(process.argv);

  const host = String(args.host || '127.0.0.1');
  const apiPort = parsePositiveInt(args['api-port'] || 18086, 18086);
  const coordinatorPort = parsePositiveInt(args['coordinator-port'] || 12438, 12438);
  const warmup = parsePositiveInt(args.warmup || 5, 5);
  const iterations = parsePositiveInt(args.iterations || 40, 40);

  const outFile = String(
    args.out || path.join('benchmark', 'results', 'm6_characterization.latest.json'),
  );

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

    await seedDataset(app.runtime.distribution);

    const base = `http://${host}:${apiPort}`;

    const health = await measureEndpoint(`${base}/health`, warmup, iterations);
    const searchEgg = await measureEndpoint(`${base}/search?q=egg&storeCode=701&limit=5`, warmup, iterations);
    const searchBanana = await measureEndpoint(`${base}/search?q=banana&storeCode=701&limit=5`, warmup, iterations);
    const historyEgg = await measureEndpoint(`${base}/history/SKU_BENCH_EGG_A/701`, warmup, iterations);
    const stores = await measureEndpoint(`${base}/stores?state=IL`, warmup, iterations);

    const report = {
      generatedAt: new Date().toISOString(),
      environment: {
        host,
        apiPort,
        coordinatorPort,
      },
      methodology: {
        warmup,
        iterations,
        note: 'Seeded synthetic dataset for repeatable stage-1 latency/throughput characterization.',
      },
      endpoints: {
        health,
        searchEgg,
        searchBanana,
        historyEgg,
        stores,
      },
    };

    const absOut = path.resolve(outFile);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, JSON.stringify(report, null, 2), 'utf8');

    console.log(`[done] m6 characterization written: ${absOut}`);
    console.log(`[summary] searchEgg p95=${searchEgg.latencyMs.p95}ms throughput=${searchEgg.throughputRps}rps`);
  } catch (error) {
    console.error('[fail] m6 characterization failed:', error.message || String(error));
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
