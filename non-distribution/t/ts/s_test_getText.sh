#!/bin/bash
# This is a student test

T_FOLDER=${T_FOLDER:-t}
R_FOLDER=${R_FOLDER:-}

cd "$(dirname "$0")/../..$R_FOLDER" || exit 1

DIFF=${DIFF:-diff}

HTML_INPUT="$(
cat << 'EOF'
<!doctype html>
<html>
  <head>
    <title>Example Title</title>
    <style>body { color: red; }</style>
  </head>
  <body>
    <h1>Main Heading</h1>
    <p>First paragraph.</p>
    <script>console.log("ignore me");</script>
  </body>
</html>
EOF
)"

EXPECTED="$(
cat << 'EOF'
MAIN HEADING
First paragraph.
EOF
)"

if $DIFF <(printf "%s\n" "$HTML_INPUT" | c/getText.js | tr -d '\r' | grep -v '^$') <(printf "%s\n" "$EXPECTED") >&2;
then
    echo "$0 success: texts are identical"
    exit 0
else
    echo "$0 failure: texts are not identical"
    exit 1
fi

