#!/usr/bin/env node

const {
  parseArgs,
  callWithCallback,
  startCoordinator,
  stopCoordinator,
  getAllKeys,
} = require('./runtime.js');

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'with',
  'you', 'your', 'our', 'we', 'they', 'he', 'she', 'its', 'was', 'were', 'will',
  'can', 'could', 'would', 'should', 'about', 'after', 'before', 'than', 'then',
]);

function safeString(v) {
  if (v === undefined || v === null) {
    return '';
  }
  return String(v);
}

function stemToken(token) {
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

function tokenize(input) {
  return safeString(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((tok) => !STOPWORDS.has(tok))
    .map((tok) => stemToken(tok))
    .filter(Boolean);
}

function buildQueryTerms(query) {
  const tokens = tokenize(query);
  const terms = [];

  for (let i = 0; i < tokens.length; i += 1) {
    terms.push(tokens[i]);
  }
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    terms.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  for (let i = 0; i + 2 < tokens.length; i += 1) {
    terms.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }

  return Array.from(new Set(terms));
}

async function getStoreValue(distribution, gid, key) {
  try {
    return await callWithCallback((cb) => distribution.all.store.get({ key, gid }, cb));
  } catch (error) {
    return null;
  }
}

async function searchProducts(distribution, options) {
  const q = safeString(options.q).trim();
  if (!q) {
    return [];
  }

  const storeCode = safeString(options.storeCode).trim();
  const limit = Math.max(1, Number(options.limit || 20));
  const indexGid = safeString(options.indexGid || 'tjindex');
  const priceGid = safeString(options.priceGid || 'tjprices');

  const terms = buildQueryTerms(q);
  if (terms.length === 0) {
    return [];
  }

  const entries = await Promise.all(
    terms.map(async (term) => ({
      term,
      entry: await getStoreValue(distribution, indexGid, term),
    })),
  );

  const scored = new Map();

  for (const { term, entry } of entries) {
    const postings = Array.isArray(entry && entry.postings) ? entry.postings : [];

    for (const posting of postings) {
      if (!posting || !posting.docId) {
        continue;
      }
      if (storeCode && safeString(posting.storeCode) !== storeCode) {
        continue;
      }

      const docId = safeString(posting.docId);
      if (!scored.has(docId)) {
        scored.set(docId, {
          sku: safeString(posting.sku),
          storeCode: safeString(posting.storeCode),
          name: safeString(posting.name),
          score: 0,
          tf: 0,
          matchedTerms: new Set(),
          lastSeen: posting.lastSeen || null,
        });
      }

      const row = scored.get(docId);
      row.score += Number(posting.score) || 0;
      row.tf += Number(posting.tf) || 0;
      row.matchedTerms.add(term);
      if (posting.name) {
        row.name = safeString(posting.name);
      }
      if (posting.lastSeen) {
        row.lastSeen = posting.lastSeen;
      }
    }
  }

  const ranked = Array.from(scored.values())
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      if (a.matchedTerms.size !== b.matchedTerms.size) {
        return b.matchedTerms.size - a.matchedTerms.size;
      }
      if (a.tf !== b.tf) {
        return b.tf - a.tf;
      }
      return a.sku.localeCompare(b.sku);
    })
    .slice(0, limit);

  const enriched = await Promise.all(
    ranked.map(async (row) => {
      const priceKey = `${row.sku}|${row.storeCode || 'unknown'}`;
      const priceRecord = await getStoreValue(distribution, priceGid, priceKey);
      return {
        sku: row.sku,
        storeCode: row.storeCode,
        name: row.name,
        price: Number(priceRecord && priceRecord.latestPrice) || null,
        latestAt: priceRecord && priceRecord.latestAt ? priceRecord.latestAt : row.lastSeen,
        score: Number(row.score.toFixed(6)),
        matchedTerms: Array.from(row.matchedTerms),
      };
    }),
  );

  return enriched;
}

async function getPriceHistory(distribution, options) {
  const sku = safeString(options.sku).trim();
  const storeCode = safeString(options.storeCode).trim();
  const priceGid = safeString(options.priceGid || 'tjprices');

  if (!sku || !storeCode) {
    return [];
  }

  const key = `${sku}|${storeCode}`;
  const value = await getStoreValue(distribution, priceGid, key);
  if (!value || !Array.isArray(value.history)) {
    return [];
  }

  return value.history
    .map((item) => ({
      date: item.capturedAt || item.date || null,
      price: Number(item.price),
    }))
    .filter((item) => item.date && Number.isFinite(item.price));
}

function normalizeStoreRecord(key, value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    storeCode: safeString(v.storeCode || v.store_code || key).trim(),
    name: safeString(v.name || `Trader Joe's ${key}`).trim(),
    city: safeString(v.city || '').trim(),
    state: safeString(v.state || '').trim().toUpperCase(),
    address: safeString(v.address || '').trim(),
    zip: safeString(v.zip || v.postalCode || '').trim(),
    lat: Number(v.lat || v.latitude || 0) || null,
    lng: Number(v.lng || v.longitude || 0) || null,
  };
}

async function listStores(distribution, options) {
  const state = safeString(options.state).trim().toUpperCase();
  const storesGid = safeString(options.storesGid || 'tjstores');
  const keys = await getAllKeys(distribution, storesGid);

  const rows = await Promise.all(
    keys.map(async (key) => {
      const value = await getStoreValue(distribution, storesGid, key);
      return normalizeStoreRecord(key, value);
    }),
  );

  const filtered = state ? rows.filter((s) => s.state === state) : rows;

  return filtered.sort((a, b) => {
    if (a.state !== b.state) {
      return a.state.localeCompare(b.state);
    }
    if (a.city !== b.city) {
      return a.city.localeCompare(b.city);
    }
    return a.storeCode.localeCompare(b.storeCode);
  });
}

async function main() {
  const argv = process.argv;
  const knownCommands = new Set(['search', 'history', 'stores']);
  const command = knownCommands.has(argv[2]) ? argv[2] : 'search';
  const args = parseArgs(argv);

  const host = safeString(args.host || '127.0.0.1');
  const port = Number(args.port || 12400);

  let runtime = null;
  try {
    runtime = await startCoordinator({ host, port, peers: [] });
    const distribution = runtime.distribution;

    if (command === 'history') {
      const sku = safeString(args.sku || argv[3] || '');
      const storeCode = safeString(args.storeCode || argv[4] || '');
      const history = await getPriceHistory(distribution, { sku, storeCode });
      process.stdout.write(`${JSON.stringify(history, null, 2)}\n`);
      return;
    }

    if (command === 'stores') {
      const stores = await listStores(distribution, { state: args.state || '' });
      process.stdout.write(`${JSON.stringify(stores, null, 2)}\n`);
      return;
    }

    const queryParts = [];
    if (args.q) {
      queryParts.push(safeString(args.q));
    } else {
      const positional = argv.slice(knownCommands.has(argv[2]) ? 3 : 2);
      for (const token of positional) {
        if (!token.startsWith('--')) {
          queryParts.push(token);
        }
      }
    }

    const q = queryParts.join(' ').trim();
    const results = await searchProducts(distribution, {
      q,
      storeCode: args.storeCode || '',
      limit: args.limit || 20,
    });

    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } catch (error) {
    console.error(`[query] failed: ${error.message}`);
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
  tokenize,
  buildQueryTerms,
  searchProducts,
  getPriceHistory,
  listStores,
};
