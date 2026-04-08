#!/usr/bin/env node

const {
  parseArgs,
  parsePeers,
  callWithCallback,
  startCoordinator,
  stopCoordinator,
  getAllKeys,
  mapLimit,
} = require('./tj/runtime.js');

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

function toIso(ts) {
  if (!ts) {
    return new Date().toISOString();
  }
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString();
  }
  return d.toISOString();
}

function parseStoreCode(input) {
  if (input === undefined || input === null) {
    return '';
  }
  if (typeof input === 'number' && Number.isFinite(input)) {
    return String(input);
  }
  if (typeof input === 'string') {
    return input.trim();
  }
  if (typeof input === 'object') {
    return (
      safeString(input.storeCode || input.store_code || input.store || input.code || input.id || input.clientkey)
    ).trim();
  }
  return '';
}

function extractProductsLocal(snapshot, snapshotKey) {
  let storeCode = parseStoreCode(snapshot && (snapshot.storeCode || snapshot.store_code || snapshot.store));
  const capturedAt = toIso(snapshot && (snapshot.capturedAt || snapshot.ts || snapshot.timestamp || snapshot.lastUpdated));

  let candidates = [];

  if (Array.isArray(snapshot)) {
    candidates = snapshot;
  } else if (snapshot && typeof snapshot === 'object') {
    if (Array.isArray(snapshot.products)) {
      candidates = snapshot.products;
    } else if (Array.isArray(snapshot.items)) {
      candidates = snapshot.items;
    } else if (snapshot.data && snapshot.data.products && Array.isArray(snapshot.data.products.items)) {
      candidates = snapshot.data.products.items;
    } else if (snapshot.payload && Array.isArray(snapshot.payload.products)) {
      candidates = snapshot.payload.products;
    }
  }

  const normalized = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const p = candidates[i] || {};
    const sku = safeString(p.sku || p.itemCode || p.item_code || p.id).trim();
    const name = safeString(p.name || p.item_title || p.title).trim();
    const productStore = parseStoreCode(p.storeCode || p.store_code || p.store || storeCode);
    if (!storeCode && productStore) {
      storeCode = productStore;
    }

    const finalStore = productStore || storeCode || 'unknown';
    const finalSku = sku || `${snapshotKey || 'snapshot'}:${i}`;
    const price = toNumber(p.price !== undefined ? p.price : p.retail_price);

    normalized.push({
      sku: finalSku,
      name,
      category: safeString(p.category || p.category_name || p.department || '').trim(),
      size: safeString(p.size || p.sales_size || p.sales_uom_description || '').trim(),
      storeCode: finalStore,
      capturedAt: toIso(p.capturedAt || p.ts || p.timestamp || capturedAt),
      price,
    });
  }

  return normalized;
}

async function clearGid(distribution, gid, concurrency) {
  const keys = await getAllKeys(distribution, gid);
  await mapLimit(keys, concurrency, async (key) => {
    try {
      await callWithCallback((cb) => distribution.all.store.del({ key, gid }, cb));
    } catch (error) {
      // Ignore delete misses to keep clear operation idempotent.
    }
  });
  return keys.length;
}

async function computeDocUniverse(distribution, inputGid, concurrency) {
  const keys = await getAllKeys(distribution, inputGid);
  let productCount = 0;

  await mapLimit(keys, concurrency, async (key) => {
    let snapshot = null;
    try {
      snapshot = await callWithCallback((cb) => distribution.all.store.get({ key, gid: inputGid }, cb));
    } catch (error) {
      return;
    }

    const products = extractProductsLocal(snapshot, key);
    productCount += products.length;
  });

  return {
    snapshotCount: keys.length,
    productCount,
  };
}

