#!/usr/bin/env bash
# Regenerates index.html from src/CribbageTrainer.jsx using tsc (JSX -> React.createElement).
# No bundler/build deps beyond a global `tsc`. Run: ./build.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/src/CribbageTrainer.jsx"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1) Swap the module import/export for browser-global CDN React, and mount the app.
sed -e 's#^import React, { useState, useMemo, useCallback } from "react";#const { useState, useMemo, useCallback } = React;#' \
    -e 's#^export default function CribbageTrainer()#function CribbageTrainer()#' \
    "$SRC" > "$TMP/app.tsx"
printf '\nReactDOM.createRoot(document.getElementById("root")).render(React.createElement(CribbageTrainer));\n' >> "$TMP/app.tsx"

# 2) Transpile JSX -> plain JS (modern syntax, comments stripped). Type errors are
#    expected (the source is untyped JS) and non-fatal; we only want the emit.
npx --no-install tsc "$TMP/app.tsx" \
    --jsx react --target es2020 --module none --removeComments \
    --ignoreDeprecations 6.0 --skipLibCheck --noEmitOnError false \
    --outDir "$TMP/out" >/dev/null 2>&1 || true

# 3) Wrap with the HTML shell. tsc emits its own "use strict"; don't double it.
{
cat <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0f2417" />
<title>Cutthroat Cribbage Trainer</title>
<style>html,body{margin:0;background:#0f2417;min-height:100%}#root{min-height:100vh}</style>
<script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
</head>
<body>
<div id="root"></div>
<script>
HTML
cat "$TMP/out/app.js"
cat <<'HTML'

</script>
</body>
</html>
HTML
} > "$ROOT/index.html"
echo "built index.html ($(wc -l < "$ROOT/index.html") lines)"
