#!/usr/bin/env node

const http = require('node:http');

const { serialize, deserialize } = require('../util/serialization.js');

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

function rpc(host, port, gid, service, method, args) {
  return new Promise((resolve, reject) => {
    const body = serialize(args);
    const req = http.request(
      {
        hostname: host,
        port,
        path: `/${gid}/${service}/${method}`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const decoded = deserialize(data);
            const error = decoded && decoded[0];
            const value = decoded && decoded[1];
            if (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
              return;
            }
            resolve(value);
          } catch (e) {
            reject(new Error(`failed to decode RPC response: ${e.message}`));
          }
        });
      },
    );

    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const host = String(args.host || '127.0.0.1');
  const port = Number(args.port || 12400);
  const prefix = String(args.prefix || '_stage1_init');

  const gids = ['tjraw', 'tjindex', 'tjprices', 'tjstores'];

  console.log(`[info] initializing stage1 gids on ${host}:${port}`);

  for (const gid of gids) {
    const key = `${prefix}:${gid}:meta`;
    const value = {
      gid,
      initializedAt: new Date().toISOString(),
      version: 1,
      ready: true,
    };

    await rpc(host, port, 'all', 'store', 'put', [value, { key, gid }]);
    const readBack = await rpc(host, port, 'all', 'store', 'get', [{ key, gid }]);
    if (!readBack || readBack.gid !== gid) {
      throw new Error(`gid ${gid} verification failed`);
    }

    console.log(`[ok] ${gid} initialized with key ${key}`);
  }

  console.log('[done] stage1 gids initialized and verified');
}

main().catch((error) => {
  console.error('[fail] init-stage1-gids:', error.message);
  process.exit(1);
});
