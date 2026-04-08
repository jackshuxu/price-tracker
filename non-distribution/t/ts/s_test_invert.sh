#!/bin/bash
# This is a student test

T_FOLDER=${T_FOLDER:-t}
R_FOLDER=${R_FOLDER:-}

cd "$(dirname "$0")/../..$R_FOLDER" || exit 1

DIFF=${DIFF:-diff}

URL="https://example.com/page"

INPUT_NGRAMS="$(
cat << 'EOF'
alpha beta
alpha beta
beta gamma
alpha
EOF
)"

EXPECTED="$(
cat << 'EOF'
alpha | 1 | https://example.com/page
alpha beta | 2 | https://example.com/page
beta gamma | 1 | https://example.com/page
EOF
)"

if $DIFF <(printf "%s\n" "$INPUT_NGRAMS" | c/invert.sh "$URL" | sed 's/[[:space:]]//g' | sort) <(printf "%s\n" "$EXPECTED" | sed 's/[[:space:]]//g' | sort) >&2;
then
    echo "$0 success: inverted indices are identical"
    exit 0
else
    echo "$0 failure: inverted indices are not identical"
    exit 1
fi

