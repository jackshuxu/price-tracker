#!/usr/bin/env bash
# M0 end-to-end on the M6 golden fixture: crawl -> index -> query checks.
# Exits 0 on success, non-zero on mismatch.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GOLDEN_PAGES="$(cd "$SCRIPT_DIR/../golden/pages" && pwd)"
ND="$(cd "$SCRIPT_DIR/../../non-distribution" && pwd)"

SEED_URL="file://${GOLDEN_PAGES}/tj/index.html"
URL_TJ="file://${GOLDEN_PAGES}/tj/index.html"
URL_WF="file://${GOLDEN_PAGES}/wf/index.html"

cd "$ND" || exit 1

# combine.sh uses named FIFOs in cwd; stale nodes break indexing
rm -f p1 p2 p3

cat /dev/null > d/visited.txt
cat /dev/null > d/global-index.txt
cat /dev/null > d/urls.txt
echo "$SEED_URL" > d/urls.txt

./engine.sh

DIFF="${DIFF:-diff}"
if ! $DIFF <(sort d/visited.txt) <(printf '%s\n' "$URL_TJ" "$URL_WF" | sort) >&2; then
  echo "m0_golden_run: visited URLs do not match expected (see manifest.json)" >&2
  exit 1
fi

ALMOND_OUT="$(./query.js almond)"
if ! printf '%s\n' "$ALMOND_OUT" | grep -Fq "$URL_TJ" || ! printf '%s\n' "$ALMOND_OUT" | grep -Fq "$URL_WF"; then
  echo "m0_golden_run: query 'almond' must list both golden URLs in the index output" >&2
  exit 1
fi

TRADER_OUT="$(./query.js trader)"
if ! printf '%s\n' "$TRADER_OUT" | grep -Fq "$URL_TJ"; then
  echo "m0_golden_run: query 'trader' must hit the Trader Joe page" >&2
  exit 1
fi
if printf '%s\n' "$TRADER_OUT" | grep -Fq "$URL_WF"; then
  echo "m0_golden_run: query 'trader' must not hit the Whole Foods page" >&2
  exit 1
fi

echo "m0_golden_run: OK (m6-golden-price-v1)"
exit 0
