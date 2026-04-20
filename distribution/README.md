# Distribution Directory

This document defines the architecture, entry points, interfaces, contracts, and operational requirements for the distribution runtime under this directory.

Companion docs:
- ../API-SPEC.md for consumer HTTP APIs, CLI contracts, and Stage 1 data schemas
- ../in-pregress.md for rationale, milestone notes, and follow-up items

## 1. Scope

The distribution layer provides:
- Node bootstrap and RPC transport
- Local services on each node
- Group-wide services that broadcast or shard operations
- Shared serialization, hashing, and routing utilities
- MapReduce execution over distributed stores

This layer is the storage and compute backbone for Stage 1 data products:
- tjraw
- tjindex
- tjprices
- tjstores

Boundary note:
- This file is the source of truth for runtime internals and RPC behavior.
- External integration examples and endpoint payload samples are maintained in ../API-SPEC.md.

## 2. Directory Layout

- all/
  - Group-wide APIs (broadcast, sharding, MR orchestration)
- local/
  - Per-node handlers (HTTP-exposed service implementations)
- util/
  - Shared helpers (serialization, ID/hash, RPC wire, logging)
- types.js
  - Contract typedefs
- distribution.d.ts
  - Global runtime typing

## 3. Entry Points and Bootstrap

### 3.1 Root Entry

Top-level runtime factory is in ../distribution.js.

Behavior:
1. Build global runtime object globalThis.distribution
2. Load util, node, local services, and all services
3. Register local services into local routes
4. Optionally use reference library when configured

### 3.2 Startup Modes

- Imported as module:
  - returns distribution factory
- Executed directly:
  - creates runtime and starts HTTP server

## 4. Runtime Model

globalThis.distribution includes:
- util
- node
- local
- all
- dynamic gid handles created by groups.put

Important:
- Groups are first-class. A gid must be registered before gid-level APIs are used.
- Routes are the invocation table for service and method dispatch.

## 5. Wire Protocol Specification

### 5.1 Transport

- Protocol: HTTP
- Method: PUT only
- Path format: /{gid}/{service}/{method}

### 5.2 Request Body

- Serialized argument array
- Encoder: distribution.util.serialize

### 5.3 Response Body

- Serialized tuple: [error, value]
- Decoder: distribution.util.deserialize

### 5.4 Error Contract

- Success: error is null
- Single-target failure: error is Error-like
- Broadcast failure: error may be map sid -> Error

## 6. Core Type Contracts

From types.js:
- Node: { ip: string, port: number, onStart?: Callback, ... }
- Callback: (error, result?) => void
- Config: { gid?, hash?, subset? }
- Hasher: (kid, nids) => nid

## 7. Local Service Specifications

## 7.1 local.status

Methods:
- get(configuration, callback)
- spawn(node, callback)
- stop(callback)

Required get keys:
- nid, sid, counts, ip, port, heapTotal, heapUsed

## 7.2 local.groups

Methods:
- get(name, callback)
- put(configOrName, group, callback)
- del(name, callback)
- add(name, node, callback)
- rem(name, sid, callback)

Contract:
- put creates/updates gid runtime handle in globalThis.distribution[gid]

## 7.3 local.routes

Methods:
- get(configuration, callback)
- put(service, name, callback)
- rem(name, callback)

Contract:
- route key is service name
- gid-aware lookup supported

## 7.4 local.comm

Method:
- send(messageArray, remoteTarget, callback)

Remote target contract:
- { node, service, method, gid? }

Operational behavior:
- shared keep-alive HTTP agent
- timeout controlled by DISTRIBUTION_COMM_TIMEOUT_MS (default 15000)

## 7.5 local.gossip

Method:
- recv(payload, callback)

Payload contract:
- { remote, message, mid, gid }

Behavior:
- MID dedupe (recent set)
- execute target route method
- best-effort fanout via all.gossip.send

## 7.6 local.mem

Methods:
- put(state, config, callback)
- append(state, config, callback)
- get(config, callback)
- del(config, callback)

Storage:
- in-memory map by gid and key

## 7.7 local.store

Methods:
- put(state, config, callback)
- append(state, config, callback)
- batchAppend(entries, config, callback)
- get(config, callback)
- del(config, callback)

Storage:
- file-backed
- path partitioned by node nid and gid

