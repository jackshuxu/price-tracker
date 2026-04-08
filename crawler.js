#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const {
  parseArgs,
  parsePeers,
  callWithCallback,
  startCoordinator,
  stopCoordinator,
} = require('./tj/runtime.js');

const TJ_GRAPHQL = 'https://www.traderjoes.com/api/graphql';
const TJ_HEADERS = {
  'Content-Type': 'application/json',
  Origin: 'https://www.traderjoes.com',
  Referer: 'https://www.traderjoes.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

const SEARCH_QUERY = `
  query SearchProducts($storeCode: String, $pageSize: Int, $currentPage: Int, $search: String) {
    products(
      filter: { store_code: { eq: $storeCode }, published: { eq: "1" } }
      search: $search
      pageSize: $pageSize
      currentPage: $currentPage
    ) {
      items {
        sku
        item_title
        retail_price
        sales_size
        sales_uom_description
        category_hierarchy { id name }
      }
      page_info { current_page page_size total_pages }
    }
  }
`;

function safeString(v) {
  if (v === undefined || v === null) {
    return '';
  }
  return String(v);
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseCSV(value) {
  return safeString(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeProduct(storeCode, raw) {
  const categoryHierarchy = Array.isArray(raw.category_hierarchy)
    ? raw.category_hierarchy
    : [];
  const topCategory = categoryHierarchy.length > 0
    ? safeString(categoryHierarchy[0].name || '')
    : '';

  return {
    sku: safeString(raw.sku || raw.itemCode || raw.item_code).trim(),
    name: safeString(raw.name || raw.item_title || raw.title).trim(),
    price: toNumber(raw.price !== undefined ? raw.price : raw.retail_price),
    category: safeString(raw.category || topCategory || raw.department || '').trim(),
    size: safeString(raw.size || `${raw.sales_size || ''} ${raw.sales_uom_description || ''}`).trim(),
    storeCode: safeString(raw.storeCode || raw.store_code || storeCode).trim() || 'unknown',
    capturedAt: new Date().toISOString(),
  };
}

async function fetchStoreProducts(storeCode, terms, pageSize) {
  if (typeof fetch !== 'function') {
    throw new Error('global fetch is unavailable in this Node.js runtime');
  }

  const dedup = new Map();

  for (const term of terms) {
    const body = JSON.stringify({
      query: SEARCH_QUERY,
      variables: {
        storeCode,
        search: term,
        pageSize,
        currentPage: 1,
      },
    });

    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(TJ_GRAPHQL, {
      method: 'POST',
      headers: TJ_HEADERS,
      body,
    });

    if (!res.ok) {
      throw new Error(`TJ GraphQL HTTP ${res.status} for store ${storeCode}`);
    }

    // eslint-disable-next-line no-await-in-loop
    const json = await res.json();
    const items = json && json.data && json.data.products && Array.isArray(json.data.products.items)
      ? json.data.products.items
      : [];

    for (const item of items) {
      const product = normalizeProduct(storeCode, item || {});
      if (!product.sku || !product.name) {
        continue;
      }
      const key = `${product.sku}|${product.storeCode}`;
      if (!dedup.has(key)) {
        dedup.set(key, product);
      }
    }
  }

  return Array.from(dedup.values());
}

function fallbackProducts(storeCode) {
  const now = new Date().toISOString();
  return [
    {
      sku: `fallback-${storeCode}-banana`,
      name: 'Organic Bananas',
      price: 1.99,
      category: 'Produce',
      size: '2 lb',
      storeCode,
      capturedAt: now,
    },
    {
      sku: `fallback-${storeCode}-egg`,
      name: 'Large Brown Eggs',
      price: 3.49,
      category: 'Dairy',
      size: '12 ct',
      storeCode,
      capturedAt: now,
    },
  ];
}

function loadSnapshotsFromFile(snapshotFile) {
  const abs = path.resolve(snapshotFile);
  const raw = fs.readFileSync(abs, 'utf-8');
  const parsed = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed && Array.isArray(parsed.snapshots)) {
    return parsed.snapshots;
  }

  throw new Error('snapshot-file must be an array or an object with snapshots array');
}

function normalizeSnapshot(input) {
  const capturedAt = safeString(input.capturedAt || input.ts || input.timestamp).trim() || new Date().toISOString();
  const storeCode = safeString(input.storeCode || input.store_code || input.store).trim() || 'unknown';

  const rawProducts = Array.isArray(input.products)
    ? input.products
    : Array.isArray(input.items)
      ? input.items
      : [];

  const products = rawProducts
    .map((p) => normalizeProduct(storeCode, p || {}))
    .filter((p) => p.sku && p.name);

  return {
    capturedAt,
    storeCode,
    chain: 'trader_joes',
    products,
  };
}

async function writeSnapshot(distribution, rawGid, storesGid, snapshot) {
  const key = `${snapshot.chain}:${snapshot.storeCode}:${snapshot.capturedAt}`;

  await callWithCallback((cb) => distribution.all.store.put(snapshot, { key, gid: rawGid }, cb));
  await callWithCallback((cb) => {
    distribution.all.store.put(
      {
        storeCode: snapshot.storeCode,
        name: `Trader Joe's ${snapshot.storeCode}`,
        city: '',
        state: '',
        address: '',
        zip: '',
        updatedAt: snapshot.capturedAt,
      },
      { key: snapshot.storeCode, gid: storesGid },
      cb,
    );
  });

  return key;
}

async function main() {
  const args = parseArgs(process.argv);

  const host = safeString(args.host || '127.0.0.1');
  const port = Number(args.port || 12400);
  const peers = parsePeers(args.peers || '');

  const rawGid = safeString(args['raw-gid'] || 'tjraw');
  const storesGid = safeString(args['stores-gid'] || 'tjstores');
  const storeCodes = parseCSV(args['store-codes'] || '701');
  const terms = parseCSV(args.terms || 'banana,milk,egg,bread,yogurt');
  const pageSize = Math.max(1, Number(args['page-size'] || 50));
  const snapshotFile = safeString(args['snapshot-file'] || '').trim();
  const allowFallback = !Boolean(args['no-fallback']);

  let runtime = null;

  try {
    runtime = await startCoordinator({
      host,
      port,
      peers,
      strictGroup: Boolean(args['strict-group']),
    });

    const distribution = runtime.distribution;
    const snapshots = [];

    if (snapshotFile) {
      const loaded = loadSnapshotsFromFile(snapshotFile);
      for (const raw of loaded) {
        snapshots.push(normalizeSnapshot(raw || {}));
      }
      console.log(`[crawler] loaded ${snapshots.length} snapshots from file`);
    } else {
      for (const storeCode of storeCodes) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const products = await fetchStoreProducts(storeCode, terms, pageSize);
          snapshots.push({
            capturedAt: new Date().toISOString(),
            storeCode,
            chain: 'trader_joes',
            products,
          });
          console.log(`[crawler] fetched ${products.length} products for store ${storeCode}`);
        } catch (error) {
          if (!allowFallback) {
            throw error;
          }
          const fallback = fallbackProducts(storeCode);
          snapshots.push({
            capturedAt: new Date().toISOString(),
            storeCode,
            chain: 'trader_joes',
            products: fallback,
          });
          console.log(`[crawler] fetch failed for ${storeCode}, used fallback products`);
        }
      }
    }

    let totalProducts = 0;
    for (const snapshot of snapshots) {
      totalProducts += snapshot.products.length;
      // eslint-disable-next-line no-await-in-loop
      const key = await writeSnapshot(distribution, rawGid, storesGid, snapshot);
      console.log(`[crawler] wrote snapshot ${key} (${snapshot.products.length} products)`);
    }

    console.log(`[crawler] done snapshots=${snapshots.length} products=${totalProducts}`);
  } catch (error) {
    console.error(`[crawler] failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (runtime && runtime.distribution) {
      await stopCoordinator(runtime.distribution);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  normalizeProduct,
  normalizeSnapshot,
  fetchStoreProducts,
};
