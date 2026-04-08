#!/bin/bash
# This is a student test

T_FOLDER=${T_FOLDER:-t}
R_FOLDER=${R_FOLDER:-}

cd "$(dirname "$0")/../..$R_FOLDER" || exit 1

DIFF=${DIFF:-diff}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat << 'EOF' > "$TMP_DIR/index.html"
<!doctype html>
<html>
  <body>
    <p>Alpha beta.</p>
    <a href="page2.html">Next</a>
  </body>
</html>
EOF

cat << 'EOF' > "$TMP_DIR/page2.html"
<!doctype html>
<html>
  <body>
    <p>Beta gamma.</p>
  </body>
</html>
EOF

INDEX_URL="file://$TMP_DIR/index.html"
PAGE2_URL="file://$TMP_DIR/page2.html"

cat /dev/null > d/visited.txt
cat /dev/null > d/global-index.txt
cat /dev/null > d/urls.txt

echo "$INDEX_URL" > d/urls.txt

./engine.sh

if $DIFF <(sort d/visited.txt) <(printf "%s\n" "$INDEX_URL" "$PAGE2_URL" | sort) >&2;
then
    echo "$0 success: visited urls are identical"
else
    echo "$0 failure: visited urls are not identical"
    exit 1
fi

if grep -q '^alpha |' d/global-index.txt && grep -q '^beta |' d/global-index.txt && grep -q '^gamma |' d/global-index.txt; then
    echo "$0 success: global-index contains expected terms"
    exit 0
else
    echo "$0 failure: global-index missing expected terms"
    exit 1
fi
