# M6 Scalability Sweep Results

Generated: 2026-04-20T00:05:01.412Z

Corpus: 100 stores × 50 products = **5000 docs** per run

## Throughput vs Nodes

| Nodes | Crawler (snapshots/sec) | Indexer (docs/sec) | All Components (docs/sec) | Query p95 (ms) | Query (rps) |
| --- | --- | --- | --- | --- | --- |
| 1 | 47.483 | 254.907 | 230.192 | 41.753 | 51.37 |
| 2 | 45.228 | 239.854 | 216.854 | 15.322 | 80 |
| 3 | 47.619 | 249.775 | 226.06 | 18.775 | 80.429 |

## Notes

- Local mode spawns N-1 worker processes on ports 12600+.
- Each round clears tjraw/tjindex/tjprices/tjstores before running.
- Crawler and indexer are timed as child processes (wall-clock).
- Query benchmark runs sequentially after indexing completes.
