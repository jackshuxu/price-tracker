# M6 Component Performance Benchmark

Generated: 2026-04-19T23:31:28.347Z

Warmup: 5 queries · Iterations: 40

## Corpus 1 — small

Corpus: 10 stores × 50 products = **500 docs**


| Component     | Throughput          | p50 latency       | p95 latency | p99 latency |
| ------------- | ------------------- | ----------------- | ----------- | ----------- |
| Crawler       | 6.285 snapshots/sec | 159.1 ms/snapshot | —           | —           |
| Storage (put) | 2034.666 ops/sec    | 0.431 ms          | 0.686 ms    | 1.553 ms    |
| Storage (get) | 3609.39 ops/sec     | 0.254 ms          | 0.394 ms    | 0.558 ms    |
| Indexer (MR)  | 158.73 docs/sec     | 6.3 ms/doc        | —           | —           |
| Search        | 325.203 rps         | 2.828 ms          | 4.812 ms    | 5.583 ms    |


## Corpus 2 — medium

Corpus: 50 stores × 100 products = **5000 docs**


| Component     | Throughput          | p50 latency      | p95 latency | p99 latency |
| ------------- | ------------------- | ---------------- | ----------- | ----------- |
| Crawler       | 29.94 snapshots/sec | 33.4 ms/snapshot | —           | —           |
| Storage (put) | 2421.78 ops/sec     | 0.347 ms         | 0.628 ms    | 2.317 ms    |
| Storage (get) | 1883.907 ops/sec    | 0.237 ms         | 0.578 ms    | 9.535 ms    |
| Indexer (MR)  | 486.855 docs/sec    | 2.054 ms/doc     | —           | —           |
| Search        | 231.214 rps         | 3.012 ms         | 7.813 ms    | 38.843 ms   |


## Notes

- Each corpus runs on a fresh coordinator; KV data persists to `store/` keyed by node identity (IP:port).
- Crawler and indexer are timed as child processes (wall-clock end-to-end).
- Storage benchmark uses direct `distribution.all.store` put/get calls on a scratch gid.
- Search benchmark fires HTTP requests at the live query server with 5-request warmup.

