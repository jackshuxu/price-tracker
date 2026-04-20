# M6 Target Workload Evidence

Generated: 2026-04-16T22:28:31.078Z

## Workload Configuration

| Field | Value |
| --- | --- |
| Stores crawled | 30 |
| Products per store | 120 |
| Total synthetic products | 3600 |
| Coordinator port | 12456 |

## Pipeline Results

| Metric | Value |
| --- | --- |
| tjraw snapshot keys | 30 |
| tjstores keys | 30 |
| tjprices keys | 3600 |
| tjindex keys | 2590 |
| crawler duration | 1747 ms |
| indexer duration | 15872 ms |

## API Spot Checks

| Endpoint | Status | Latency (ms) | Result size |
| --- | --- | --- | --- |
| /health | 200 | 39.311 | n/a |
| /stores | 200 | 44.995 | 30 |
| /search?q=egg | 200 | 13.321 | 10 |
| /history/{sku}/{store} | 200 | 6.069 | 1 |

## Artifact

- Machine-readable report: `benchmark/results/m6_workload_evidence.latest.json`

## Notes

- This artifact provides reproducible T2 workload-depth evidence using deterministic synthetic snapshots.
- The pipeline path is exercised through crawler -> indexer -> tj/server APIs on distributed storage groups.
