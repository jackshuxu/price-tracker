# Price Tracker API Specification

This document is the integration contract for us consuming the current distributed backend. You can feel free to modify it to match your end. Please modify this md first before update any anction may affect the input/output specifications! 

## 1. Purpose and Scope

This file defines:
- External HTTP API contracts exposed by tj/server.js
- Internal distribution RPC envelope and path format
- Data schemas for Stage 1 gids
- CLI contracts for crawler/indexer/query/cron
- Placeholder boundaries and non-final behavior

This specification is aligned with:
- distribution/README.md (runtime internals)
- in-pregress.md (change rationale and current status)

## 2. Versioning and Compatibility

Current compatibility level:
- Version: stage1-draft-v1
- Stability: medium for integration testing, not final production API

Backward compatibility expectations:
- Endpoint paths and core response shapes should remain stable
- Field additions are allowed
- Field removals and semantic changes require version bump notes in in-pregress.md

## 3. Common Conventions

Encoding:
- HTTP APIs return JSON
- Distribution RPC uses custom serialization envelope

Timestamps:
- ISO-8601 string in UTC, for example 2026-04-08T13:34:38.873Z

Identity:
- Product identity key: sku|storeCode
- Term identity key: term string

Error semantics:
- HTTP APIs use status code + JSON body with error
- RPC envelope uses [error, value]

## 4. Consumer HTTP APIs (tj/server.js)

Base:
- Host: configurable
- Port: configurable, default 8080

## 4.1 GET /health

Description:
- Liveness and coordinator metadata

Response 200 example:
```json
{
  "ok": true,
  "coordinator": { "host": "127.0.0.1", "port": 12400 },
  "peers": [],
  "now": "2026-04-08T13:33:38.453Z"
}
```

## 4.2 GET /search

Query params:
- q: required search text
- storeCode: optional store filter
- limit: optional positive integer, default 20

Response 200 example:
```json
[
  {
    "sku": "050116",
    "storeCode": "1109",
    "name": "Organic Bananas",
    "price": 0.29,
    "latestAt": "2026-04-08T13:31:29.395Z",
    "score": 1.133531,
    "matchedTerms": ["banana"]
  }
]
```

Response 200 for empty q:
```json
[]
```

## 4.3 GET /history/{sku}/{storeCode}

Path params:
- sku: product sku
- storeCode: store code

Response 200 example:
```json
[
  { "date": "2026-04-08T13:26:10.573Z", "price": 1.99 },
  { "date": "2026-04-08T13:34:38.873Z", "price": 2.19 }
]
```

## 4.4 GET /stores

Query params:
- state: optional 2-letter state code

Response 200 example:
```json
[
  {
    "storeCode": "1109",
    "name": "Trader Joe's 1109",
    "city": "",
    "state": "",
    "address": "",
    "zip": "",
    "lat": null,
    "lng": null
  }
]
```

## 4.5 Shared HTTP Error Responses

404:
```json
{ "error": "Not found" }
```

405:
```json
{ "error": "Method not allowed" }
```

500:
```json
{ "error": "<message>" }
```

## 5. Distribution RPC Specification

Path format:
- /{gid}/{service}/{method}

Method:
- PUT

Request body:
- Serialized argument array via distribution util serializer

Response body:
- Serialized tuple [error, value]

Success:
- error is null

Failure:
- error is Error-like object or map sid -> Error for broadcast calls

## 6. prototype/lib/distribution-client.ts Contract

## 6.1 callDistribution target

Type:
```ts
type DistributionTarget = {
  host: string
  port: number
  gid: string
  service: string
  method: string
}
```

## 6.2 callDistribution invocation

Signature:
```ts
callDistribution<T>(target: DistributionTarget, message: unknown[]): Promise<T>
```

Behavior:
- Sends PUT to /gid/service/method
- Uses mirrored serializer in frontend TypeScript
- Throws on non-2xx HTTP
- Throws on malformed RPC tuple
- Throws when RPC error slot is non-null
- Returns typed value slot

