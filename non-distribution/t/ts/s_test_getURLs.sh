#!/bin/bash
# This is a student test

T_FOLDER=${T_FOLDER:-t}
R_FOLDER=${R_FOLDER:-}

cd "$(dirname "$0")/../..$R_FOLDER" || exit 1

DIFF=${DIFF:-diff}

BASE_URL="https://example.com/dir/index.html"

HTML_INPUT="$(
cat << 'EOF'
<!doctype html>
<html>
  <body>
    <a href="page.html">Relative</a>
    <a href="/rooted">Rooted</a>
    <a href="https://other.example.com/x">Absolute</a>
    <a>Missing href</a>
  </body>
</html>
EOF
)"

EXPECTED="$(
cat << 'EOF'
https://example.com/dir/page.html
https://example.com/rooted
https://other.example.com/x
EOF
)"

if $DIFF <(printf "%s\n" "$HTML_INPUT" | c/getURLs.js "$BASE_URL" | sort) <(printf "%s\n" "$EXPECTED" | sort) >&2;
then
    echo "$0 success: URL sets are identical"
    exit 0
else
    echo "$0 failure: URL sets are not identical"
    exit 1
fi

