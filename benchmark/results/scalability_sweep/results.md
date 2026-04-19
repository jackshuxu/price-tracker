# M6 Scalability Sweep Results

Generated: 2026-04-19T23:37:58.448Z

Corpus: 20 stores × 50 products = **1000 docs** per run

## Throughput vs Nodes

| Nodes | Crawler (snapshots/sec) | Indexer (docs/sec) | All Components (docs/sec) | Query p95 (ms) | Query (rps) |
| --- | --- | --- | --- | --- | --- |
| 1 | 12.477 | 266.383 | 186.672 | 7.389 | 256.41 |
| 2 | 12.422 | 246.427 | 176.429 | 3.866 | 526.316 |
| 4 | 12.461 | 238.379 | 172.414 | 2.392 | 789.474 |
| 8 | 12.407 | 222.272 | 163.639 | 4.142 | 337.079 |

## Notes

- Local mode spawns N-1 worker processes on ports 12600+.
- Each round clears tjraw/tjindex/tjprices/tjstores before running.
- Crawler and indexer are timed as child processes (wall-clock).
- Query benchmark runs sequentially after indexing completes.
