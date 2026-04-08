#!/bin/bash
# This is a student test

T_FOLDER=${T_FOLDER:-t}
R_FOLDER=${R_FOLDER:-}

cd "$(dirname "$0")/../..$R_FOLDER" || exit 1

DIFF=${DIFF:-diff}

INPUT_WORDS="$(
cat << 'EOF'
caresses
ponies
ties
caress
cats
EOF
)"

EXPECTED="$(
cat << 'EOF'
caress
poni
ti
caress
cat
EOF
)"

if $DIFF <(printf "%s\n" "$INPUT_WORDS" | c/stem.js) <(printf "%s\n" "$EXPECTED") >&2;
then
    echo "$0 success: stemmed words are identical"
    exit 0
else
    echo "$0 failure: stemmed words are not identical"
    exit 1
fi
