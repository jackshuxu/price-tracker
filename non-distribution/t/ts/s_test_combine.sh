#!/bin/bash
# This is a student test

T_FOLDER=${T_FOLDER:-t}
R_FOLDER=${R_FOLDER:-}

cd "$(dirname "$0")/../..$R_FOLDER" || exit 1

DIFF=${DIFF:-diff}

INPUT_WORDS="$(
cat << 'EOF'
alpha
beta
gamma
EOF
)"

EXPECTED="$(
cat << 'EOF'
alpha
alpha	beta
alpha	beta	gamma
beta
beta	gamma
gamma
EOF
)"

if $DIFF <(printf "%s\n" "$INPUT_WORDS" | c/combine.sh | sed 's/\t*$//' | sort | uniq) <(printf "%s\n" "$EXPECTED" | sed 's/\t*$//' | sort | uniq) >&2;
then
    echo "$0 success: ngrams are identical"
    exit 0
else
    echo "$0 failure: ngrams are not identical"
    exit 1
fi

