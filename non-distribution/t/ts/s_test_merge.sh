#!/bin/bash
# This is a student test

T_FOLDER=${T_FOLDER:-t}
R_FOLDER=${R_FOLDER:-}

cd "$(dirname "$0")/../..$R_FOLDER" || exit 1

DIFF=${DIFF:-diff}

LOCAL_INDEX_FILE="$(
cat << 'EOF'
alpha | 2 | https://example.com/a
alpha | 3 | https://example.com/a
beta | 1 | https://example.com/b
EOF
)"

INITIAL_GLOBAL_INDEX_FILE="$(
cat << 'EOF'
alpha | https://example.com/a 1 https://example.com/c 4
EOF
)"

EXPECTED_GLOBAL_INDEX_FILE="$(
cat << 'EOF'
alpha | https://example.com/a 6 https://example.com/c 4
beta | https://example.com/b 1
EOF
)"

NEW_GLOBAL_INDEX_FILE="$(
  echo "$LOCAL_INDEX_FILE" | ./c/merge.js <(echo "$INITIAL_GLOBAL_INDEX_FILE") | sort
)"

if $DIFF <(echo "$NEW_GLOBAL_INDEX_FILE") <(echo "$EXPECTED_GLOBAL_INDEX_FILE" | sort) >&2;
then
    echo "$0 success: global indexes are identical"
    exit 0
else
    echo "$0 failure: global indexes are not identical"
    exit 1
fi

