#!/bin/bash
# This is a student test

T_FOLDER=${T_FOLDER:-t}
R_FOLDER=${R_FOLDER:-}

cd "$(dirname "$0")/../..$R_FOLDER" || exit 1

DIFF=${DIFF:-diff}

cat << 'EOF' > d/global-index.txt
blue | https://example.com/page 2
blue sky | https://example.com/page 1
sky | https://example.com/page 3
EOF

QUERY="blue"

EXPECTED="$(
cat << 'EOF'
blue | https://example.com/page 2
blue sky | https://example.com/page 1
EOF
)"

if $DIFF <(./query.js "$QUERY") <(printf "%s\n" "$EXPECTED") >&2;
then
    echo "$0 success: search results are identical"
    exit 0
else
    echo "$0 failure: search results are not identical"
    exit 1
fi
