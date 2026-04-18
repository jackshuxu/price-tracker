#!/usr/bin/env node

/**
 * M6 Correctness Benchmark (T3)
 *
 * Creates a small, known-answer corpus of synthetic documents,
 * indexes them through the full pipeline, and verifies that
 * search queries return the expected top-1 results.
 *
 * Usage:
 *   node benchmark/scripts/m6_correctness.js
 */

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const COORDINATOR_PORT = 12470;
const API_PORT = 18099;
const HOST = '127.0.0.1';

/* ------------------------------------------------------------------ */
/*  Golden-answer corpus                                               */
/* ------------------------------------------------------------------ */

const GOLDEN_CORPUS = [
  {
    storeCode: 'GOLD01',
    capturedAt: '2026-04-10T12:00:00.000Z',
    products: [
      { sku: 'GOLD-ACAI-001', name: 'Organic Acai Berry Smoothie Pack', price: 8.99, category: 'Frozen', size: '12 oz' },
      { sku: 'GOLD-QUINOA-002', name: 'Tri-Color Quinoa Grain Blend', price: 4.49, category: 'Grains', size: '16 oz' },
      { sku: 'GOLD-SRIRACHA-003', name: 'Sriracha Ranch Dressing Sauce', price: 3.29, category: 'Condiments', size: '8 fl oz' },
      { sku: 'GOLD-MATCHA-004', name: 'Japanese Matcha Green Tea Powder', price: 6.99, category: 'Beverages', size: '3.5 oz' },
      { sku: 'GOLD-TRUFFLE-005', name: 'Black Truffle Flatbread Pizza', price: 5.49, category: 'Frozen', size: '8.5 oz' },
    ],
  },
  {
    storeCode: 'GOLD02',
    capturedAt: '2026-04-10T12:00:00.000Z',
    products: [
      { sku: 'GOLD-ACAI-001', name: 'Organic Acai Berry Smoothie Pack', price: 9.29, category: 'Frozen', size: '12 oz' },
      { sku: 'GOLD-KIMCHI-006', name: 'Korean Kimchi Fermented Napa Cabbage', price: 3.99, category: 'Refrigerated', size: '14 oz' },
      { sku: 'GOLD-PESTO-007', name: 'Basil Pesto Genovese Sauce', price: 3.69, category: 'Condiments', size: '6.7 oz' },
      { sku: 'GOLD-MOCHI-008', name: 'Sweet Mochi Rice Cake Ice Cream Vanilla', price: 4.49, category: 'Frozen', size: '9.1 oz' },
      { sku: 'GOLD-LAVASH-009', name: 'Whole Wheat Lavash Flatbread', price: 2.49, category: 'Bakery', size: '9 oz' },
    ],
  },
  {
    storeCode: 'GOLD03',
    capturedAt: '2026-04-11T12:00:00.000Z',
    products: [
      { sku: 'GOLD-ACAI-001', name: 'Organic Acai Berry Smoothie Pack', price: 8.49, category: 'Frozen', size: '12 oz' },
      { sku: 'GOLD-QUINOA-002', name: 'Tri-Color Quinoa Grain Blend', price: 4.49, category: 'Grains', size: '16 oz' },
      { sku: 'GOLD-MATCHA-004', name: 'Japanese Matcha Green Tea Powder', price: 7.29, category: 'Beverages', size: '3.5 oz' },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Golden-answer queries + expected results                           */
/* ------------------------------------------------------------------ */

const GOLDEN_QUERIES = [
  {
    id: 'Q1',
    q: 'acai berry smoothie',
    description: 'Exact product name match — acai smoothie should be top-1',
    expectTop1SkuPrefix: 'GOLD-ACAI',
    expectMinResults: 1,
  },
  {
    id: 'Q2',
    q: 'quinoa grain blend',
    description: 'Quinoa product unique to GOLD01/GOLD03',
    expectTop1SkuPrefix: 'GOLD-QUINOA',
    expectMinResults: 1,
  },
  {
    id: 'Q3',
    q: 'matcha green tea',
    description: 'Matcha product appears in 2 stores',
    expectTop1SkuPrefix: 'GOLD-MATCHA',
    expectMinResults: 1,
  },
  {
    id: 'Q4',
    q: 'kimchi fermented',
    description: 'Kimchi unique to GOLD02',
    expectTop1SkuPrefix: 'GOLD-KIMCHI',
    expectMinResults: 1,
  },
  {
    id: 'Q5',
    q: 'truffle pizza',
    description: 'Truffle flatbread pizza unique to GOLD01',
    expectTop1SkuPrefix: 'GOLD-TRUFFLE',
    expectMinResults: 1,
  },
  {
    id: 'Q6',
    q: 'mochi ice cream vanilla',
    description: 'Mochi product unique to GOLD02',
    expectTop1SkuPrefix: 'GOLD-MOCHI',
    expectMinResults: 1,
  },
  {
    id: 'Q7',
    q: 'sriracha ranch dressing',
    description: 'Sriracha product unique to GOLD01',
    expectTop1SkuPrefix: 'GOLD-SRIRACHA',
    expectMinResults: 1,
  },
  {
    id: 'Q8',
    q: 'nonexistent product xyzabc',
    description: 'Query with no matches should return empty',
    expectTop1SkuPrefix: null,
    expectMinResults: 0,
    expectMaxResults: 0,
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function writeSnapshotsFile(snapshots) {
  const tmpDir = path.join(__dirname, '..', 'golden');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const filePath = path.join(tmpDir, 'correctness_corpus.json');
  fs.writeFileSync(filePath, JSON.stringify(snapshots, null, 2));
  return filePath;
}

function spawnAsync(script, args) {
  const { spawn } = require('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: path.resolve(__dirname, '..', '..'),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${path.basename(script)} exited ${code}\n${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function httpGet(port, pathStr) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${HOST}:${port}${pathStr}`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/*  Main test runner                                                    */
/* ------------------------------------------------------------------ */

async function main() {
  const rootDir = path.resolve(__dirname, '..', '..');
  const resultsDir = path.join(__dirname, '..', 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  console.log('[correctness] === M6 Correctness Benchmark ===\n');

  // 1. Write golden corpus to file
  const snapshotFile = writeSnapshotsFile(GOLDEN_CORPUS);
  console.log(`[correctness] wrote golden corpus → ${path.relative(rootDir, snapshotFile)}`);
  console.log(`[correctness] corpus: ${GOLDEN_CORPUS.length} snapshots, ${GOLDEN_CORPUS.reduce((s, snap) => s + snap.products.length, 0)} products\n`);

  // 2. Run crawler with golden snapshot file
  console.log('[correctness] running crawler with golden corpus...');
  await spawnAsync(path.join(rootDir, 'crawler.js'), [
    '--host', HOST,
    '--port', String(COORDINATOR_PORT),
    '--snapshot-file', snapshotFile,
  ]);
  console.log('[correctness] crawler done\n');

  // 3. Run indexer
  console.log('[correctness] running indexer...');
  await spawnAsync(path.join(rootDir, 'indexer.js'), [
    '--host', HOST,
    '--port', String(COORDINATOR_PORT),
  ]);
  console.log('[correctness] indexer done\n');

  // 4. Start server
  console.log('[correctness] starting tj/server...');
  const { createServer } = require(path.join(rootDir, 'tj', 'server.js'));
  const app = await createServer({
    coordinatorHost: HOST,
    coordinatorPort: COORDINATOR_PORT,
    peers: [],
  });
  await new Promise((resolve) => app.server.listen(API_PORT, HOST, resolve));
  console.log(`[correctness] server listening on ${HOST}:${API_PORT}\n`);

  // 5. Run golden-answer queries
  console.log('[correctness] running golden-answer queries...\n');
  const testResults = [];
  let passed = 0;
  let failed = 0;

  for (const gq of GOLDEN_QUERIES) {
    const url = `/search?q=${encodeURIComponent(gq.q)}&limit=10`;
    const res = await httpGet(API_PORT, url);
    const results = Array.isArray(res.body) ? res.body : [];

    const top1Sku = results.length > 0 ? String(results[0].sku || '') : '(empty)';
    const top1Name = results.length > 0 ? String(results[0].name || '') : '(empty)';
    const numResults = results.length;

    let pass = true;
    const reasons = [];

    // Check min results
    if (numResults < (gq.expectMinResults || 0)) {
      pass = false;
      reasons.push(`expected >= ${gq.expectMinResults} results, got ${numResults}`);
    }

    // Check max results if specified
    if (gq.expectMaxResults !== undefined && numResults > gq.expectMaxResults) {
      pass = false;
      reasons.push(`expected <= ${gq.expectMaxResults} results, got ${numResults}`);
    }

    // Check top-1 sku prefix
    if (gq.expectTop1SkuPrefix !== null && !top1Sku.startsWith(gq.expectTop1SkuPrefix)) {
      pass = false;
      reasons.push(`expected top-1 SKU starting with "${gq.expectTop1SkuPrefix}", got "${top1Sku}"`);
    }

    if (pass) {
      passed += 1;
      console.log(`  ✓ ${gq.id}: ${gq.description}`);
      console.log(`    query="${gq.q}" → top1="${top1Name}" (${top1Sku}), ${numResults} results`);
    } else {
      failed += 1;
      console.log(`  ✗ ${gq.id}: ${gq.description}`);
      console.log(`    query="${gq.q}" → top1="${top1Name}" (${top1Sku}), ${numResults} results`);
      console.log(`    FAIL: ${reasons.join('; ')}`);
    }

    testResults.push({
      id: gq.id,
      query: gq.q,
      description: gq.description,
      resultCount: numResults,
      top1Sku,
      top1Name,
      top1Score: results.length > 0 ? results[0].score : null,
      expectedSkuPrefix: gq.expectTop1SkuPrefix,
      pass,
      failReasons: reasons,
    });
  }

  // 6. Check price history for a known product
  console.log('\n[correctness] checking price history for GOLD-ACAI-001...');
  const histRes = await httpGet(API_PORT, '/history/GOLD-ACAI-001/GOLD01');
  const historyRows = Array.isArray(histRes.body) ? histRes.body : [];
  const historyPass = historyRows.length >= 1;
  if (historyPass) {
    console.log(`  ✓ history: ${historyRows.length} price points found`);
    passed += 1;
  } else {
    console.log(`  ✗ history: expected >= 1 price point, got ${historyRows.length}`);
    failed += 1;
  }
  testResults.push({
    id: 'H1',
    query: 'history/GOLD-ACAI-001/GOLD01',
    description: 'Price history for known product should have >= 1 entry',
    resultCount: historyRows.length,
    top1Sku: 'GOLD-ACAI-001',
    top1Name: 'n/a',
    top1Score: null,
    expectedSkuPrefix: 'GOLD-ACAI',
    pass: historyPass,
    failReasons: historyPass ? [] : ['no history found'],
  });

  // 7. Check stores listing
  console.log('\n[correctness] checking stores listing...');
  const storeRes = await httpGet(API_PORT, '/stores');
  const stores = Array.isArray(storeRes.body) ? storeRes.body : [];
  const goldStores = stores.filter((s) => String(s.storeCode || '').startsWith('GOLD'));
  const storesPass = goldStores.length >= 3;
  if (storesPass) {
    console.log(`  ✓ stores: ${goldStores.length} golden stores found`);
    passed += 1;
  } else {
    console.log(`  ✗ stores: expected >= 3 golden stores, got ${goldStores.length}`);
    failed += 1;
  }
  testResults.push({
    id: 'S1',
    query: 'stores',
    description: 'Store listing should include all 3 golden stores',
    resultCount: goldStores.length,
    top1Sku: 'n/a',
    top1Name: 'n/a',
    top1Score: null,
    expectedSkuPrefix: null,
    pass: storesPass,
    failReasons: storesPass ? [] : ['missing golden stores'],
  });

  // 8. Shut down
  await app.stop();

  // 9. Write results
  const total = passed + failed;
  console.log(`\n[correctness] === Results: ${passed}/${total} passed, ${failed} failed ===\n`);

  const artifact = {
    generatedAt: new Date().toISOString(),
    corpus: {
      snapshots: GOLDEN_CORPUS.length,
      totalProducts: GOLDEN_CORPUS.reduce((s, snap) => s + snap.products.length, 0),
      uniqueSkus: [...new Set(GOLDEN_CORPUS.flatMap((s) => s.products.map((p) => p.sku)))].length,
      stores: GOLDEN_CORPUS.map((s) => s.storeCode),
    },
    summary: {
      total,
      passed,
      failed,
      passRate: total > 0 ? `${((passed / total) * 100).toFixed(1)}%` : 'n/a',
    },
    tests: testResults,
  };

  const jsonPath = path.join(resultsDir, 'm6_correctness.latest.json');
  fs.writeFileSync(jsonPath, JSON.stringify(artifact, null, 2));
  console.log(`[correctness] JSON artifact → ${path.relative(rootDir, jsonPath)}`);

  // Generate markdown
  const mdLines = [
    '# M6 Correctness Benchmark Results',
    '',
    `Generated: ${artifact.generatedAt}`,
    '',
    '## Corpus',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Snapshots (stores) | ${artifact.corpus.snapshots} |`,
    `| Total products | ${artifact.corpus.totalProducts} |`,
    `| Unique SKUs | ${artifact.corpus.uniqueSkus} |`,
    `| Stores | ${artifact.corpus.stores.join(', ')} |`,
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Total tests | ${artifact.summary.total} |`,
    `| Passed | ${artifact.summary.passed} |`,
    `| Failed | ${artifact.summary.failed} |`,
    `| Pass rate | ${artifact.summary.passRate} |`,
    '',
    '## Test Results',
    '',
    '| ID | Query | Expected Top-1 | Actual Top-1 | #Results | Pass |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const t of testResults) {
    const expected = t.expectedSkuPrefix || '(empty)';
    const actual = t.top1Sku || '(empty)';
    mdLines.push(`| ${t.id} | \`${t.query}\` | ${expected} | ${actual} | ${t.resultCount} | ${t.pass ? '✓' : '✗'} |`);
  }

  mdLines.push('');
  mdLines.push('## Notes');
  mdLines.push('');
  mdLines.push('- This benchmark uses a synthetic golden-answer corpus where the correct ranking is known in advance.');
  mdLines.push('- Each query targets a unique product with distinctive terms to verify top-1 correctness.');
  mdLines.push('- The benchmark exercises the full pipeline: crawler → indexer (MR) → query server.');
  mdLines.push('');

  const mdPath = path.join(resultsDir, 'm6_correctness.latest.md');
  fs.writeFileSync(mdPath, mdLines.join('\n'));
  console.log(`[correctness] Markdown artifact → ${path.relative(rootDir, mdPath)}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`[correctness] fatal: ${err.message}`);
  process.exit(1);
});
