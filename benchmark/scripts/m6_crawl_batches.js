#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

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

function parseCsv(value) {
  return safeString(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function chunkArray(values, chunkSize) {
  const chunks = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

function parseStoreCode(raw) {
  if (raw === undefined || raw === null) {
    return '';
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    return String(raw).trim();
  }
  if (typeof raw === 'object') {
    return String(raw.storeCode || raw.store_code || raw.code || raw.clientkey || '').trim();
  }
  return '';
}

function loadStoreCodes(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`store codes file not found: ${abs}`);
  }

  const raw = fs.readFileSync(abs, 'utf-8').trim();
  if (!raw) {
    return [];
  }

  let codes = [];

  if (raw.startsWith('{') || raw.startsWith('[')) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      codes = parsed.map((v) => parseStoreCode(v)).filter(Boolean);
    } else if (parsed && Array.isArray(parsed.stores)) {
      codes = parsed.stores.map((v) => parseStoreCode(v)).filter(Boolean);
    } else {
      throw new Error('json store code file must be an array or object with stores[]');
    }
  } else {
    codes = raw
      .split(/[\r\n,]+/)
      .map((v) => parseStoreCode(v))
      .filter(Boolean);
  }

  return Array.from(new Set(codes));
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

function extractCrawlerStats(stdout) {
  const done = stdout.match(
    /\[crawler\] done snapshots=(\d+) products=(\d+) fromFile=(\d+) fetchedStores=(\d+) fetchFailures=(\d+) fallbackStores=(\d+) fallbackProducts=(\d+)/,
  );

  if (!done) {
    return {
      parsed: false,
      snapshots: 0,
      products: 0,
      fetchedStores: 0,
      fetchFailures: 0,
      fallbackStores: 0,
      fallbackProducts: 0,
    };
  }

  return {
    parsed: true,
    snapshots: Number(done[1]),
    products: Number(done[2]),
    fetchedStores: Number(done[4]),
    fetchFailures: Number(done[5]),
    fallbackStores: Number(done[6]),
    fallbackProducts: Number(done[7]),
  };
}

