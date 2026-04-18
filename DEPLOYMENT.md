# Deployment Runbook (Stage 1)

Last updated: 2026-04-16

This runbook captures a reproducible deployment path for the Stage 1 distributed search stack.

## 1) Topology

- Coordinator/API node:
  - runs `tj/server.js` and optional mounted services.
- Worker nodes:
  - run distribution node process and serve sharded data/compute.

Suggested baseline:

- 3 nodes total for class-scale testing.
- Same Node.js major version across all nodes.

## 2) Required Services

- Core:
  - distributed node runtime (M5 components)
  - `crawler.js`
  - `indexer.js`
  - `tj/server.js`
- Optional:
  - `ai/adapter.js`
  - prototype Next API routes

## 3) Environment Variables

Core runtime:

- `DISTRIBUTION_SPAWN_TIMEOUT_MS`
- `DISTRIBUTION_ROUTES_CACHE_MS`

Prototype route fallback controls:

- `TJ_API_ALLOW_EXTERNAL_FALLBACK`
- `TJ_API_ALLOW_MOCK_FALLBACK`
- `TJ_API_EXPLAIN_ENABLED`

Adapter controls:

- `ADAPTER_BACKEND_BASE_URL`
- `ADAPTER_ENRICH_SEARCH`
- `ADAPTER_SHELF_HARMONY_ENABLED`
- `ADAPTER_ENRICH_TOP_N`
- `ADAPTER_BACKEND_TIMEOUT_MS`

## 4) Bring-Up Sequence

Run from repo root on coordinator node.

1. Verify runtime health baseline:

```bash
node distribution/scripts/stage1-smoke.js
```

2. Seed and verify API path:

```bash
node distribution/scripts/stage1-api-smoke.js
```

3. Validate full pipeline path:

```bash
node distribution/scripts/stage1-pipeline-smoke.js
```

4. Start API server:

```bash
node tj/server.js --port 8080 --coordinator-port 12400 --strict-group
```

5. Optional adapter start:

```bash
node ai/adapter.js --port 8090 --backend http://127.0.0.1:8080 --enrich-search --enable-shelf-harmony
```

## 5) Validation Matrix

Core + optional capabilities:

```bash
node distribution/scripts/stage1-full-smoke.js
node distribution/scripts/stage1-full-smoke.js --with-explain
node distribution/scripts/stage1-full-smoke.js --with-adapter
node distribution/scripts/stage1-full-smoke.js --with-explain --with-adapter
```

Characterization and workload artifacts:

```bash
node benchmark/scripts/m6_characterize.js --iterations 40 --warmup 5
node benchmark/scripts/m6_compare_m0.js
node benchmark/scripts/m6_workload_evidence.js
```

## 6) Cost and Safety Notes

- Stop non-essential instances when idle.
- Keep optional services (adapter/explain) disabled unless needed for demo.
- Avoid long-running crawler jobs during write-up windows.

## 7) Production Deployment Details

The Stage 1 distributed stack has been successfully deployed and verified in AWS environment.

**1. Infrastructure & Compute**
- **Cloud Provider:** AWS (Amazon Web Services)
- **Region:** `us-east-1` (N. Virginia)
- **Instance Type:** 3x `m7i-flex.large` (providing optimal baseline performance for compute-heavy MapReduce tasks while maintaining cost-efficiency).
- **OS:** Ubuntu 24.04 LTS

**2. Networking & Security Group Configuration**
All nodes reside within a shared VPC subnet with the following ingress rules:
- **TCP 22:** Open for SSH access (restricted to administrator IP).
- **TCP 12400:** Open for internal Gossip, RPC, and MapReduce coordination across the `172.31.x.x` private IP space.
- **TCP 8080 / 8090:** Open for external API queries (`tj/server.js`) and the AI Adapter layer.

**3. Cost Summary**
- **Estimated Run Rate:** ~$0.285/hour for the complete 3-node cluster.
- **Evaluation Window Cost:** The cluster will remain active through the final evaluation period (until the Tuesday deadline). Total projected cost is kept strictly under $40.00.

**4. Out-of-Memory (OOM) Mitigation**
During extreme workload ingestion (e.g., 30k-100k synthetic products), the V8 engine's default memory limit was insufficient. The production nodes are configured to launch with explicitly expanded heap space:
`NODE_OPTIONS=--max-old-space-size=6144` (allocating 6GB to Node.js, fully utilizing the instances' available memory).
