# In-Pregress Notes

This file records what changed, why it changed, and the current interface contracts for alignment across team members.

Companion docs:
- API-SPEC.md (consumer APIs, CLI contracts, and schema examples)
- distribution/README.md (runtime internals and distributed execution semantics)

## 1. Scope of This Change Set

Primary focus:
- Make MapReduce and indexer safe for very large datasets
- Keep Stage 1 pipeline runnable e2e
- Define stable I/O contracts so teammates can integrate without guessing
- Add minimal service and CLI placeholders to exercise MR and indexing paths early

## 2. prototype/lib/distribution-client.ts

File:
- prototype/lib/distribution-client.ts

Reason:
- The Next.js layer needed a typed RPC client for direct calls into the distribution node API.
- The distribution wire format is not plain JSON for all types (custom serialization for Error, Date, bigint, function, special numbers).
- This client mirrors distribution serialization semantics in what we did in M0, so browser/server route adapters can be built safely.

What it standardizes:
- Request target contract:
  - { host, port, gid, service, method }
- Request payload contract:
  - message array, serialized with local encoder
- Response contract:
  - [error, value]
- Error handling:
  - throw when HTTP non-2xx
  - throw when RPC tuple malformed
  - throw typed error if error slot is non-null

Current status:
- Present and ready for integration.
- Prototype API routes are still mostly direct TJ API or mock fallback, so this is a forward-compatible foundation.

## 3. Placeholder Components Added For Fast Integration Testing

These files are intentionally minimal to unblock MR/indexer validation:
- query.js (root wrapper)
- tj/query.js
- tj/runtime.js
- tj/server.js
- crawler.js
- cron.js

Why they are minimal now:
- Immediate goal was validating distributed storage, MR throughput behavior, and indexing correctness.
- Auth, richer filtering, stronger store metadata quality, and route hardening can be layered later without replacing the core contracts.

## 4. MR and Indexer: Bottlenecks Found and Fixes Shipped

## 4.1 Bottleneck A: Coordinator OOM

Problem:
- Previous pattern pulled all reduce outputs back into one coordinator process.
- At multi-million scale, this is definitely an OOM, I already tired it on my own device.

Fixes:
- all.mr supports outputGid mode.
- Reducers write final outputs directly to distributed store.
- Coordinator receives only compact summary metadata.

Impact:
- Coordinator memory no longer scales with full result cardinality.

## 4.2 Bottleneck B: Shuffle OOS

Problem:
- Naive shuffle emitted one append RPC per intermediate tuple.
- This can create huge burst fanout and socket/file-descriptor pressure.

Fixes:
- all.mr shuffle now supports:
  - bounded concurrency (shuffleConcurrency)
  - batching (batchSize)
- local.store gained batchAppend(entries, { gid }, cb).
- Fallback to append remains for compatibility.

Impact:
- Lower RPC count
- Lower connection churn
- Better throughput stability under larger intermediate fanout

## 4.3 Bottleneck C: Missing Local Aggregation Before Shuffle

Problem:
- Without combiner, duplicate keys traverse network repeatedly.

Fixes:
- indexer provides indexCombiner and priceCombiner.
- Partial local compaction happens before network shuffle.

Impact:
- Reduced network payload volume (we can actullay try harder with the method described in a paper in 2024, but for stage 1 we can just skip for now)
- Lower remote append pressure

## 4.4 Bottleneck D: Coordinator Set Aggregation for doc universe

Problem:
- Distinct doc counting via coordinator Set can still be OOM.

Fixes:
- Added doc-count MR path.
- MR summaries now include reducedKeys.
- Indexer computes totalDocs from distributed summary, not a coordinator docId Set.

Impact:
- Removes another large-memory hotspot from coordinator.

## 5. Standardized Input/Output Specifications

For concrete endpoint examples and consolidated external contracts, see API-SPEC.md.

## 5.1 Distribution RPC Contract

Request:
- Method: PUT
- Path: /{gid}/{service}/{method}
- Body: serialized args array

Response:
- serialized [error, value]

Error contract:
- error null => success
- error non-null => failure

## 5.2 MapReduce Contract

Input (MRConfig):
- map(key, value, constants?) -> object[]
- reduce(key, values, constants?) -> object
- combiner(key, values, constants?) optional
- partition optional
- rounds optional
- constants optional
- outputGid optional
- batchSize optional
- shuffleConcurrency optional

Output:
- If outputGid is not set: reduced object[]
- If outputGid is set: { gid, written, reducedKeys, nodes }

Operational requirements:
- mapper/reducer/combiner must be closure-safe when serialized
- prefer outputGid for large outputs
- use combiner whenever local aggregation is valid

## 5.3 Indexer Contract

Input store:
- gid: tjraw
- expected snapshot shape:
  - capturedAt, storeCode
  - products[] with fields like sku/name/price/category/size (or equivalent aliases)

Output stores:
- gid: tjindex
  - key: term
  - value: { term, df, totalDocs, idf, postings[], updatedAt }
- gid: tjprices
  - key: sku|storeCode
  - value: { sku, storeCode, name, latestPrice, latestAt, history[], samples }

Summary entry:
- gid: tjindex
- key: _meta:indexer (default)
- value includes snapshot/product/doc stats and write counts

CLI inputs (indexer.js):
- --host --port --peers
- --input-gid --index-gid --price-gid
- --top-k --concurrency
- --shuffle-batch-size --shuffle-concurrency
- --keep-existing --strict-group

## 5.4 Query and Server Contracts (Current Minimal Form)

tj/query.js command modes:
- search
- history
- stores

Outputs are JSON arrays/objects for easy piping and HTTP reuse.

tj/server.js endpoints:
- GET /health
- GET /search?q=...&storeCode=...&limit=...
- GET /history/{sku}/{storeCode}
- GET /stores?state=XX

Current requirement:
- these are intentionally minimal but stable enough for prototype route integration.

## 5.5 Runtime and Pipeline Contracts

tj/runtime.js:
- starts coordinator node
- optionally discovers reachable peers
- ensures stage1 gids are present
- exposes callback-to-promise wrappers and bounded map helper

crawler.js:
- writes snapshots into tjraw
- writes minimal store metadata into tjstores
- supports online fetch and file-driven snapshots

cron.js:
- orchestrates crawler then indexer
- supports one-shot and repeat mode

## 6. What Is Not Final Yet

- Some files are intentionally placeholder implementations for speed of integration testing.
- Prototype API routes still mostly call direct TJ APIs or mocks.
- distribution-client exists to support moving those routes to distribution-backed calls consistently.

## 7. Some Follow-Up Work I suggest

1. Integrate prototype app/api/tj routes with distribution-client and tj/server.
2. Enrich tjstores metadata quality (city/state/address/zip/coordinates). And this is also useful for further enhancement.
3. Tighten type annotations in distribution/all/mr.js to clear static warnings.
4. Run throughput benchmarks with larger synthetic snapshots and tune batch/concurrency defaults.