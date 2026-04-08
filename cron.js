#!/usr/bin/env node

const { spawn } = require('node:child_process');
const path = require('node:path');

const { parseArgs } = require('./tj/runtime.js');

function safeString(v) {
  if (v === undefined || v === null) {
    return '';
  }
  return String(v);
}

function runNodeScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
      }
    });
  });
}

function passArg(name, value) {
  const text = safeString(value).trim();
  if (!text) {
    return [];
  }
  return [`--${name}`, text];
}

async function runPipeline(args) {
  const rootDir = __dirname;

  const common = [
    ...passArg('host', args.host || '127.0.0.1'),
    ...passArg('port', args.port || '12400'),
    ...passArg('peers', args.peers || ''),
  ];

  const crawlerArgs = [
    ...common,
    ...passArg('store-codes', args['store-codes'] || ''),
    ...passArg('terms', args.terms || ''),
    ...passArg('snapshot-file', args['snapshot-file'] || ''),
  ];

  const indexerArgs = [
    ...common,
    ...passArg('top-k', args['top-k'] || '100'),
    ...passArg('input-gid', args['input-gid'] || 'tjraw'),
    ...passArg('index-gid', args['index-gid'] || 'tjindex'),
    ...passArg('price-gid', args['price-gid'] || 'tjprices'),
  ];

  console.log(`[cron] crawler start ${new Date().toISOString()}`);
  await runNodeScript(path.join(rootDir, 'crawler.js'), crawlerArgs);

  console.log(`[cron] indexer start ${new Date().toISOString()}`);
  await runNodeScript(path.join(rootDir, 'indexer.js'), indexerArgs);

  console.log(`[cron] pipeline finished ${new Date().toISOString()}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const intervalMinutes = Number(args['interval-minutes'] || 0);
  const repeat = intervalMinutes > 0 || Boolean(args.repeat);

  let running = false;

  async function runSafe() {
    if (running) {
      console.log('[cron] previous run still active, skipping overlap');
      return;
    }

    running = true;
    try {
      await runPipeline(args);
    } catch (error) {
      console.error(`[cron] pipeline failed: ${error.message}`);
      process.exitCode = 1;
    } finally {
      running = false;
    }
  }

  await runSafe();

  if (!repeat) {
    return;
  }

  const delayMs = Math.max(1, intervalMinutes) * 60 * 1000;
  console.log(`[cron] repeat mode on, interval=${Math.max(1, intervalMinutes)} minute(s)`);

  const timer = setInterval(() => {
    runSafe();
  }, delayMs);

  const shutdown = () => {
    clearInterval(timer);
    process.exit(process.exitCode || 0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main();
}

module.exports = {
  runPipeline,
};
