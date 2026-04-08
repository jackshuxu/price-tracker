# Price Tracker Migration Plan

## Architecture Diagrams

### Current Architecture

```mermaid
flowchart TD
    Browser["Browser"]

    subgraph Proto["prototype/  —  Next.js 14"]
        Pages["App Router Pages\n/  ·  /tj  ·  /category/slug"]
        API["Server API Routes\n/api/prices  ·  /api/tj/*"]
    end

    BLS["BLS APU Series\nnational averages · build-time ISR"]
    TJG["TJ GraphQL API\ntraderjoes.com/api/graphql"]
    Brand["Brandify\nstore locator"]

    Browser --> Pages
    Pages --> API
    API --> BLS
    API --> TJG
    API --> Brand
```

---

### Stage 1 — TJ Daily Snapshots + Distributed Backend

```mermaid
flowchart TD
    Browser["Browser"]

    subgraph UI["prototype/  —  Query UI  (layout unchanged)"]
        Pages["Next.js Pages\n/  ·  /tj  ·  /category/slug"]
        Proxy["API Proxy Routes\nbase URL → tj/server.js"]
    end

    subgraph Server["tj/server.js  :8080"]
        HTTP["HTTP Server"]
        Q["query.js\nsearch · history · stores"]
    end

    subgraph Nodes["Distributed Store  —  3 EC2 nodes"]
        tjindex["tjindex\nTF-IDF ranked lists per term"]
        tjprices["tjprices\nprice history per SKU+store"]
        tjraw["tjraw\ndaily snapshots  ~2.5M docs"]
        tjstores["tjstores\nstore metadata + coords"]
    end

    subgraph Daily["Daily Pipeline  —  cron 3am UTC"]
        Cron["cron.js"]
        Crawler["crawler.js\n637 TJ stores · GraphQL"]
        MR["indexer.js\nMapReduce ×2 over tjraw"]
    end

    BLS["BLS API\nnational avg · direct"]

    Browser --> Pages
    Pages --> Proxy --> HTTP --> Q
    Q --> tjindex & tjprices & tjstores
    Pages --> BLS

    Cron --> Crawler
    Crawler -->|snapshots| tjraw
    tjraw --> MR
    MR -->|inverted index| tjindex
    MR -->|price history| tjprices
```

---

### Stage N — Multi-Chain Comparison Engine

```mermaid
flowchart TD
    Browser["Browser"]

    subgraph UI["prototype/  —  Query UI"]
        Pages["Next.js Pages\n/  ·  /tj  ·  /compare  ·  /stats"]
        Proxy["API Proxy Routes"]
    end

    subgraph Server["tj/server.js  :8080"]
        HTTP["HTTP Server"]
        Q["query.js\nsearch · compare · history"]
        Match["Product Matcher\nTF-IDF cosine sim across chains"]
    end

    subgraph Nodes["Distributed Store  —  N EC2 nodes"]
        tjindex["tjindex\nmulti-chain inverted index"]
        tjprices["tjprices\nper-chain price history"]
        tjraw["tjraw\nall chains · unified schema"]
        tjstores["tjstores\ngeo-indexed store metadata"]
    end

    subgraph Crawlers["Chain Crawlers  —  daily cron"]
        TJ["TJ crawler\nGraphQL · 637 stores"]
        Kroger["Kroger crawler\nOAuth2 API"]
        Walmart["Walmart crawler\nOpen API"]
        MR["indexer.js\nchain-aware MapReduce"]
    end

    BLS["BLS API\n1980–present national baselines"]
    DB["cmoog SQLite\nhistorical backfill · 4 stores"]

    Browser --> Pages
    Pages --> Proxy --> HTTP --> Q
    Q --> Match --> tjindex
    Q --> tjprices & tjstores
    Pages --> BLS

    TJ & Kroger & Walmart -->|snapshots + chain field| tjraw
    DB -->|backfill| tjraw
    tjraw --> MR
    MR --> tjindex & tjprices
```

---

## Stage Comparison

|                  | Current                       | Stage 1                                    | Stage N                              |
| ---------------- | ----------------------------- | ------------------------------------------ | ------------------------------------ |
| **Data source**  | BLS + live TJ GraphQL         | Distributed store (tjraw/tjindex)          | Multi-chain distributed store        |
| **Prototype changes** | —                        | BASE_URL env var in proxy routes           | Add /compare page                    |
| **New infra**    | —                             | crawler + indexer + tj/server.js           | Per-chain crawlers + product matcher |
| **Hard problem** | —                             | MapReduce key serialization constraints    | Cross-chain product deduplication    |