Special behavior:
- get with key null returns all keys in gid
- batchAppend appends many entries with one RPC call

## 8. Group-Wide Service Specifications

## 8.1 all.comm

Method:
- send(messageArray, remote, callback)

Remote contract:
- { service, method, gid? }

Callback value:
- map sid -> response

## 8.2 all.groups

Methods:
- put(config, group, callback)
- get(name, callback)
- add(name, node, callback)
- rem(name, sid, callback)
- del(name, callback)

## 8.3 all.routes

Methods:
- get(configOrName, callback)
- put(serviceObj, name, callback)
- rem(name, callback)

## 8.4 all.status

Methods:
- get(metric, callback)
- spawn(node, callback)
- stop(callback)

Spawn contract:
- starts node
- converges group membership by broadcasting updated map

Spawn reliability notes:
- `spawn` uses a single-callback guard to avoid duplicate completion.
- `spawn` reports early non-zero child exit as failure.
- `spawn` timeout is controlled by `DISTRIBUTION_SPAWN_TIMEOUT_MS` (default 10000).

## 8.5 all.gossip

Methods:
- send(payload, remote, callback)
- at(periodMs, func, callback)
- del(intervalId, callback)

## 8.6 all.mem and all.store

Methods:
- get(config, callback)
- put(state, config, callback)
- append(state, config, callback)
- del(config, callback)
- reconf(newGroup, callback)

Sharding contract:
- key hashed to target node using configured hasher

Reconfiguration contract:
- snapshot keys
- write into new layout
- cleanup old copies

## 8.7 all.mr

Method:
- exec(configuration, callback)

MRConfig:

Lookup behavior:
- Remote-first lookup through group communication.
- Local fallback only when remote lookup fails and local route exists.
- Short-lived cache for route maps, controlled by `DISTRIBUTION_ROUTES_CACHE_MS` (default 1000).
- Cache is invalidated on successful `put` and `rem`.
- map: required
- reduce: required
- keys: optional
- combiner: optional
- partition: optional
- rounds: optional
- constants: optional
- strict: optional
- outputGid: optional
- batchSize: optional
- shuffleConcurrency: optional

Execution stages:
1. map
2. shuffle
3. reduce
4. cleanup

Current performance controls:
- shuffleConcurrency bounds concurrent outgoing shuffle work
- batchSize groups append operations into store.batchAppend RPCs

Return modes:
- outputGid absent:
  - callback gets reduced records array
- outputGid present:
  - callback gets summary object:
    - gid
    - written
    - reducedKeys
    - nodes
    - errors (optional aggregated stage errors)

Strict-mode behavior:
- When `strict=true`, stage-level mapper/combiner/reducer failures propagate as fatal MR errors.
- When `strict=false`, MR attempts best-effort completion and records sampled stage errors in summaries when available.

## 9. Serialization and Function Constraints

Serializer supports primitives, arrays, objects, Date, Error, bigint, and function source strings.

Critical requirement:
- Route-serialized mapper/reducer/combiner functions must not depend on outer lexical closures.
- Helpers needed by serialized functions must be defined inside those functions.

## 10. ID and Hashing Contracts

util/id.js provides:
- getID
- getNID
- getSID
- getMID
- naiveHash
- consistentHash
- rendezvousHash

Key contracts:
- Key placement uses hasher(kid, nids)
- Group sharding correctness depends on stable nid list ordering per algorithm semantics

## 11. Operational Requirements

- Always register gid group before using gid services.
- Treat error maps from broadcast APIs as partial-failure signals.
- Use bounded concurrency for fanout work at scale.
- Prefer outputGid mode for large MR outputs to avoid coordinator OOM.
- For large unique-cardinality metrics, use MR summaries (for example reducedKeys) instead of coordinator Set aggregation.
- Keep `DISTRIBUTION_SPAWN_TIMEOUT_MS` explicit in environments with slow process startup.
- Use MR strict mode for correctness-critical jobs and smoke validation.

## 12. Document Ownership and Sync Rules

- Update this file when runtime behavior, wire protocol, or service semantics change.
- Update ../API-SPEC.md when consumer-facing HTTP, CLI, or schema contracts change.
- Update ../in-pregress.md with rationale and migration notes whenever either contract surface changes.