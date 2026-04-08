#!/bin/bash
# This is a student test

T_FOLDER=${T_FOLDER:-t}
R_FOLDER=${R_FOLDER:-}

cd "$(dirname "$0")/../..$R_FOLDER" || exit 1

DIFF=${DIFF:-diff}

INPUT_TEXT="$(
cat << 'EOF'
Hello, HELLO! It's a test:
EOF
)"

EXPECTED=""

if $DIFF <(printf "%s\n" "$INPUT_TEXT" | c/process.sh) <(printf "%s" "$EXPECTED") >&2;
then
    echo "$0 success: texts are identical"
    exit 0
else
    echo "$0 failure: texts are not identical"
    exit 1
fi
