#!/usr/bin/env node

const path = require('node:path');
const { spawn } = require('node:child_process');

const child = spawn(
  process.execPath,
  [path.join(__dirname, 'tj', 'query.js'), ...process.argv.slice(2)],
  { stdio: 'inherit' },
);

child.on('exit', (code) => {
  process.exit(code === null ? 1 : code);
});

child.on('error', (error) => {
  console.error(`[query wrapper] failed: ${error.message}`);
  process.exit(1);
});
