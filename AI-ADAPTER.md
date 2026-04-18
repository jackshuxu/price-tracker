# AI Adapter (Read-Only Mounted Service)

This document describes the independent AI adapter layer for the Stage 1 search stack.

## The adapter only performs `GET` requests to backend APIs:

- `/health`
- `/search`
- `/history/{sku}/{storeCode}`
- `/stores`

It never invokes distribution write operations (`put`, `append`, `del`, `reconf`) and never calls mutation endpoints.

## Endpoints

Adapter service endpoints:

- `GET /health`
- `GET /search`
- `GET /history/{sku}/{storeCode}`
- `GET /stores`
- `GET /ai/shelf-harmony?sku=<sku>&storeCode=<storeCode>&q=<query>`

Notes:

- `/search` can be enriched with `ai.shelfHarmony` metadata when enabled.
- `x-adapter-source` indicates response mode (`passthrough`, `search-enriched`, `shelf-harmony`).

## Feature Flags

- `ADAPTER_BACKEND_BASE_URL` (default `http://127.0.0.1:8080`)
- `ADAPTER_ENRICH_SEARCH` (default `false`)
- `ADAPTER_SHELF_HARMONY_ENABLED` (default `false`)
- `ADAPTER_ENRICH_TOP_N` (default `3`)
- `ADAPTER_BACKEND_TIMEOUT_MS` (default `3000`)

## Run

```bash
node ai/adapter.js --port 8090 --backend http://127.0.0.1:8080 --enrich-search --enable-shelf-harmony
```

## Validation

```bash
node distribution/scripts/stage1-adapter-smoke.js
node distribution/scripts/stage1-full-smoke.js --with-adapter
node distribution/scripts/stage1-full-smoke.js --with-explain --with-adapter
```

## Failure Isolation

- Adapter crash does not stop `tj/server.js`.
- Backend failure results in adapter-side 502/error payloads.
- AI features are optional and can be disabled without changing core APIs.
