#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 3) {
  const n = toNumber(value, null);
  if (n === null) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function toPosixRelative(root, targetPath) {
  const rel = path.relative(root, targetPath);
  return rel.split(path.sep).join('/');
}

function loadM0Baseline(packageJsonPath) {
  const pkg = readJson(packageJsonPath);
  const reportRows = Array.isArray(pkg.report) ? pkg.report : [];
  const m0 = reportRows.find((row) => String(row && row.milestone || '').toUpperCase() === 'M0');

  if (!m0) {
    throw new Error(`No M0 report row found in ${packageJsonPath}`);
  }

  const throughput = m0.throughput && typeof m0.throughput === 'object' ? m0.throughput : {};
  const dev = Array.isArray(throughput.dev) ? throughput.dev : [];

  return {
    source: packageJsonPath,
    hours: toNumber(m0.hours, null),
    dloc: toNumber(m0.dloc, null),
    jsloc: toNumber(m0.jsloc, null),
    sloc: toNumber(m0.sloc, null),
    throughput: {
      crawlerRps: toNumber(dev[0], null),
      indexerRps: toNumber(dev[1], null),
      queryRps: toNumber(dev[2], null),
    },
  };
}

function endpointRow(name, entry) {
  return {
    name,
    throughputRps: round(entry && entry.throughputRps, 3),
    p95LatencyMs: round(entry && entry.latencyMs && entry.latencyMs.p95, 3),
  };
}

function buildMarkdown(report, outJsonPath) {
  const m0 = report.m0;
  const m6 = report.m6;
  const comparison = report.comparison;

  const m0Query = m0.throughput.queryRps;
  const m6Query = m6.queryReference.throughputRps;
  const chartMax = Math.max(10, Math.ceil(Math.max(m0Query || 0, m6Query || 0) * 1.2));

  const endpointLines = m6.endpointSnapshot
    .map((row) => `| ${row.name} | ${row.p95LatencyMs} | ${row.throughputRps} |`)
    .join('\n');

  return [
    '# M0 vs M6 Characterization Comparison',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Sources',
    '',
    `- M0 baseline metadata: \`${m0.source}\``,
    `- M6 characterization artifact: \`${m6.source}\``,
    `- Comparison JSON artifact: \`${outJsonPath}\``,
    '',
    '## Throughput Comparison (Primary Query Path)',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| M0 query throughput (dev report) | ${m0Query} rps |`,
    `| M6 /search (searchEgg) throughput | ${m6Query} rps |`,
    `| Relative speedup (M6 / M0) | ${comparison.speedupX}x |`,
    `| Relative delta | ${comparison.deltaPct}% |`,
    '',
    '```mermaid',
    'xychart-beta',
    '  title "Query Throughput (RPS)"',
    '  x-axis ["M0 query (dev)", "M6 /search (egg)"]',
    `  y-axis "RPS" 0 --> ${chartMax}`,
    `  bar [${round(m0Query, 3)}, ${round(m6Query, 3)}]`,
    '```',
    '',
    '## M6 Endpoint Snapshot',
    '',
    '| Endpoint | p95 latency (ms) | throughput (rps) |',
    '| --- | --- | --- |',
    endpointLines,
    '',
    '## Caveats',
    '',
    '- M0 and M6 workloads are different; values are directional and should be interpreted with this context.',
    '- M0 baseline comes from recorded M0 report metadata, while M6 values come from current seeded Stage-1 endpoint characterization.',
    '- For strict apples-to-apples results, add a future benchmark harness that replays identical workload semantics through both stacks.',
    '',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv);

  const root = path.resolve(__dirname, '..', '..');
  const m0PackagePath = path.resolve(root, String(args['m0-package'] || path.join('non-distribution', 'package.json')));
  const m6ArtifactPath = path.resolve(root, String(args['m6-artifact'] || path.join('benchmark', 'results', 'm6_characterization.latest.json')));

  const outJson = path.resolve(root, String(args['out-json'] || path.join('benchmark', 'results', 'm0_vs_m6.latest.json')));
  const outMd = path.resolve(root, String(args['out-md'] || path.join('benchmark', 'results', 'm0_vs_m6.latest.md')));

  const m0 = loadM0Baseline(m0PackagePath);
  const m6Raw = readJson(m6ArtifactPath);
  const endpoints = m6Raw.endpoints && typeof m6Raw.endpoints === 'object' ? m6Raw.endpoints : {};

  const m6QueryRps = toNumber(endpoints.searchEgg && endpoints.searchEgg.throughputRps, null);
  const m0QueryRps = toNumber(m0.throughput.queryRps, null);

  const speedupX = m0QueryRps && m0QueryRps > 0 && m6QueryRps !== null ? round(m6QueryRps / m0QueryRps, 3) : null;
  const deltaPct = m0QueryRps && m0QueryRps > 0 && m6QueryRps !== null ? round(((m6QueryRps - m0QueryRps) / m0QueryRps) * 100, 2) : null;

  const report = {
    generatedAt: new Date().toISOString(),
    m0,
    m6: {
      source: m6ArtifactPath,
      generatedAt: m6Raw.generatedAt || null,
      queryReference: endpointRow('searchEgg', endpoints.searchEgg),
      endpointSnapshot: [
        endpointRow('health', endpoints.health),
        endpointRow('searchEgg', endpoints.searchEgg),
        endpointRow('searchBanana', endpoints.searchBanana),
        endpointRow('historyEgg', endpoints.historyEgg),
        endpointRow('stores', endpoints.stores),
      ],
    },
    comparison: {
      speedupX,
      deltaPct,
    },
    notes: [
      'M0 baseline is from non-distribution/package.json milestone report metadata.',
      'M6 numbers are from benchmark/results/m6_characterization.latest.json.',
      'Interpret speedup as directional because workload semantics differ between M0 and M6.',
    ],
  };

  report.m0.source = toPosixRelative(root, report.m0.source);
  report.m6.source = toPosixRelative(root, report.m6.source);
  const outJsonRelative = toPosixRelative(root, outJson);

  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.mkdirSync(path.dirname(outMd), { recursive: true });

  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(outMd, buildMarkdown(report, outJsonRelative), 'utf8');

  console.log(`[done] m0 vs m6 comparison JSON: ${outJson}`);
  console.log(`[done] m0 vs m6 comparison Markdown: ${outMd}`);
  if (speedupX !== null) {
    console.log(`[summary] speedup=${speedupX}x delta=${deltaPct}%`);
  }
}

main().catch((error) => {
  console.error('[fail] m0 vs m6 comparison failed:', error.message || String(error));
  process.exitCode = 1;
});
