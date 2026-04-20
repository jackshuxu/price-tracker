#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { createServer } = require('../../tj/server.js');
const {
  callWithCallback,
  getAllKeys,
  startCoordinator,
  stopCoordinator,
} = require('../../tj/runtime.js');

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

function safeString(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
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
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });

    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
        return;
      }

      reject(new Error(
        `${path.basename(scriptPath)} exited with ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      ));
    });
  });
}

function getCorpusTerms() {
  return [
    'egg',
    'banana',
    'milk',
    'bread',
    'yogurt',
    'almond',
    'oat',
    'coffee',
    'granola',
    'pasta',
    'cheese',
    'apple',
  ];
}

function getCategories() {
  return [
    'Produce',
    'Dairy',
    'Bakery',
    'Pantry',
    'Frozen',
    'Beverages',
  ];
}

function buildSyntheticSnapshots(storeCount, productsPerStore) {
  const terms = getCorpusTerms();
  const categories = getCategories();
  const snapshots = [];

  for (let storeIndex = 0; storeIndex < storeCount; storeIndex += 1) {
    const storeCode = String(701 + storeIndex);
    const capturedAt = new Date(Date.now() - (storeIndex * 60_000)).toISOString();

    const products = [];
    for (let productIndex = 0; productIndex < productsPerStore; productIndex += 1) {
      const termA = terms[productIndex % terms.length];
      const termB = terms[(productIndex + storeIndex + 3) % terms.length];
      const category = categories[productIndex % categories.length];

      const sku = `SKU_WL_${storeCode}_${String(productIndex + 1).padStart(4, '0')}`;
      const price = Number((1.49 + (((storeIndex * 29) + (productIndex * 7)) % 700) / 100).toFixed(2));

      products.push({
        sku,
        name: `Organic ${termA} ${termB} Blend ${productIndex + 1}`,
        price,
        category,
        size: `${8 + (productIndex % 24)} oz`,
        storeCode,
        capturedAt,
      });
    }

    snapshots.push({
      capturedAt,
      storeCode,
      chain: 'trader_joes',
      products,
    });
  }

  return snapshots;
}

function extractMatch(stdout, regex, fallback = null) {
  const match = stdout.match(regex);
  if (!match) {
    return fallback;
  }
  return match;
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
    elapsedMs: Number(elapsedMs.toFixed(3)),
  };
}

async function clearGid(distribution, gid) {
  const keys = await getAllKeys(distribution, gid);
  for (const key of keys) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await callWithCallback((cb) => distribution.all.store.del({ key, gid }, cb));
    } catch {
      // Keep cleanup idempotent even if keys disappear concurrently.
    }
  }
  return keys.length;
}

function buildMarkdown(report, outJsonPath) {
  const observed = report.observed;
  const querySample = report.apiSamples.searchEgg;

  return [
    '# M6 Target Workload Evidence',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Workload Configuration',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Stores crawled | ${report.configuration.storeCount} |`,
    `| Products per store | ${report.configuration.productsPerStore} |`,
    `| Total synthetic products | ${report.configuration.totalProducts} |`,
    `| Coordinator port | ${report.configuration.coordinatorPort} |`,
    '',
    '## Pipeline Results',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| tjraw snapshot keys | ${observed.tjrawKeys} |`,
    `| tjstores keys | ${observed.tjstoresKeys} |`,
    `| tjprices keys | ${observed.tjpricesKeys} |`,
    `| tjindex keys | ${observed.tjindexKeys} |`,
    `| crawler duration | ${report.pipeline.crawlerDurationMs} ms |`,
    `| indexer duration | ${report.pipeline.indexerDurationMs} ms |`,
    '',
    '## API Spot Checks',
    '',
    '| Endpoint | Status | Latency (ms) | Result size |',
    '| --- | --- | --- | --- |',
    `| /health | ${report.apiSamples.health.status} | ${report.apiSamples.health.elapsedMs} | n/a |`,
    `| /stores | ${report.apiSamples.stores.status} | ${report.apiSamples.stores.elapsedMs} | ${report.apiSamples.stores.resultCount} |`,
    `| /search?q=egg | ${querySample.status} | ${querySample.elapsedMs} | ${querySample.resultCount} |`,
    `| /history/{sku}/{store} | ${report.apiSamples.history.status} | ${report.apiSamples.history.elapsedMs} | ${report.apiSamples.history.resultCount} |`,
    '',
    '## Artifact',
    '',
    `- Machine-readable report: \`${outJsonPath}\``,
    '',
    '## Notes',
    '',
    '- This artifact provides reproducible T2 workload-depth evidence using deterministic synthetic snapshots.',
    '- The pipeline path is exercised through crawler -> indexer -> tj/server APIs on distributed storage groups.',
    '',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(__dirname, '..', '..');

  const host = safeString(args.host || '127.0.0.1');
  const coordinatorPort = parsePositiveInt(args['coordinator-port'] || 12456, 12456);
  const apiPort = parsePositiveInt(args['api-port'] || 18116, 18116);
  const storeCount = parsePositiveInt(args.stores || 30, 30);
  const productsPerStore = parsePositiveInt(args['products-per-store'] || 120, 120);

  const outJson = path.resolve(root, safeString(args['out-json'] || path.join('benchmark', 'results', 'm6_workload_evidence.latest.json')));
  const outMd = path.resolve(root, safeString(args['out-md'] || path.join('benchmark', 'results', 'm6_workload_evidence.latest.md')));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm6-workload-evidence-'));
  const snapshotFile = path.join(tempDir, 'synthetic-snapshots.json');

  const snapshots = buildSyntheticSnapshots(storeCount, productsPerStore);
  fs.writeFileSync(snapshotFile, JSON.stringify(snapshots, null, 2), 'utf8');

  const crawlerPath = path.join(root, 'crawler.js');
  const indexerPath = path.join(root, 'indexer.js');

  let app = null;

  try {
    const prepRuntime = await startCoordinator({
      host,
      port: coordinatorPort,
      peers: [],
      strictGroup: true,
    });

    const clearedBeforeRun = {
      tjraw: await clearGid(prepRuntime.distribution, 'tjraw'),
      tjstores: await clearGid(prepRuntime.distribution, 'tjstores'),
      tjindex: await clearGid(prepRuntime.distribution, 'tjindex'),
      tjprices: await clearGid(prepRuntime.distribution, 'tjprices'),
    };
    await stopCoordinator(prepRuntime.distribution);

    const crawlerStarted = Date.now();
    const crawlerRun = await runNodeScript(
      crawlerPath,
      [
        '--host', host,
        '--port', String(coordinatorPort),
        '--strict-group',
        '--snapshot-file', snapshotFile,
        '--raw-gid', 'tjraw',
        '--stores-gid', 'tjstores',
        '--no-fallback',
      ],
      root,
    );
    const crawlerDurationMs = Date.now() - crawlerStarted;

    const indexerStarted = Date.now();
    const indexerRun = await runNodeScript(
      indexerPath,
      [
        '--host', host,
        '--port', String(coordinatorPort),
        '--strict-group',
        '--input-gid', 'tjraw',
        '--index-gid', 'tjindex',
        '--price-gid', 'tjprices',
      ],
      root,
    );
    const indexerDurationMs = Date.now() - indexerStarted;

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

    const tjrawKeys = (await getAllKeys(distribution, 'tjraw')).length;
    const tjstoresKeys = (await getAllKeys(distribution, 'tjstores')).length;
    const tjpricesKeys = (await getAllKeys(distribution, 'tjprices')).length;
    const tjindexKeys = (await getAllKeys(distribution, 'tjindex')).length;

    const seedStoreCode = snapshots[0].storeCode;
    const seedSku = snapshots[0].products[0].sku;

    const base = `http://${host}:${apiPort}`;
    const health = await callJson(`${base}/health`);
    const stores = await callJson(`${base}/stores`);
    const searchEgg = await callJson(`${base}/search?q=egg&storeCode=${encodeURIComponent(seedStoreCode)}&limit=10`);
    const history = await callJson(`${base}/history/${encodeURIComponent(seedSku)}/${encodeURIComponent(seedStoreCode)}`);

    const crawlerSummary = extractMatch(
      crawlerRun.stdout,
      /\[crawler\] done snapshots=(\d+) products=(\d+) .*fromFile=(\d+) fetchedStores=(\d+) fetchFailures=(\d+) fallbackStores=(\d+) fallbackProducts=(\d+)/,
      null,
    );

    const indexerSummary = extractMatch(
      indexerRun.stdout,
      /\[indexer\] snapshots=(\d+) products=(\d+) docs=(\d+)/,
      null,
    );

    const report = {
      generatedAt: new Date().toISOString(),
      configuration: {
        host,
        coordinatorPort,
        apiPort,
        storeCount,
        productsPerStore,
        totalProducts: storeCount * productsPerStore,
        snapshotFile: 'temp://synthetic-snapshots.json',
      },
      pipeline: {
        clearedBeforeRun,
        crawlerDurationMs,
        indexerDurationMs,
        crawlerSummary: crawlerSummary ? {
          snapshots: Number(crawlerSummary[1]),
          products: Number(crawlerSummary[2]),
          fromFile: Number(crawlerSummary[3]),
          fetchedStores: Number(crawlerSummary[4]),
          fetchFailures: Number(crawlerSummary[5]),
          fallbackStores: Number(crawlerSummary[6]),
          fallbackProducts: Number(crawlerSummary[7]),
        } : null,
        indexerSummary: indexerSummary ? {
          snapshots: Number(indexerSummary[1]),
          products: Number(indexerSummary[2]),
          docs: Number(indexerSummary[3]),
        } : null,
      },
      observed: {
        tjrawKeys,
        tjstoresKeys,
        tjpricesKeys,
        tjindexKeys,
      },
      apiSamples: {
        health: {
          status: health.status,
          elapsedMs: health.elapsedMs,
        },
        stores: {
          status: stores.status,
          elapsedMs: stores.elapsedMs,
          resultCount: Array.isArray(stores.body) ? stores.body.length : 0,
        },
        searchEgg: {
          status: searchEgg.status,
          elapsedMs: searchEgg.elapsedMs,
          resultCount: Array.isArray(searchEgg.body) ? searchEgg.body.length : 0,
        },
        history: {
          status: history.status,
          elapsedMs: history.elapsedMs,
          resultCount: Array.isArray(history.body) ? history.body.length : 0,
        },
      },
      notes: [
        'Target workload is represented as multi-store synthetic TJ snapshots to provide deterministic crawl depth evidence.',
        'This artifact complements correctness/performance artifacts by documenting crawl/index corpus scale.',
      ],
    };

    fs.mkdirSync(path.dirname(outJson), { recursive: true });
    fs.mkdirSync(path.dirname(outMd), { recursive: true });

    const outJsonRelative = path.relative(root, outJson).split(path.sep).join('/');
    fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(outMd, buildMarkdown(report, outJsonRelative), 'utf8');

    console.log(`[done] workload evidence JSON: ${outJson}`);
    console.log(`[done] workload evidence Markdown: ${outMd}`);
    console.log(`[summary] products=${report.configuration.totalProducts} tjpricesKeys=${tjpricesKeys}`);
  } catch (error) {
    console.error('[fail] workload evidence generation failed:', error.message || String(error));
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
