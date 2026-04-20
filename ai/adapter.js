#!/usr/bin/env node

const http = require('node:http');
const { URL } = require('node:url');

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

function parseBoolean(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function safeString(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function writeJson(res, statusCode, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    ...(extraHeaders || {}),
  });
  res.end(body);
}

function tokenFromName(name) {
  const tokens = safeString(name)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((token) => token.length >= 4);
  return tokens[0] || '';
}

function summarizeTrend(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return {
      trend: 'insufficient-data',
      latestPrice: null,
      latestDate: null,
      delta: null,
      advice: 'Need more samples before making a timing recommendation.',
    };
  }

  const rows = history
    .map((row) => ({
      date: safeString(row && row.date),
      price: Number(row && row.price),
    }))
    .filter((row) => row.date && Number.isFinite(row.price))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (rows.length === 0) {
    return {
      trend: 'insufficient-data',
      latestPrice: null,
      latestDate: null,
      delta: null,
      advice: 'Need more samples before making a timing recommendation.',
    };
  }

  const latest = rows[rows.length - 1];
  const previous = rows.length > 1 ? rows[rows.length - 2] : null;

  if (!previous) {
    return {
      trend: 'insufficient-data',
      latestPrice: latest.price,
      latestDate: latest.date,
      delta: null,
      advice: 'Only one sample available, compare across stores before checkout.',
    };
  }

  const delta = Number((latest.price - previous.price).toFixed(2));
  let trend = 'flat';
  let advice = 'Price is stable, compare alternatives for better value.';

  if (delta >= 0.15) {
    trend = 'up';
    advice = 'Recent upward movement suggests buying now if needed.';
  } else if (delta <= -0.15) {
    trend = 'down';
    advice = 'Recent downward movement suggests waiting may help.';
  }

  return {
    trend,
    latestPrice: latest.price,
    latestDate: latest.date,
    delta,
    advice,
  };
}

