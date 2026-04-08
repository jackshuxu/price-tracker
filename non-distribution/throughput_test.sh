#!/bin/bash
# Throughput metrics for crawler, indexer, and query

T_FOLDER=${T_FOLDER:-t}
R_FOLDER=${R_FOLDER:-}

cd "$(dirname "$0")$R_FOLDER" || exit 1

# Wall seconds with fractional part (Linux date +%s%N is not portable on macOS).
timestamp_s() {
  python3 -c 'import time; print(time.time())'
}

safe_divide() {
  awk -v num="$1" -v den="$2" 'BEGIN { if (den <= 0) { print 0 } else { printf "%.4f", num/den } }'
}

cat /dev/null > d/visited.txt
cat /dev/null > d/global-index.txt

cat "$T_FOLDER"/d/u.txt > d/urls.txt

start_s="$(timestamp_s)"
./engine.sh
end_s="$(timestamp_s)"

elapsed_sec="$(awk -v a="$start_s" -v b="$end_s" 'BEGIN { printf "%.6f", b - a }')"

page_count="$(wc -l < d/visited.txt | tr -d ' ')"

crawler_tput="$(safe_divide "$page_count" "$elapsed_sec")"
indexer_tput="$(safe_divide "$page_count" "$elapsed_sec")"

query_count=25
query_term="stuff"

q_start_s="$(timestamp_s)"
for _ in $(seq 1 "$query_count"); do
  ./query.js "$query_term" >/dev/null
done
q_end_s="$(timestamp_s)"

q_elapsed_sec="$(awk -v a="$q_start_s" -v b="$q_end_s" 'BEGIN { printf "%.6f", b - a }')"
query_tput="$(safe_divide "$query_count" "$q_elapsed_sec")"

echo "crawler: pages=$page_count duration=$elapsed_sec res=$crawler_tput"
echo "indexer: pages=$page_count duration=$elapsed_sec res=$indexer_tput"
echo "query: queries=$query_count duration=$q_elapsed_sec res=$query_tput"