function docCountMap(snapshotKey, snapshotValue) {
  function safe(v) {
    return v === undefined || v === null ? '' : String(v);
  }

  function parseStoreCode(input) {
    if (input === undefined || input === null) {
      return '';
    }
    if (typeof input === 'number' && Number.isFinite(input)) {
      return String(input);
    }
    if (typeof input === 'string') {
      return input.trim();
    }
    if (typeof input === 'object') {
      return safe(input.storeCode || input.store_code || input.store || input.code || input.id || input.clientkey).trim();
    }
    return '';
  }

  function extractProducts(snapshot, key) {
    let baseStore = parseStoreCode(snapshot && (snapshot.storeCode || snapshot.store_code || snapshot.store));

    let candidates = [];
    if (Array.isArray(snapshot)) {
      candidates = snapshot;
    } else if (snapshot && typeof snapshot === 'object') {
      if (Array.isArray(snapshot.products)) {
        candidates = snapshot.products;
      } else if (Array.isArray(snapshot.items)) {
        candidates = snapshot.items;
      } else if (snapshot.data && snapshot.data.products && Array.isArray(snapshot.data.products.items)) {
        candidates = snapshot.data.products.items;
      } else if (snapshot.payload && Array.isArray(snapshot.payload.products)) {
        candidates = snapshot.payload.products;
      }
    }

    const out = [];
    for (let i = 0; i < candidates.length; i += 1) {
      const p = candidates[i] || {};
      const sku = safe(p.sku || p.itemCode || p.item_code || p.id).trim() || `${safe(key)}:${i}`;
      const store = parseStoreCode(p.storeCode || p.store_code || p.store || baseStore) || 'unknown';
      if (!baseStore && store) {
        baseStore = store;
      }
      out.push({ sku, storeCode: store });
    }
    return out;
  }

  const products = extractProducts(snapshotValue, snapshotKey);
  const outputs = [];
  for (const product of products) {
    outputs.push({ [`${product.sku}|${product.storeCode}`]: 1 });
  }
  return outputs;
}

function docCountCombiner(key, values) {
  return { [key]: 1 };
}

function docCountReduce(key, values) {
  return {};
}

async function computeTotalDocsDistributed(mrService, shuffleBatchSize, shuffleConcurrency) {
  const result = await callWithCallback((cb) => {
    mrService.exec(
      {
        map: docCountMap,
        combiner: docCountCombiner,
        reduce: docCountReduce,
        outputGid: '__mr_doccount_noop',
        batchSize: shuffleBatchSize,
        shuffleConcurrency,
      },
      cb,
    );
  });

  return Math.max(0, Number(result && result.reducedKeys) || 0);
}

