# non-distribution

This milestone aims (among others) to refresh (and confirm) everyone's
background on developing systems in the languages and libraries used in this
course.

By the end of this assignment you will be familiar with the basics of
JavaScript, shell scripting, stream processing, Docker containers, deployment
to AWS, and performance characterization—all of which will be useful for the
rest of the project.

Your task is to implement a simple search engine that crawls a set of web
pages, indexes them, and allows users to query the index. All the components
will run on a single machine.

## Getting Started

To get started with this milestone, run `npm install` inside this folder. To
execute the (initially unimplemented) crawler run `./engine.sh`. Use
`./query.js` to query the produced index. To run tests, do `npm run test`.
Initially, these will fail.

### Overview

The code inside `non-distribution` is organized as follows:

```
.
├── c            # The components of your search engine
├── d            # Data files like seed urls and the produced index
├── s            # Utility scripts for linting your solutions
├── t            # Tests for your search engine
├── README.md    # This file
├── crawl.sh     # The crawler
├── index.sh     # The indexer
├── engine.sh    # The orchestrator script that runs the crawler and the indexer
├── package.json # The npm package file that holds information like JavaScript dependencies
└── query.js     # The script you can use to query the produced global index
```

### Submitting

To submit your solution, run `./scripts/submit.sh` from the root of the stencil. This will create a
`submission.zip` file which you can upload to the autograder.

## Summary

My implementation consists of 15 (6 implementations and 9 tests) components addressing T1--8. The most challenging aspect was getting myself familiar with javascript since I haven't use it for a long time. The most challenging implementation was merge.js because we have two formats to parse, the local ones and the global ones. And when a url already exists in the global index, we must sum the frequencies, otherwise we add a new entry. It was challenging to not double-count. Also we need to take in condiseration of the sorting requirements. 


## Correctness & Performance Characterization

To characterize correctness, I developed 9 that test the following cases: validates Porter stemming on a known word set; build a tiny global-index and checks query filtering for a single term; check that stopword-only input produces no output; checks merge behavior with duplicate URLs; verifies URL extraction for relative, rooted, absolute, and missing href; checks text extraction for ignoring empty lines; checks 1/2/3‑gram generation on a short input; check end‑to‑end flow. 


*Performance*: I write a script throughput_test for testing throughput for crawler, indexer and query. I use https://cs.brown.edu/courses/csci1380/sandbox/1. 


## Wild Guess

> How many lines of code do you think it will take to build the fully distributed, scalable version of your search engine? Add that number to the `"dloc"` portion of package.json, and justify your answer below.

I estimate about 5,000 lines of code. A distributed, scalable system would need networking and RPC, consensus, sharded storage, replication, fault handling, load balancing, caching, and backpressure. Each of those components adds nontrivial logic beyond the current simple ones. So I estimated 5000.