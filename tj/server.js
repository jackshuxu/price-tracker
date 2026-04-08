#!/usr/bin/env node

const http = require('node:http');
const { URL } = require('node:url');

const { parseArgs, parsePeers, startCoordinator, stopCoordinator } = require('./runtime.js');
const { searchProducts, getPriceHistory, listStores } = require('./query.js');

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function notFound(res) {
  json(res, 404, { error: 'Not found' });
}

function parseHistoryPath(pathname) {
  const match = pathname.match(/^\/history\/([^/]+)\/([^/]+)$/);
  if (!match) {
    return null;
  }
  return {
    sku: decodeURIComponent(match[1]),
    storeCode: decodeURIComponent(match[2]),
  };
}

async function createServer(options) {
  const coordinatorHost = String(options.coordinatorHost || '127.0.0.1');
  const coordinatorPort = Number(options.coordinatorPort || 12400);
  const peers = Array.isArray(options.peers) ? options.peers : [];
  const strictGroup = Boolean(options.strictGroup);

  const runtime = await startCoordinator({
    host: coordinatorHost,
    port: coordinatorPort,
    peers,
    strictGroup,
  });

  const distribution = runtime.distribution;

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
      json(res, 405, { error: 'Method not allowed' });
      return;
    }

    const base = `http://${req.headers.host || 'localhost'}`;
    const url = new URL(req.url || '/', base);

    try {
      if (url.pathname === '/health') {
        json(res, 200, {
          ok: true,
          coordinator: {
            host: coordinatorHost,
            port: coordinatorPort,
          },
          peers: runtime.reachablePeers,
          now: new Date().toISOString(),
        });
        return;
      }

      if (url.pathname === '/search') {
        const q = String(url.searchParams.get('q') || '');
        const storeCode = String(url.searchParams.get('storeCode') || '');
        const limit = Number(url.searchParams.get('limit') || 20);

        if (!q.trim()) {
          json(res, 200, []);
          return;
        }

        const results = await searchProducts(distribution, { q, storeCode, limit });
        json(res, 200, results);
        return;
      }

      if (url.pathname === '/stores') {
        const state = String(url.searchParams.get('state') || '');
        const stores = await listStores(distribution, { state });
        json(res, 200, stores);
        return;
      }

      const historyParams = parseHistoryPath(url.pathname);
      if (historyParams) {
        const history = await getPriceHistory(distribution, historyParams);
        json(res, 200, history);
        return;
      }

      notFound(res);
    } catch (error) {
      json(res, 500, { error: error.message || 'internal server error' });
    }
  });

  return {
    server,
    runtime,
    async stop() {
      await new Promise((resolve) => {
        server.close(() => resolve());
      });
      await stopCoordinator(distribution);
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);

  const host = String(args.host || '0.0.0.0');
  const port = Number(args.port || 8080);
  const coordinatorHost = String(args['coordinator-host'] || '127.0.0.1');
  const coordinatorPort = Number(args['coordinator-port'] || 12400);
  const peers = parsePeers(args.peers || '');

  let app = null;
  try {
    app = await createServer({
      coordinatorHost,
      coordinatorPort,
      peers,
      strictGroup: Boolean(args['strict-group']),
    });

    await new Promise((resolve) => {
      app.server.listen(port, host, () => {
        console.log(`[tj/server] listening on http://${host}:${port}`);
        console.log(`[tj/server] coordinator ${coordinatorHost}:${coordinatorPort}`);
        resolve();
      });
    });

    const shutdown = async () => {
      if (!app) {
        process.exit(0);
      }
      const current = app;
      app = null;
      try {
        await current.stop();
      } finally {
        process.exit(0);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error(`[tj/server] failed: ${error.message}`);
    if (app) {
      await app.stop();
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  createServer,
};