async function fetchJson(baseUrl, pathWithQuery, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(pathWithQuery, baseUrl).toString();
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    return {
      status: res.status,
      body,
      dataSource: res.headers.get('x-tj-data-source'),
    };
  } catch (error) {
    return {
      status: 502,
      body: { error: `adapter backend request failed: ${error.message || String(error)}` },
      dataSource: 'none',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function computeShelfHarmonyForResult(result, config) {
  const sku = safeString(result && result.sku).trim();
  const storeCode = safeString(result && result.storeCode).trim();
  const name = safeString(result && result.name).trim();

  if (!sku || !storeCode) {
    return {
      trend: 'insufficient-data',
      latestPrice: null,
      latestDate: null,
      delta: null,
      advice: 'Missing sku/storeCode for shelf harmony analysis.',
      alternatives: [],
    };
  }

  const historyResponse = await fetchJson(
    config.backendBaseUrl,
    `/history/${encodeURIComponent(sku)}/${encodeURIComponent(storeCode)}`,
    config.backendTimeoutMs,
  );
  const historyRows = Array.isArray(historyResponse.body) ? historyResponse.body : [];
  const trend = summarizeTrend(historyRows);

  const queryToken = tokenFromName(name) || safeString(result && result.matchedTerms && result.matchedTerms[0]).split(' ')[0];
  let alternatives = [];

  if (queryToken) {
    const alternativeResponse = await fetchJson(
      config.backendBaseUrl,
      `/search?q=${encodeURIComponent(queryToken)}&storeCode=${encodeURIComponent(storeCode)}&limit=8`,
      config.backendTimeoutMs,
    );

    const rows = Array.isArray(alternativeResponse.body) ? alternativeResponse.body : [];
    alternatives = rows
      .filter((row) => safeString(row && row.sku) && safeString(row && row.sku) !== sku)
      .map((row) => ({
        sku: safeString(row.sku),
        name: safeString(row.name),
        price: Number(row.price),
        latestAt: row.latestAt || null,
      }))
      .filter((row) => Number.isFinite(row.price))
      .sort((a, b) => a.price - b.price)
      .slice(0, 2);
  }

  return {
    ...trend,
    alternatives,
  };
}

async function enrichSearchResults(results, config) {
  const topN = Math.min(results.length, config.enrichTopN);
  const output = [];

  for (let i = 0; i < results.length; i += 1) {
    const row = results[i];
    if (i >= topN) {
      output.push(row);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const shelfHarmony = await computeShelfHarmonyForResult(row, config);
    output.push({
      ...row,
      ai: {
        shelfHarmony,
      },
    });
  }

  return output;
}

function buildConfig(options) {
  const opts = options || {};
  return {
    host: safeString(opts.host || process.env.ADAPTER_HOST || '127.0.0.1'),
    port: parsePositiveInt(opts.port || process.env.ADAPTER_PORT || 8090, 8090),
    backendBaseUrl: safeString(opts.backendBaseUrl || process.env.ADAPTER_BACKEND_BASE_URL || 'http://127.0.0.1:8080'),
    backendTimeoutMs: parsePositiveInt(
      opts.backendTimeoutMs || process.env.ADAPTER_BACKEND_TIMEOUT_MS || 3000,
      3000,
    ),
    enrichSearch: parseBoolean(opts.enrichSearch, parseBoolean(process.env.ADAPTER_ENRICH_SEARCH, false)),
    shelfHarmonyEnabled: parseBoolean(
      opts.shelfHarmonyEnabled,
      parseBoolean(process.env.ADAPTER_SHELF_HARMONY_ENABLED, false),
    ),
    enrichTopN: parsePositiveInt(opts.enrichTopN || process.env.ADAPTER_ENRICH_TOP_N || 3, 3),
  };
}

function isHistoryPath(pathname) {
  return /^\/history\/[^/]+\/[^/]+$/.test(pathname);
}

function createAdapterServer(options) {
  const config = buildConfig(options);

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      writeJson(res, 405, { error: 'Method not allowed' }, { 'x-adapter-source': 'none' });
      return;
    }

    let url;
    try {
      url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    } catch {
      writeJson(res, 400, { error: 'Invalid request URL' }, { 'x-adapter-source': 'none' });
      return;
    }

    try {
      if (url.pathname === '/health') {
        const upstream = await fetchJson(config.backendBaseUrl, '/health', config.backendTimeoutMs);
        writeJson(
          res,
          200,
          {
            ok: true,
            adapter: {
              mode: 'read-only',
              backendBaseUrl: config.backendBaseUrl,
              enrichSearch: config.enrichSearch,
              shelfHarmonyEnabled: config.shelfHarmonyEnabled,
              now: new Date().toISOString(),
            },
            upstreamHealthy: upstream.status === 200,
            upstreamStatus: upstream.status,
          },
          { 'x-adapter-source': 'health' },
        );
        return;
      }

      if (url.pathname === '/ai/shelf-harmony') {
        if (!config.shelfHarmonyEnabled) {
          writeJson(res, 404, { error: 'Not found' }, { 'x-adapter-source': 'none' });
          return;
        }

        const sku = safeString(url.searchParams.get('sku')).trim();
        const storeCode = safeString(url.searchParams.get('storeCode') || '701').trim();
        const q = safeString(url.searchParams.get('q') || '').trim();

        if (!sku) {
          writeJson(
            res,
            400,
            { error: 'Missing required query parameter: sku' },
            { 'x-adapter-source': 'shelf-harmony', 'x-tj-data-source': 'none' },
          );
          return;
        }

        const syntheticRow = {
          sku,
          storeCode,
          name: q,
          matchedTerms: q ? [q] : [],
        };

        const shelfHarmony = await computeShelfHarmonyForResult(syntheticRow, config);
        writeJson(
          res,
          200,
          {
            sku,
            storeCode,
            shelfHarmony,
          },
          { 'x-adapter-source': 'shelf-harmony' },
        );
        return;
      }

      if (url.pathname === '/search' || url.pathname === '/stores' || isHistoryPath(url.pathname)) {
        const upstream = await fetchJson(
          config.backendBaseUrl,
          `${url.pathname}${url.search}`,
          config.backendTimeoutMs,
        );

        if (url.pathname === '/search' && config.enrichSearch && upstream.status === 200 && Array.isArray(upstream.body)) {
          const enriched = await enrichSearchResults(upstream.body, config);
          writeJson(
            res,
            200,
            enriched,
            {
              'x-adapter-source': 'search-enriched',
              'x-tj-data-source': upstream.dataSource || 'distribution',
            },
          );
          return;
        }

        const headers = {
          'x-adapter-source': 'passthrough',
        };
        if (upstream.dataSource) {
          headers['x-tj-data-source'] = upstream.dataSource;
        }
        writeJson(res, upstream.status, upstream.body, headers);
        return;
      }

      writeJson(res, 404, { error: 'Not found' }, { 'x-adapter-source': 'none' });
    } catch (error) {
      writeJson(
        res,
        500,
        { error: error.message || 'internal adapter error' },
        { 'x-adapter-source': 'none' },
      );
    }
  });

  return {
    config,
    server,
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => resolve());
      });
    },
    async stop() {
      await new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);

  const adapter = createAdapterServer({
    host: args.host,
    port: args.port,
    backendBaseUrl: args.backend || args['backend-base-url'],
    backendTimeoutMs: args['backend-timeout-ms'],
    enrichSearch: args['enrich-search'],
    shelfHarmonyEnabled: args['enable-shelf-harmony'],
    enrichTopN: args['enrich-top-n'],
  });

  try {
    await adapter.start();
    console.log(`[ai/adapter] listening on http://${adapter.config.host}:${adapter.config.port}`);
    console.log(`[ai/adapter] backend=${adapter.config.backendBaseUrl}`);
    console.log(
      `[ai/adapter] enrichSearch=${adapter.config.enrichSearch} shelfHarmony=${adapter.config.shelfHarmonyEnabled}`,
    );

    const shutdown = async () => {
      await adapter.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error(`[ai/adapter] failed: ${error.message || String(error)}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  createAdapterServer,
};