function sleep(ms) {
  if (!ms || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMarkdown(report, relativeJsonPath) {
  return [
    '# M6 Batch Crawler Report',
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
    `| Total store codes | ${report.configuration.totalStoreCodes} |`,
    `| Batch size | ${report.configuration.batchSize} |`,
    `| Terms | ${report.configuration.terms.join(', ')} |`,
    `| Page size | ${report.configuration.pageSize} |`,
    '',
    '## Aggregate Result',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Completed batches | ${report.aggregate.completedBatches} |`,
    `| Failed batches | ${report.aggregate.failedBatches} |`,
    `| Snapshots | ${report.aggregate.snapshots} |`,
    `| Products | ${report.aggregate.products} |`,
    `| Fetch failures | ${report.aggregate.fetchFailures} |`,
    `| Fallback stores | ${report.aggregate.fallbackStores} |`,
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

  const storeCodesFile = safeString(args['store-codes-file']);
  if (!storeCodesFile) {
    throw new Error('missing required --store-codes-file');
  }

  const storeCodes = loadStoreCodes(path.resolve(root, storeCodesFile));
  if (storeCodes.length === 0) {
    throw new Error('store code list is empty');
  }

  const host = safeString(args.host, '127.0.0.1');
  const port = toPositiveInt(args.port, 12400);
  const peers = parseCsv(args.peers);
  const strictGroup = Boolean(args['strict-group']);

  const batchSize = toPositiveInt(args['batch-size'], 40);
  const pageSize = toPositiveInt(args['page-size'], 200);
  const maxBatches = args['max-batches'] ? toPositiveInt(args['max-batches'], 1) : null;
  const pauseMs = toPositiveInt(args['pause-ms'], 0);

  const terms = parseCsv(
    args.terms || 'banana,milk,egg,bread,yogurt,coffee,oat,pasta,cheese,apple,almond,granola',
  );
  if (terms.length === 0) {
    throw new Error('terms list is empty');
  }

  const rawGid = safeString(args['raw-gid'], 'tjraw');
  const storesGid = safeString(args['stores-gid'], 'tjstores');
  const allowFallback = Boolean(args['allow-fallback']);
  const continueOnError = Boolean(args['continue-on-error']);

  const targetProducts = args['target-products']
    ? toPositiveInt(args['target-products'], 100000)
    : null;

  const outJson = path.resolve(
    root,
    safeString(args['out-json'], path.join('benchmark', 'results', 'm6_crawl_batches.latest.json')),
  );
  const outMd = path.resolve(
    root,
    safeString(args['out-md'], path.join('benchmark', 'results', 'm6_crawl_batches.latest.md')),
  );

  const crawlerScript = path.resolve(root, 'crawler.js');
  const batches = chunkArray(storeCodes, batchSize);
  const plannedBatches = maxBatches ? batches.slice(0, maxBatches) : batches;

  const results = [];
  let snapshots = 0;
  let products = 0;
  let fetchFailures = 0;
  let fallbackStores = 0;
  let fallbackProducts = 0;
  let failedBatches = 0;

  for (let i = 0; i < plannedBatches.length; i += 1) {
    const batch = plannedBatches[i];
    const batchId = i + 1;

    const crawlerArgs = [
      '--host', host,
      '--port', String(port),
      '--store-codes', batch.join(','),
      '--terms', terms.join(','),
      '--page-size', String(pageSize),
      '--raw-gid', rawGid,
      '--stores-gid', storesGid,
    ];

    if (!allowFallback) {
      crawlerArgs.push('--no-fallback');
    }
    if (peers.length > 0) {
      crawlerArgs.push('--peers', peers.join(','));
    }
    if (strictGroup) {
      crawlerArgs.push('--strict-group');
    }

    console.log(`[m6_crawl_batches] batch ${batchId}/${plannedBatches.length} stores=${batch.length}`);

    try {
      // eslint-disable-next-line no-await-in-loop
      const run = await runNodeScript(crawlerScript, crawlerArgs, root);
      const stats = extractCrawlerStats(run.stdout);
      snapshots += stats.snapshots;
      products += stats.products;
      fetchFailures += stats.fetchFailures;
      fallbackStores += stats.fallbackStores;
      fallbackProducts += stats.fallbackProducts;

      results.push({
        batchId,
        storeCount: batch.length,
        elapsedMs: run.elapsedMs,
        stats,
        command: `node ${path.relative(root, crawlerScript)} ${crawlerArgs.join(' ')}`,
        ok: true,
      });
    } catch (error) {
      failedBatches += 1;
      results.push({
        batchId,
        storeCount: batch.length,
        ok: false,
        error: error && error.message ? error.message : String(error),
      });

      if (!continueOnError) {
        throw error;
      }
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(pauseMs);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    configuration: {
      host,
      port,
      peers,
      strictGroup,
      totalStoreCodes: storeCodes.length,
      batchSize,
      plannedBatches: plannedBatches.length,
      pageSize,
      terms,
      rawGid,
      storesGid,
      allowFallback,
      continueOnError,
      targetProducts,
    },
    aggregate: {
      completedBatches: results.filter((r) => r.ok).length,
      failedBatches,
      snapshots,
      products,
      fetchFailures,
      fallbackStores,
      fallbackProducts,
    },
    batches: results,
  };

  ensureDir(outJson);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf-8');

  ensureDir(outMd);
  fs.writeFileSync(outMd, buildMarkdown(report, path.relative(root, outJson)), 'utf-8');

  console.log(`[m6_crawl_batches] report json=${outJson}`);
  console.log(`[m6_crawl_batches] report md=${outMd}`);

  if (targetProducts !== null && products < targetProducts) {
    throw new Error(`products below target (${products} < ${targetProducts})`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[m6_crawl_batches] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  loadStoreCodes,
  extractCrawlerStats,
};