## 7. Stage 1 Data Schemas

## 7.1 tjraw

Key:
- Suggested key pattern: chain:storeCode:capturedAt

Value:
```json
{
  "capturedAt": "ISO timestamp",
  "storeCode": "string",
  "chain": "trader_joes",
  "products": [
    {
      "sku": "string",
      "name": "string",
      "price": 1.23,
      "category": "string",
      "size": "string",
      "storeCode": "string",
      "capturedAt": "ISO timestamp"
    }
  ]
}
```

## 7.2 tjindex

Key:
- term string

Value:
```json
{
  "term": "string",
  "df": 123,
  "totalDocs": 456,
  "idf": 1.234567,
  "postings": [
    {
      "docId": "sku|storeCode",
      "tf": 2,
      "score": 3.14,
      "sku": "string",
      "storeCode": "string",
      "name": "string",
      "lastSeen": "ISO timestamp"
    }
  ],
  "updatedAt": "ISO timestamp"
}
```

Reserved meta key:
- _meta:indexer

## 7.3 tjprices

Key:
- sku|storeCode

Value:
```json
{
  "sku": "string",
  "storeCode": "string",
  "name": "string",
  "latestPrice": 1.23,
  "latestAt": "ISO timestamp",
  "history": [
    { "sku": "string", "storeCode": "string", "name": "string", "price": 1.23, "capturedAt": "ISO timestamp" }
  ],
  "samples": 3
}
```

## 7.4 tjstores

Key:
- storeCode

Value:
```json
{
  "storeCode": "string",
  "name": "string",
  "city": "string",
  "state": "string",
  "address": "string",
  "zip": "string",
  "lat": null,
  "lng": null
}
```

## 8. MapReduce Execution Contract (all.mr.exec)

Input configuration:
- map: required
- reduce: required
- combiner: optional
- partition: optional
- rounds: optional
- constants: optional
- outputGid: optional
- batchSize: optional
- shuffleConcurrency: optional

Output contract:
- outputGid not set:
  - reduce result array
- outputGid set:
  - summary object
```json
{
  "gid": "target gid",
  "written": 210,
  "reducedKeys": 210,
  "nodes": 3
}
```

Closure safety requirement:
- mapper/reducer/combiner functions are serialized and remote-executed
- these functions must be self-contained and must not rely on outer lexical closures

## 9. CLI Contracts

## 9.1 indexer.js

Purpose:
- Build tjindex and tjprices from tjraw via MR

Important flags:
- --host --port --peers
- --input-gid --index-gid --price-gid
- --top-k --concurrency
- --shuffle-batch-size --shuffle-concurrency
- --keep-existing --strict-group

## 9.2 crawler.js

Purpose:
- Fetch or import snapshots and write tjraw and tjstores

Important flags:
- --host --port --peers
- --raw-gid --stores-gid
- --store-codes --terms --page-size
- --snapshot-file
- --no-fallback

## 9.3 query.js and tj/query.js

Modes:
- search
- history
- stores

Notes:
- query.js is a root wrapper that delegates to tj/query.js

## 9.4 cron.js

Purpose:
- Orchestrate crawler then indexer

Modes:
- one-shot by default
- repeat mode with --interval-minutes or --repeat

## 10. Current Placeholder Boundaries

The following are intentionally minimal for now:
- tj/query.js
- tj/server.js
- tj/runtime.js
- crawler.js
- cron.js
- query.js wrapper

Reason:
- They are scaffolding for validating MR/indexer/storage behavior and integration flow.
- They are not yet complete productized services.

## 11. Integration Checklist

1. Start coordinator and ensure gids are registered.
2. Run crawler to fill tjraw/tjstores.
3. Run indexer and verify _meta:indexer in tjindex.
4. Validate /search and /history responses from tj/server.js.
5. Wire prototype routes through distribution-client or tj/server.

## 12. Change Control

When changing contracts:
- Please Please Please update this file first !!!
- Then update in-pregress.md rationale section
- And update distribution/README.md if runtime-level semantics changed
