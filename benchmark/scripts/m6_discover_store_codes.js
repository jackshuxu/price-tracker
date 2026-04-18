#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const BRANDIFY_API = 'https://alphaapi.brandify.com/rest/locatorsearch';
const BRANDIFY_APPKEY = '8BC3433A-60FC-11E3-991D-B2EE0C70A832';

const DEFAULT_STATE_ZIPS = [
  '35203', '99501', '85004', '72201', '90001', '80203', '06103', '19801', '33101', '30303',
  '96813', '83702', '60601', '46204', '50309', '66101', '40202', '70112', '04101', '21201',
  '02108', '48201', '55401', '39201', '64101', '59601', '68102', '89101', '03101', '07102',
  '87102', '10001', '27601', '58501', '44113', '73102', '97201', '19102', '02903', '29201',
  '57501', '37201', '73301', '84111', '05401', '23219', '98101', '25301', '53202', '82001',
  '20001',
];

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

function normalizeZip(value) {
  return safeString(value).replace(/[^0-9]/g, '').slice(0, 5);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readSeedFile(filePath) {
  if (!filePath) {
    return [];
  }

  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`seed file not found: ${abs}`);
  }

  const raw = fs.readFileSync(abs, 'utf-8').trim();
  if (!raw) {
    return [];
  }

  if (raw.startsWith('[')) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('seed json must be an array of zip codes');
    }
    return parsed.map((v) => normalizeZip(v)).filter(Boolean);
  }

  return raw
    .split(/[\r\n,]+/)
    .map((line) => normalizeZip(line))
    .filter(Boolean);
}

