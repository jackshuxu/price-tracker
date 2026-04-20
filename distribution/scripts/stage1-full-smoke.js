#!/usr/bin/env node

const path = require('node:path');
const { spawn } = require('node:child_process');

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

function runScript(scriptPath, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      output += text;
      process.stderr.write(text);
    });

    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ code: Number(code || 0), output });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const repeat = parsePositiveInt(args.repeat, 1);
  const withExplain = Boolean(args['with-explain']);
  const withAdapter = Boolean(args['with-adapter']);

  const root = path.resolve(__dirname, '..', '..');
  const scripts = [
    'stage1-smoke.js',
    'stage1-api-smoke.js',
    'stage1-pipeline-smoke.js',
    'stage1-failure-smoke.js',
    'stage1-contract-smoke.js',
  ];

  if (withExplain) {
    scripts.push('stage1-explain-smoke.js');
  }
  if (withAdapter) {
    scripts.push('stage1-adapter-smoke.js');
  }

  const startedAt = Date.now();

  try {
    for (let round = 1; round <= repeat; round += 1) {
      console.log(`[suite] round ${round}/${repeat}`);

      for (const script of scripts) {
        const scriptPath = path.join(__dirname, script);
        const runStartedAt = Date.now();
        console.log(`[run] ${script}`);

        // eslint-disable-next-line no-await-in-loop
        const result = await runScript(scriptPath, root);
        const elapsedMs = Date.now() - runStartedAt;

        if (result.code !== 0) {
          console.error(`[fail] ${script} exited with code ${result.code} (${elapsedMs}ms)`);
          process.exitCode = result.code;
          return;
        }

        console.log(`[ok] ${script} (${elapsedMs}ms)`);
      }
    }

    const totalElapsed = Date.now() - startedAt;
    console.log(
      `[done] stage1 full smoke passed rounds=${repeat} withExplain=${withExplain} withAdapter=${withAdapter} totalMs=${totalElapsed}`,
    );
  } catch (error) {
    console.error('[fail] stage1 full smoke failed:', error.message || String(error));
    process.exitCode = 1;
  }
}

main();
