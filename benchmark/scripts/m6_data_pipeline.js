#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  callWithCallback,
  getAllKeys,
  mapLimit,
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

function safeString(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value);
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parsePeers(value) {
  return safeString(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const idx = item.lastIndexOf(':');
      if (idx <= 0 || idx >= item.length - 1) {
        return null;
      }

      const ip = item.slice(0, idx).trim();
      const port = Number(item.slice(idx + 1).trim());
      if (!ip || !Number.isInteger(port) || port <= 0) {
        return null;
      }

      return { ip, port };
    })
    .filter(Boolean);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function runNodeScript(scriptPath, args, cwd) {
  return new Promise((resolve, reject) => {
    const startedAt = process.hrtime.bigint();
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
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      if (code === 0) {
        resolve({
          code,
          stdout,
          stderr,
          elapsedMs: Number(elapsedMs.toFixed(3)),
        });
        return;
      }

      reject(
        new Error(
          `${path.basename(scriptPath)} exited with ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
  });
}

async function clearGid(distribution, gid, concurrency) {
  const keys = await getAllKeys(distribution, gid);
  await mapLimit(keys, concurrency, async (key) => {
    try {
      await callWithCallback((cb) => distribution.all.store.del({ key, gid }, cb));
    } catch {
      // Keep clear operation idempotent when keys disappear concurrently.
    }
  });
  return keys.length;
}

async function clearGroups(options) {
  const runtime = await startCoordinator({
    host: options.host,
    port: options.port,
    peers: options.peers,
    strictGroup: options.strictGroup,
  });

  try {
    const removed = {};
    for (const gid of options.gids) {
      // eslint-disable-next-line no-await-in-loop
      removed[gid] = await clearGid(runtime.distribution, gid, options.concurrency);
    }
    return {
      removed,
      reachablePeers: runtime.reachablePeers,
    };
  } finally {
    await stopCoordinator(runtime.distribution);
  }
}

function extractCrawlerStats(stdout) {
  const done = stdout.match(
    /\[crawler\] done snapshots=(\d+) products=(\d+) fromFile=(\d+) fetchedStores=(\d+) fetchFailures=(\d+) fallbackStores=(\d+) fallbackProducts=(\d+)/,
  );

  if (!done) {
    return {
      parsed: false,
      snapshots: null,
      products: null,
      fromFile: null,
      fetchedStores: null,
      fetchFailures: null,
      fallbackStores: null,
      fallbackProducts: null,
    };
  }

  return {
    parsed: true,
    snapshots: Number(done[1]),
    products: Number(done[2]),
    fromFile: Number(done[3]),
    fetchedStores: Number(done[4]),
    fetchFailures: Number(done[5]),
    fallbackStores: Number(done[6]),
    fallbackProducts: Number(done[7]),
  };
}

function extractIndexerStats(stdout) {
  const peers = stdout.match(/\[indexer\] reachable peers: (\d+)/);
  const counts = stdout.match(/\[indexer\] snapshots=(\d+) products=(\d+) docs=(\d+)/);
  const terms = stdout.match(/\[indexer\] wrote (\d+) term entries to\s+(\S+)/);
  const prices = stdout.match(/\[indexer\] wrote (\d+) price entries to\s+(\S+)/);

  return {
    parsed: Boolean(peers && counts && terms && prices),
    reachablePeers: peers ? Number(peers[1]) : null,
    snapshots: counts ? Number(counts[1]) : null,
    products: counts ? Number(counts[2]) : null,
    docs: counts ? Number(counts[3]) : null,
    indexedTerms: terms ? Number(terms[1]) : null,
    indexGid: terms ? terms[2] : null,
    indexedPrices: prices ? Number(prices[1]) : null,
    priceGid: prices ? prices[2] : null,
  };
}

function buildMarkdown(report, relativeJsonPath) {
  const crawler = report.pipeline.crawler;
  const indexer = report.pipeline.indexer;
  const checks = report.checks;

  return [
    '# M6 Data Pipeline Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Configuration',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Host | ${report.configuration.host} |`,
    `| Port | ${report.configuration.port} |`,
    `| Peers | ${report.configuration.peers.join(', ') || '(none)'} |`,
    `| Stores | ${report.configuration.stores} |`,
    `| Products per store | ${report.configuration.productsPerStore} |`,
    `| Target products | ${report.configuration.targetProducts} |`,
    `| Snapshot file | ${report.configuration.snapshotFile} |`,
    '',
    '## Pipeline Metrics',
    '',
    '| Stage | Metric | Value |',
    '| --- | --- | --- |',
    `| Clear | Duration (ms) | ${report.pipeline.clear.elapsedMs} |`,
    `| Clear | Removed keys | ${report.pipeline.clear.removedSummary} |`,
    `| Generate | Duration (ms) | ${report.pipeline.generate.elapsedMs} |`,
    `| Crawler | Duration (ms) | ${crawler.elapsedMs} |`,
    `| Crawler | Snapshots | ${crawler.stats.snapshots} |`,
    `| Crawler | Products | ${crawler.stats.products} |`,
    `| Indexer | Duration (ms) | ${indexer.elapsedMs} |`,
    `| Indexer | Reachable peers | ${indexer.stats.reachablePeers} |`,
    `| Indexer | Docs | ${indexer.stats.docs} |`,
    '',
    '## Acceptance Checks',
    '',
    '| Check | Pass | Details |',
    '| --- | --- | --- |',
    `| Crawler products >= target | ${checks.productsAtTarget ? 'yes' : 'no'} | ${checks.productsObserved} / ${report.configuration.targetProducts} |`,
    `| Indexer docs >= target | ${checks.docsAtTarget ? 'yes' : 'no'} | ${checks.docsObserved} / ${report.configuration.targetProducts} |`,
    `| Peer discovery | ${checks.peerDiscovery ? 'yes' : 'no'} | reachable peers=${checks.reachablePeersObserved} |`,
    '',
    '## Artifact',
    '',
    `- JSON report: \`${relativeJsonPath}\``,
    '',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(__dirname, '..', '..');

  const host = safeString(args.host, '127.0.0.1');
  const port = toPositiveInt(args.port, 12400);
  const peers = parsePeers(args.peers);
  const peerSpecs = peers.map((peer) => `${peer.ip}:${peer.port}`);
  const strictGroup = Boolean(args['strict-group']);

  const stores = toPositiveInt(args.stores, 600);
  const productsPerStore = toPositiveInt(args['products-per-store'], 200);
  const startStoreCode = toPositiveInt(args['start-store-code'], 701);
  const targetProducts = toPositiveInt(args['target-products'], 100000);

  const snapshotFile = path.resolve(
    root,
    safeString(args['snapshot-file'], path.join('benchmark', 'golden', 'workload_120k.json')),
  );

  const rawGid = safeString(args['raw-gid'], 'tjraw');
  const storesGid = safeString(args['stores-gid'], 'tjstores');
  const inputGid = safeString(args['input-gid'], rawGid);
  const indexGid = safeString(args['index-gid'], 'tjindex');
  const priceGid = safeString(args['price-gid'], 'tjprices');
  const summaryKey = safeString(args['summary-key'], '_meta:indexer');
  const topK = toPositiveInt(args['top-k'], 100);
  const concurrency = toPositiveInt(args.concurrency, 16);
  const shuffleBatchSize = toPositiveInt(args['shuffle-batch-size'], 200);
  const shuffleConcurrency = toPositiveInt(args['shuffle-concurrency'], 64);
  const keepExisting = Boolean(args['keep-existing']);
  const keepInput = Boolean(args['keep-input']);

  const outJson = path.resolve(
    root,
    safeString(args['out-json'], path.join('benchmark', 'results', 'm6_data_pipeline.latest.json')),
  );
  const outMd = path.resolve(
    root,
    safeString(args['out-md'], path.join('benchmark', 'results', 'm6_data_pipeline.latest.md')),
  );

  const generateScript = path.resolve(__dirname, 'm6_generate_snapshot.js');
  const crawlerScript = path.resolve(root, 'crawler.js');
  const indexerScript = path.resolve(root, 'indexer.js');

  const clearTargets = Array.from(new Set([rawGid, storesGid, inputGid]));
  let clearResult = {
    elapsedMs: 0,
    removed: {},
    removedSummary: keepInput ? 'skipped (--keep-input)' : '',
    reachablePeers: [],
  };

  if (!keepInput) {
    console.log('[m6_data_pipeline] clearing existing input groups...');
    const clearStart = process.hrtime.bigint();
    const cleared = await clearGroups({
      host,
      port,
      peers,
      strictGroup,
      gids: clearTargets,
      concurrency,
    });
    const elapsed = Number(process.hrtime.bigint() - clearStart) / 1e6;
    const removedSummary = clearTargets
      .map((gid) => `${gid}:${Number(cleared.removed[gid] || 0)}`)
      .join(', ');

    clearResult = {
      elapsedMs: Number(elapsed.toFixed(3)),
      removed: cleared.removed,
      removedSummary,
      reachablePeers: cleared.reachablePeers,
    };

    console.log(`[m6_data_pipeline] cleared ${removedSummary}`);
  }

  const generateArgs = [
    '--stores', String(stores),
    '--products-per-store', String(productsPerStore),
    '--start-store-code', String(startStoreCode),
    '--out', path.relative(root, snapshotFile),
  ];

  const crawlerArgs = [
    '--host', host,
    '--port', String(port),
    '--snapshot-file', path.relative(root, snapshotFile),
    '--raw-gid', rawGid,
    '--stores-gid', storesGid,
    '--no-fallback',
  ];
  if (peerSpecs.length > 0) {
    crawlerArgs.push('--peers', peerSpecs.join(','));
  }
  if (strictGroup) {
    crawlerArgs.push('--strict-group');
  }

  const indexerArgs = [
    '--host', host,
    '--port', String(port),
    '--input-gid', inputGid,
    '--index-gid', indexGid,
    '--price-gid', priceGid,
    '--summary-key', summaryKey,
    '--top-k', String(topK),
    '--concurrency', String(concurrency),
    '--shuffle-batch-size', String(shuffleBatchSize),
    '--shuffle-concurrency', String(shuffleConcurrency),
  ];
  if (peerSpecs.length > 0) {
    indexerArgs.push('--peers', peerSpecs.join(','));
  }
  if (strictGroup) {
    indexerArgs.push('--strict-group');
  }
  if (keepExisting) {
    indexerArgs.push('--keep-existing');
  }

  console.log('[m6_data_pipeline] generating synthetic snapshot...');
  const generateResult = await runNodeScript(generateScript, generateArgs, root);

  console.log('[m6_data_pipeline] ingesting snapshot via crawler...');
  const crawlerResult = await runNodeScript(crawlerScript, crawlerArgs, root);

  console.log('[m6_data_pipeline] indexing via distributed MR...');
  const indexerResult = await runNodeScript(indexerScript, indexerArgs, root);

  const crawlerStats = extractCrawlerStats(crawlerResult.stdout);
  const indexerStats = extractIndexerStats(indexerResult.stdout);

  const productsObserved = Number(crawlerStats.products) || 0;
  const docsObserved = Number(indexerStats.docs) || 0;
  const reachablePeersObserved = Number(indexerStats.reachablePeers) || 0;

  const report = {
    generatedAt: new Date().toISOString(),
    configuration: {
      host,
      port,
      peers: peerSpecs,
      strictGroup,
      stores,
      productsPerStore,
      startStoreCode,
      targetProducts,
      snapshotFile: path.relative(root, snapshotFile),
      gids: {
        rawGid,
        storesGid,
        inputGid,
        indexGid,
        priceGid,
      },
      topK,
      concurrency,
      shuffleBatchSize,
      shuffleConcurrency,
      keepExisting,
      keepInput,
    },
    pipeline: {
      clear: clearResult,
      generate: {
        elapsedMs: generateResult.elapsedMs,
        command: `node ${path.relative(root, generateScript)} ${generateArgs.join(' ')}`,
      },
      crawler: {
        elapsedMs: crawlerResult.elapsedMs,
        command: `node ${path.relative(root, crawlerScript)} ${crawlerArgs.join(' ')}`,
        stats: crawlerStats,
      },
      indexer: {
        elapsedMs: indexerResult.elapsedMs,
        command: `node ${path.relative(root, indexerScript)} ${indexerArgs.join(' ')}`,
        stats: indexerStats,
      },
    },
    checks: {
      productsObserved,
      docsObserved,
      reachablePeersObserved,
      productsAtTarget: productsObserved >= targetProducts,
      docsAtTarget: docsObserved >= targetProducts,
      peerDiscovery: peerSpecs.length === 0 ? true : reachablePeersObserved > 0,
    },
  };

  writeJson(outJson, report);
  ensureDir(outMd);
  fs.writeFileSync(outMd, buildMarkdown(report, path.relative(root, outJson)), 'utf-8');

  console.log(`[m6_data_pipeline] report json=${outJson}`);
  console.log(`[m6_data_pipeline] report md=${outMd}`);

  if (!report.checks.productsAtTarget || !report.checks.docsAtTarget || !report.checks.peerDiscovery) {
    const failures = [];
    if (!report.checks.productsAtTarget) {
      failures.push(`products below target (${productsObserved} < ${targetProducts})`);
    }
    if (!report.checks.docsAtTarget) {
      failures.push(`docs below target (${docsObserved} < ${targetProducts})`);
    }
    if (!report.checks.peerDiscovery) {
      failures.push(`peer discovery failed (reachablePeers=${reachablePeersObserved})`);
    }

    throw new Error(`acceptance checks failed: ${failures.join('; ')}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[m6_data_pipeline] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  extractCrawlerStats,
  extractIndexerStats,
};