async function fetchByZip(zip, options) {
  const body = JSON.stringify({
    request: {
      appkey: BRANDIFY_APPKEY,
      formdata: {
        geoip: false,
        dataview: 'store_default',
        limit: options.limit,
        searchradius: String(options.searchRadius),
        geolocs: {
          geoloc: [{
            addressline: zip,
            country: 'US',
            latitude: '',
            longitude: '',
          }],
        },
      },
    },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const res = await fetch(BRANDIFY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    const rawCollection = json && json.response ? json.response.collection : null;
    const collection = Array.isArray(rawCollection)
      ? rawCollection
      : rawCollection && typeof rawCollection === 'object'
        ? Object.values(rawCollection)
        : [];

    const stores = collection
      .map((raw) => {
        const storeCode = safeString(
          raw.clientkey
          || raw.client_key
          || raw.store_id
          || raw.remote_id
          || (raw.asset && (raw.asset.client_key || raw.asset.remote_id || raw.asset.asset_id))
          || (raw.location && (raw.location.store_id || raw.location.location_id)),
        ).trim();

        const city = safeString(raw.city || raw.locality || (raw.location && raw.location.city)).trim();
        const state = safeString(raw.state || raw.state_code || (raw.location && raw.location.state)).trim();
        const address = safeString(
          raw.address1
          || raw.address
          || (raw.location && (raw.location.address1 || raw.location.address)),
        ).trim();
        const postal = normalizeZip(
          raw.postalcode
          || raw.postal_code
          || raw.zip
          || raw.zipcode
          || (raw.location && (raw.location.postal_code || raw.location.zip)),
        );
        const latitude = Number(raw.latitude || (raw.location && raw.location.latitude));
        const longitude = Number(raw.longitude || (raw.location && raw.location.longitude));

        if (!storeCode) {
          return null;
        }

        return {
          storeCode,
          name: `Trader Joe's ${city}`.trim(),
          city,
          state,
          address,
          zip: postal,
          latitude: Number.isFinite(latitude) ? latitude : null,
          longitude: Number.isFinite(longitude) ? longitude : null,
        };
      })
      .filter(Boolean);

    return {
      zip,
      ok: true,
      stores,
    };
  } catch (error) {
    return {
      zip,
      ok: false,
      stores: [],
      error: error && error.message ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runDiscovery(config) {
  const queue = [...config.seedZips];
  const queued = new Set(queue);
  const visited = new Set();
  const storesByCode = new Map();
  const errors = [];

  while (
    queue.length > 0
    && visited.size < config.maxZipQueries
    && storesByCode.size < config.maxStoreCount
  ) {
    const batch = [];
    while (batch.length < config.concurrency && queue.length > 0) {
      const zip = queue.shift();
      if (!zip || visited.has(zip)) {
        continue;
      }
      visited.add(zip);
      batch.push(zip);
    }

    if (batch.length === 0) {
      continue;
    }

    const results = await Promise.all(batch.map((zip) => fetchByZip(zip, config)));

    for (const result of results) {
      if (!result.ok) {
        errors.push({ zip: result.zip, error: result.error || 'unknown error' });
        continue;
      }

      for (const store of result.stores) {
        if (!storesByCode.has(store.storeCode)) {
          storesByCode.set(store.storeCode, store);
        }

        if (!config.expandFromStoreZips) {
          continue;
        }

        const nextZip = normalizeZip(store.zip);
        if (!nextZip) {
          continue;
        }
        if (!visited.has(nextZip) && !queued.has(nextZip)) {
          queue.push(nextZip);
          queued.add(nextZip);
        }
      }
    }
  }

  return {
    visitedZips: visited,
    storesByCode,
    errors,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(__dirname, '..', '..');

  const seedFileArg = safeString(args['seed-file']);
  const additionalZips = parseCsv(args['zip-codes']).map((z) => normalizeZip(z)).filter(Boolean);
  const seedFileZips = readSeedFile(seedFileArg ? path.resolve(root, seedFileArg) : '');
  const includeDefaults = !Boolean(args['no-default-zips']);

  const seedZips = Array.from(new Set([
    ...(includeDefaults ? DEFAULT_STATE_ZIPS : []),
    ...seedFileZips,
    ...additionalZips,
  ]));

  if (seedZips.length === 0) {
    throw new Error('no seed zip codes available; provide --zip-codes or --seed-file');
  }

  const config = {
    seedZips,
    concurrency: toPositiveInt(args.concurrency, 6),
    searchRadius: toPositiveInt(args['search-radius'], 100),
    limit: toPositiveInt(args.limit, 100),
    timeoutMs: toPositiveInt(args['timeout-ms'], 15000),
    maxZipQueries: toPositiveInt(args['max-zip-queries'], 2000),
    maxStoreCount: toPositiveInt(args['max-store-count'], 2000),
    expandFromStoreZips: !Boolean(args['no-expand']),
  };

  const outJson = path.resolve(
    root,
    safeString(args['out-json'], path.join('benchmark', 'golden', 'tj_store_discovery.latest.json')),
  );
  const outCodes = path.resolve(
    root,
    safeString(args['out-codes'], path.join('benchmark', 'golden', 'tj_store_codes.latest.txt')),
  );
  const outCsv = path.resolve(
    root,
    safeString(args['out-csv'], path.join('benchmark', 'golden', 'tj_store_codes.latest.csv')),
  );

  console.log(`[m6_discover_store_codes] seeds=${config.seedZips.length}`);
  console.log(
    `[m6_discover_store_codes] concurrency=${config.concurrency} radius=${config.searchRadius} limit=${config.limit}`,
  );

  const startedAt = process.hrtime.bigint();
  const discovery = await runDiscovery(config);
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  const stores = Array.from(discovery.storesByCode.values()).sort((a, b) => {
    const an = Number(a.storeCode);
    const bn = Number(b.storeCode);
    if (Number.isFinite(an) && Number.isFinite(bn)) {
      return an - bn;
    }
    return String(a.storeCode).localeCompare(String(b.storeCode));
  });

  const codes = stores.map((store) => store.storeCode);
  const states = Array.from(new Set(stores.map((store) => store.state).filter(Boolean))).sort();

  const report = {
    generatedAt: new Date().toISOString(),
    elapsedMs: Number(elapsedMs.toFixed(3)),
    config,
    observed: {
      seedZips: config.seedZips.length,
      queriedZips: discovery.visitedZips.size,
      uniqueStores: stores.length,
      uniqueStates: states.length,
      errorCount: discovery.errors.length,
    },
    states,
    stores,
    errors: discovery.errors,
  };

  ensureDir(outJson);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf-8');

  ensureDir(outCodes);
  fs.writeFileSync(outCodes, `${codes.join('\n')}\n`, 'utf-8');

  const csvLines = ['storeCode,city,state,zip,address'];
  for (const store of stores) {
    const row = [
      store.storeCode,
      safeString(store.city).replaceAll(',', ' '),
      safeString(store.state).replaceAll(',', ' '),
      safeString(store.zip),
      safeString(store.address).replaceAll(',', ' '),
    ];
    csvLines.push(row.join(','));
  }
  ensureDir(outCsv);
  fs.writeFileSync(outCsv, `${csvLines.join('\n')}\n`, 'utf-8');

  console.log(`[m6_discover_store_codes] queriedZips=${discovery.visitedZips.size}`);
  console.log(`[m6_discover_store_codes] stores=${stores.length} states=${states.length}`);
  console.log(`[m6_discover_store_codes] errors=${discovery.errors.length}`);
  console.log(`[m6_discover_store_codes] outJson=${outJson}`);
  console.log(`[m6_discover_store_codes] outCodes=${outCodes}`);
  console.log(`[m6_discover_store_codes] outCsv=${outCsv}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[m6_discover_store_codes] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  normalizeZip,
  runDiscovery,
};
