#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

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

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function safeString(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value);
}

function buildSyntheticSnapshots({
  stores,
  productsPerStore,
  startStoreCode,
  chain,
  capturedAt,
}) {
  const categories = ['Produce', 'Dairy', 'Bakery', 'Pantry', 'Frozen', 'Beverages'];
  const terms = [
    'egg',
    'banana',
    'milk',
    'bread',
    'yogurt',
    'coffee',
    'oat',
    'granola',
    'almond',
    'pasta',
    'apple',
    'cheese',
  ];

  const snapshots = [];

  for (let storeOffset = 0; storeOffset < stores; storeOffset += 1) {
    const storeCode = String(startStoreCode + storeOffset);
    const ts = new Date(capturedAt.getTime() - (storeOffset * 60_000)).toISOString();
    const products = [];

    for (let productOffset = 0; productOffset < productsPerStore; productOffset += 1) {
      const termA = terms[productOffset % terms.length];
      const termB = terms[(productOffset + storeOffset + 3) % terms.length];
      const category = categories[productOffset % categories.length];
      const sku = `SKU_SYN_${storeCode}_${String(productOffset + 1).padStart(4, '0')}`;

      const price = Number(
        (1.39 + (((storeOffset * 31) + (productOffset * 7)) % 900) / 100).toFixed(2),
      );

      products.push({
        sku,
        name: `Synthetic ${termA} ${termB} item ${productOffset + 1}`,
        price,
        category,
        size: `${8 + (productOffset % 24)} oz`,
        storeCode,
        capturedAt: ts,
      });
    }

    snapshots.push({
      capturedAt: ts,
      storeCode,
      chain,
      products,
    });
  }

  return snapshots;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv);

  const root = path.resolve(__dirname, '..', '..');
  const stores = toPositiveInt(args.stores, 600);
  const productsPerStore = toPositiveInt(args['products-per-store'], 200);
  const startStoreCode = toPositiveInt(args['start-store-code'], 701);
  const chain = safeString(args.chain, 'trader_joes');
  const outFile = path.resolve(root, safeString(args.out, path.join('benchmark', 'golden', 'workload_120k.json')));

  const capturedAt = args['captured-at']
    ? new Date(safeString(args['captured-at']))
    : new Date();
  if (Number.isNaN(capturedAt.getTime())) {
    throw new Error(`invalid --captured-at value: ${args['captured-at']}`);
  }

  const snapshots = buildSyntheticSnapshots({
    stores,
    productsPerStore,
    startStoreCode,
    chain,
    capturedAt,
  });

  ensureDir(outFile);
  fs.writeFileSync(outFile, JSON.stringify(snapshots), 'utf-8');

  const totalProducts = stores * productsPerStore;
  const stats = {
    generatedAt: new Date().toISOString(),
    outFile,
    stores,
    productsPerStore,
    totalProducts,
    startStoreCode,
    endStoreCode: startStoreCode + stores - 1,
  };

  console.log(`[m6_generate_snapshot] out=${outFile}`);
  console.log(
    `[m6_generate_snapshot] stores=${stores} productsPerStore=${productsPerStore} totalProducts=${totalProducts}`,
  );

  if (args['stats-file']) {
    const statsFile = path.resolve(root, safeString(args['stats-file']));
    ensureDir(statsFile);
    fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2), 'utf-8');
    console.log(`[m6_generate_snapshot] stats=${statsFile}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[m6_generate_snapshot] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  toPositiveInt,
  buildSyntheticSnapshots,
};