function indexMap(snapshotKey, snapshotValue) {
  const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
    'is', 'it', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'with',
    'you', 'your', 'our', 'we', 'they', 'he', 'she', 'its', 'was', 'were', 'will',
    'can', 'could', 'would', 'should', 'about', 'after', 'before', 'than', 'then',
  ]);

  function safe(v) {
    return v === undefined || v === null ? '' : String(v);
  }

  function normText(text) {
    return safe(text)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function stem(token) {
    let t = token;
    if (t.length > 4 && t.endsWith('ies')) {
      return `${t.slice(0, -3)}y`;
    }
    if (t.length > 5 && t.endsWith('ing')) {
      t = t.slice(0, -3);
    } else if (t.length > 4 && t.endsWith('ed')) {
      t = t.slice(0, -2);
    } else if (t.length > 4 && t.endsWith('es')) {
      t = t.slice(0, -2);
    } else if (t.length > 3 && t.endsWith('s')) {
      t = t.slice(0, -1);
    }
    return t;
  }

  function tokenize(text) {
    return normText(text)
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .filter((tok) => !STOPWORDS.has(tok))
      .map((tok) => stem(tok))
      .filter(Boolean);
  }

  function ngrams(tokens) {
    const out = [];
    for (let i = 0; i < tokens.length; i += 1) {
      out.push(tokens[i]);
    }
    for (let i = 0; i + 1 < tokens.length; i += 1) {
      out.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
    for (let i = 0; i + 2 < tokens.length; i += 1) {
      out.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
    }
    return out;
  }

  function parseStoreCode(input) {
    if (input === undefined || input === null) {
      return '';
    }
    if (typeof input === 'number' && Number.isFinite(input)) {
      return String(input);
    }
    if (typeof input === 'string') {
      return input.trim();
    }
    if (typeof input === 'object') {
      return safe(input.storeCode || input.store_code || input.store || input.code || input.id || input.clientkey).trim();
    }
    return '';
  }

  function toIso(ts) {
    const d = new Date(ts || Date.now());
    if (Number.isNaN(d.getTime())) {
      return new Date().toISOString();
    }
    return d.toISOString();
  }

  function extractProducts(snapshot, key) {
    let baseStore = parseStoreCode(snapshot && (snapshot.storeCode || snapshot.store_code || snapshot.store));
    const baseTs = toIso(snapshot && (snapshot.capturedAt || snapshot.ts || snapshot.timestamp));

    let candidates = [];
    if (Array.isArray(snapshot)) {
      candidates = snapshot;
    } else if (snapshot && typeof snapshot === 'object') {
      if (Array.isArray(snapshot.products)) {
        candidates = snapshot.products;
      } else if (Array.isArray(snapshot.items)) {
        candidates = snapshot.items;
      } else if (snapshot.data && snapshot.data.products && Array.isArray(snapshot.data.products.items)) {
        candidates = snapshot.data.products.items;
      } else if (snapshot.payload && Array.isArray(snapshot.payload.products)) {
        candidates = snapshot.payload.products;
      }
    }

    const out = [];
    for (let i = 0; i < candidates.length; i += 1) {
      const p = candidates[i] || {};
      const sku = safe(p.sku || p.itemCode || p.item_code || p.id).trim() || `${safe(key)}:${i}`;
      const store = parseStoreCode(p.storeCode || p.store_code || p.store || baseStore) || 'unknown';
      if (!baseStore && store) {
        baseStore = store;
      }

      out.push({
        sku,
        name: safe(p.name || p.item_title || p.title).trim(),
        category: safe(p.category || p.category_name || p.department || '').trim(),
        size: safe(p.size || p.sales_size || p.sales_uom_description || '').trim(),
        storeCode: store,
        capturedAt: toIso(p.capturedAt || p.ts || p.timestamp || baseTs),
      });
    }
    return out;
  }

  const products = extractProducts(snapshotValue, snapshotKey);
  const outputs = [];

  for (const product of products) {
    const text = `${product.name} ${product.category} ${product.size}`.trim();
    const terms = ngrams(tokenize(text));
    if (terms.length === 0) {
      continue;
    }

    const freq = {};
    for (const term of terms) {
      freq[term] = (freq[term] || 0) + 1;
    }

    const docId = `${product.sku}|${product.storeCode}`;
    for (const [term, tf] of Object.entries(freq)) {
      outputs.push({
        [term]: {
          docId,
          tf,
          sku: product.sku,
          storeCode: product.storeCode,
          name: product.name,
          lastSeen: product.capturedAt,
        },
      });
    }
  }

  return outputs;
}

function indexCombiner(term, rows) {
  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function toTs(v) {
    const t = new Date(v || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  const byDoc = {};
  const normalizedRows = [];
  for (const row of rows || []) {
    if (Array.isArray(row)) {
      for (const nested of row) {
        normalizedRows.push(nested);
      }
    } else {
      normalizedRows.push(row);
    }
  }

  for (const row of normalizedRows) {
    if (!row || !row.docId) {
      continue;
    }

    if (!byDoc[row.docId]) {
      byDoc[row.docId] = {
        docId: row.docId,
        tf: 0,
        sku: row.sku || '',
        storeCode: row.storeCode || '',
        name: row.name || '',
        lastSeen: row.lastSeen || '',
      };
    }

    byDoc[row.docId].tf += toNum(row.tf);

    const oldTs = toTs(byDoc[row.docId].lastSeen);
    const newTs = toTs(row.lastSeen);
    if (newTs >= oldTs) {
      byDoc[row.docId].lastSeen = row.lastSeen || byDoc[row.docId].lastSeen;
      if (row.name) {
        byDoc[row.docId].name = row.name;
      }
      if (row.sku) {
        byDoc[row.docId].sku = row.sku;
      }
      if (row.storeCode) {
        byDoc[row.docId].storeCode = row.storeCode;
      }
    }
  }

  return {
    [term]: Object.values(byDoc),
  };
}

function indexReduce(term, rows, constants) {
  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function toTs(v) {
    const t = new Date(v || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  const byDoc = {};
  const normalizedRows = [];
  for (const row of rows || []) {
    if (Array.isArray(row)) {
      for (const nested of row) {
        normalizedRows.push(nested);
      }
    } else {
      normalizedRows.push(row);
    }
  }

  for (const row of normalizedRows) {
    if (!row || !row.docId) {
      continue;
    }

    if (!byDoc[row.docId]) {
      byDoc[row.docId] = {
        docId: row.docId,
        tf: 0,
        sku: row.sku || '',
        storeCode: row.storeCode || '',
        name: row.name || '',
        lastSeen: row.lastSeen || '',
      };
    }

    byDoc[row.docId].tf += toNum(row.tf);

    const oldTs = toTs(byDoc[row.docId].lastSeen);
    const newTs = toTs(row.lastSeen);
    if (newTs >= oldTs) {
      byDoc[row.docId].lastSeen = row.lastSeen || byDoc[row.docId].lastSeen;
      if (row.name) {
        byDoc[row.docId].name = row.name;
      }
      if (row.sku) {
        byDoc[row.docId].sku = row.sku;
      }
      if (row.storeCode) {
        byDoc[row.docId].storeCode = row.storeCode;
      }
    }
  }

  const postings = Object.values(byDoc).sort((a, b) => {
    if (a.tf !== b.tf) {
      return b.tf - a.tf;
    }
    return String(a.docId).localeCompare(String(b.docId));
  });

  const topK = Math.max(1, Number(constants && constants.topK ? constants.topK : 100));
  const totalDocs = Math.max(1, Number(constants && constants.totalDocs ? constants.totalDocs : postings.length));
  const df = postings.length;
  const idf = Math.log((totalDocs + 1) / (df + 1)) + 1;

  const ranked = postings
    .map((p) => {
      const tf = Number(p.tf) || 0;
      return {
        docId: p.docId,
        tf,
        score: Number((tf * idf).toFixed(6)),
        sku: p.sku || '',
        storeCode: p.storeCode || '',
        name: p.name || '',
        lastSeen: p.lastSeen || null,
      };
    })
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      if (a.tf !== b.tf) {
        return b.tf - a.tf;
      }
      return String(a.docId).localeCompare(String(b.docId));
    })
    .slice(0, topK);

  return {
    [term]: {
      term,
      df,
      totalDocs,
      idf: Number(idf.toFixed(6)),
      postings: ranked,
      updatedAt: new Date().toISOString(),
    },
  };
}

function priceMap(snapshotKey, snapshotValue) {
  function safe(v) {
    return v === undefined || v === null ? '' : String(v);
  }

  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function toIso(ts) {
    const d = new Date(ts || Date.now());
    if (Number.isNaN(d.getTime())) {
      return new Date().toISOString();
    }
    return d.toISOString();
  }

  function parseStoreCode(input) {
    if (input === undefined || input === null) {
      return '';
    }
    if (typeof input === 'number' && Number.isFinite(input)) {
      return String(input);
    }
    if (typeof input === 'string') {
      return input.trim();
    }
    if (typeof input === 'object') {
      return safe(input.storeCode || input.store_code || input.store || input.code || input.id || input.clientkey).trim();
    }
    return '';
  }

  function extractProducts(snapshot, key) {
    let baseStore = parseStoreCode(snapshot && (snapshot.storeCode || snapshot.store_code || snapshot.store));
    const baseTs = toIso(snapshot && (snapshot.capturedAt || snapshot.ts || snapshot.timestamp));

    let candidates = [];
    if (Array.isArray(snapshot)) {
      candidates = snapshot;
    } else if (snapshot && typeof snapshot === 'object') {
      if (Array.isArray(snapshot.products)) {
        candidates = snapshot.products;
      } else if (Array.isArray(snapshot.items)) {
        candidates = snapshot.items;
      } else if (snapshot.data && snapshot.data.products && Array.isArray(snapshot.data.products.items)) {
        candidates = snapshot.data.products.items;
      } else if (snapshot.payload && Array.isArray(snapshot.payload.products)) {
        candidates = snapshot.payload.products;
      }
    }

    const out = [];
    for (let i = 0; i < candidates.length; i += 1) {
      const p = candidates[i] || {};
      const sku = safe(p.sku || p.itemCode || p.item_code || p.id).trim();
      const store = parseStoreCode(p.storeCode || p.store_code || p.store || baseStore) || 'unknown';
      const price = toNum(p.price !== undefined ? p.price : p.retail_price);
      if (!sku || price === null) {
        continue;
      }
      out.push({
        sku,
        storeCode: store,
        price,
        name: safe(p.name || p.item_title || p.title).trim(),
        capturedAt: toIso(p.capturedAt || p.ts || p.timestamp || baseTs),
      });
    }
    return out;
  }

  const products = extractProducts(snapshotValue, snapshotKey);
  const outputs = [];

  for (const product of products) {
    const key = `${product.sku}|${product.storeCode}`;
    outputs.push({
      [key]: {
        sku: product.sku,
        storeCode: product.storeCode,
        name: product.name,
        price: product.price,
        capturedAt: product.capturedAt,
      },
    });
  }

  return outputs;
}

function priceCombiner(key, rows) {
  function toTs(v) {
    const t = new Date(v || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  const dedup = {};
  const normalizedRows = [];
  for (const row of rows || []) {
    if (Array.isArray(row)) {
      for (const nested of row) {
        normalizedRows.push(nested);
      }
    } else {
      normalizedRows.push(row);
    }
  }

  for (const row of normalizedRows) {
    if (!row) {
      continue;
    }
    const price = toNum(row.price);
    if (price === null) {
      continue;
    }
    const capturedAt = row.capturedAt || new Date(0).toISOString();
    const k = `${capturedAt}|${price}`;
    dedup[k] = {
      sku: row.sku || '',
      storeCode: row.storeCode || '',
      name: row.name || '',
      price,
      capturedAt,
    };
  }

  const history = Object.values(dedup).sort((a, b) => toTs(a.capturedAt) - toTs(b.capturedAt));
  return {
    [key]: history,
  };
}

function priceReduce(key, rows) {
  function toTs(v) {
    const t = new Date(v || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  const [sku = '', storeCode = ''] = String(key).split('|');
  const dedup = {};
  const normalizedRows = [];
  for (const row of rows || []) {
    if (Array.isArray(row)) {
      for (const nested of row) {
        normalizedRows.push(nested);
      }
    } else {
      normalizedRows.push(row);
    }
  }

  for (const row of normalizedRows) {
    if (!row) {
      continue;
    }
    const price = toNum(row.price);
    if (price === null) {
      continue;
    }
    const capturedAt = row.capturedAt || new Date(0).toISOString();
    const k = `${capturedAt}|${price}`;
    dedup[k] = {
      sku: row.sku || sku,
      storeCode: row.storeCode || storeCode,
      name: row.name || '',
      price,
      capturedAt,
    };
  }

  const history = Object.values(dedup).sort((a, b) => toTs(a.capturedAt) - toTs(b.capturedAt));
  const latest = history.length > 0 ? history[history.length - 1] : null;

  return {
    [key]: {
      sku,
      storeCode,
      name: latest ? latest.name : '',
      latestPrice: latest ? latest.price : null,
      latestAt: latest ? latest.capturedAt : null,
      history,
      samples: history.length,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);

  const host = String(args.host || '127.0.0.1');
  const port = Number(args.port || 12400);
  const peers = parsePeers(args.peers || '');

  const inputGid = String(args['input-gid'] || 'tjraw');
  const indexGid = String(args['index-gid'] || 'tjindex');
  const priceGid = String(args['price-gid'] || 'tjprices');

  const concurrency = Math.max(1, Number(args.concurrency || 16));
  const topK = Math.max(1, Number(args['top-k'] || 100));
  const shuffleBatchSize = Math.max(1, Number(args['shuffle-batch-size'] || 200));
  const shuffleConcurrency = Math.max(1, Number(args['shuffle-concurrency'] || 64));
  const keepExisting = Boolean(args['keep-existing']);
  const strictGroup = Boolean(args['strict-group']);

  let runtime = null;

  try {
    runtime = await startCoordinator({ host, port, peers, strictGroup });
    const distribution = runtime.distribution;

    console.log(`[indexer] coordinator started on ${host}:${port}`);
    console.log(`[indexer] reachable peers: ${runtime.reachablePeers.length}`);

    const universe = await computeDocUniverse(distribution, inputGid, concurrency);

    if (universe.snapshotCount === 0) {
      console.log(`[indexer] no data in gid ${inputGid}, nothing to index`);
      return;
    }

    if (!keepExisting) {
      const removedIndex = await clearGid(distribution, indexGid, concurrency);
      const removedPrices = await clearGid(distribution, priceGid, concurrency);
      console.log(`[indexer] cleared ${indexGid} keys=${removedIndex}, ${priceGid} keys=${removedPrices}`);
    }

    const mrService = distribution[inputGid] && distribution[inputGid].mr;
    if (!mrService || typeof mrService.exec !== 'function') {
      throw new Error(`mr service unavailable for gid ${inputGid}`);
    }

    let totalDocs = 0;
    try {
      totalDocs = await computeTotalDocsDistributed(mrService, shuffleBatchSize, shuffleConcurrency);
    } catch (docCountError) {
      totalDocs = universe.productCount;
      console.log(`[indexer] doc-count MR failed, fallback to productCount (${docCountError.message})`);
    }
    if (totalDocs <= 0) {
      totalDocs = Math.max(1, universe.productCount);
    }

    console.log(`[indexer] snapshots=${universe.snapshotCount} products=${universe.productCount} docs=${totalDocs}`);

    const indexResult = await callWithCallback((cb) => {
      mrService.exec({
        map: indexMap,
        combiner: indexCombiner,
        reduce: indexReduce,
        constants: {
          totalDocs,
          topK,
        },
        outputGid: indexGid,
        batchSize: shuffleBatchSize,
        shuffleConcurrency,
      }, cb);
    });

    const indexedTerms = Number(indexResult && indexResult.written) || 0;
    console.log(`[indexer] wrote ${indexedTerms} term entries to ${indexGid}`);

    const priceResult = await callWithCallback((cb) => {
      mrService.exec({
        map: priceMap,
        combiner: priceCombiner,
        reduce: priceReduce,
        outputGid: priceGid,
        batchSize: shuffleBatchSize,
        shuffleConcurrency,
      }, cb);
    });

    const indexedPrices = Number(priceResult && priceResult.written) || 0;
    console.log(`[indexer] wrote ${indexedPrices} price entries to ${priceGid}`);

    const summaryKey = String(args['summary-key'] || '_meta:indexer');
    const summary = {
      inputGid,
      indexGid,
      priceGid,
      snapshots: universe.snapshotCount,
      products: universe.productCount,
      totalDocs,
      indexedTerms,
      indexedPrices,
      coordinator: { host, port },
      peers: runtime.reachablePeers,
      updatedAt: new Date().toISOString(),
    };

    await callWithCallback((cb) => distribution.all.store.put(summary, { key: summaryKey, gid: indexGid }, cb));
    console.log(`[indexer] summary written to ${indexGid}:${summaryKey}`);
  } catch (error) {
    console.error(`[indexer] failed: ${error.message}`);
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
  docCountMap,
  docCountCombiner,
  docCountReduce,
  indexMap,
  indexCombiner,
  indexReduce,
  priceMap,
  priceCombiner,
  priceReduce,
};
