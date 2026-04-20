# M6 Correctness Benchmark Results

Generated: 2026-04-17T19:32:55.014Z

## Corpus

| Field | Value |
| --- | --- |
| Snapshots (stores) | 3 |
| Total products | 13 |
| Unique SKUs | 9 |
| Stores | GOLD01, GOLD02, GOLD03 |

## Summary

| Metric | Value |
| --- | --- |
| Total tests | 10 |
| Passed | 10 |
| Failed | 0 |
| Pass rate | 100.0% |

## Test Results

| ID | Query | Expected Top-1 | Actual Top-1 | #Results | Pass |
| --- | --- | --- | --- | --- | --- |
| Q1 | `acai berry smoothie` | GOLD-ACAI | GOLD-ACAI-001 | 3 | ✓ |
| Q2 | `quinoa grain blend` | GOLD-QUINOA | GOLD-QUINOA-002 | 2 | ✓ |
| Q3 | `matcha green tea` | GOLD-MATCHA | GOLD-MATCHA-004 | 2 | ✓ |
| Q4 | `kimchi fermented` | GOLD-KIMCHI | GOLD-KIMCHI-006 | 1 | ✓ |
| Q5 | `truffle pizza` | GOLD-TRUFFLE | GOLD-TRUFFLE-005 | 1 | ✓ |
| Q6 | `mochi ice cream vanilla` | GOLD-MOCHI | GOLD-MOCHI-008 | 1 | ✓ |
| Q7 | `sriracha ranch dressing` | GOLD-SRIRACHA | GOLD-SRIRACHA-003 | 1 | ✓ |
| Q8 | `nonexistent product xyzabc` | (empty) | (empty) | 0 | ✓ |
| H1 | `history/GOLD-ACAI-001/GOLD01` | GOLD-ACAI | GOLD-ACAI-001 | 1 | ✓ |
| S1 | `stores` | (empty) | n/a | 3 | ✓ |

## Notes

- This benchmark uses a synthetic golden-answer corpus where the correct ranking is known in advance.
- Each query targets a unique product with distinctive terms to verify top-1 correctness.
- The benchmark exercises the full pipeline: crawler → indexer (MR) → query server.
