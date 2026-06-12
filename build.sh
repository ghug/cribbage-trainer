#!/usr/bin/env bash
# Regenerates the three root pages from src/ using tsc (JSX -> React.createElement).
# No bundler/build deps beyond a global `tsc`. Run: ./build.sh
#
#   index.html    <- src/landing.html         (static welcome page, copied verbatim)
#   trainer.html  <- src/CribbageTrainer.jsx  (the discard trainer)
#   play.html     <- src/CribbagePlay.jsx     (the playable game vs 3 AI)
#
# Each app renders its own in-header Home link, so the shell's optional fixed Home
# link (the homeLink arg to build_one) is off for both; it remains available for any
# future page that wants it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

# build_one <src.jsx> <out.html> <title> <ComponentName>
# Transpiles a single self-contained React component into a standalone HTML page.
build_one() {
  local SRC="$1" OUT="$2" TITLE="$3" COMPONENT="$4" HOMELINK="${5:-yes}"
  local TMP; TMP="$(mktemp -d)"
  # The fixed shell "Home" link (pages that render their own in-app home button pass "no").
  local HOMEHTML=""
  if [ "$HOMELINK" = "yes" ]; then
    HOMEHTML='<a href="index.html" aria-label="Back to home" style="position:fixed;right:10px;bottom:10px;z-index:9999;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#ECE0C6;text-decoration:none;background:rgba(15,36,23,0.85);border:1px solid rgba(236,224,182,0.28);padding:7px 11px;border-radius:9px;box-shadow:0 3px 10px rgba(0,0,0,0.45)">&#8962; Home</a>'
  fi

  # 1) Swap the ESM import/export for browser-global CDN React, and mount the app.
  #    The import sed captures whatever hooks the file imports, so it is component-agnostic.
  sed -e 's#^import React, { \(.*\) } from "react";#const { \1 } = React;#' \
      -e "s#^export default function ${COMPONENT}(#function ${COMPONENT}(#" \
      "$ROOT/$SRC" > "$TMP/app.tsx"
  printf '\nReactDOM.createRoot(document.getElementById("root")).render(React.createElement(%s));\n' "$COMPONENT" >> "$TMP/app.tsx"

  # 2) Transpile JSX -> plain JS (modern syntax, comments stripped). Type errors are
  #    expected (the source is untyped JS) and non-fatal; we only want the emit.
  npx --no-install tsc "$TMP/app.tsx" \
      --jsx react --target es2020 --module none --removeComments \
      --ignoreDeprecations 6.0 --skipLibCheck --noEmitOnError false \
      --outDir "$TMP/out" >/dev/null 2>&1 || true

  # 3) Wrap with the HTML shell. tsc emits its own "use strict"; don't double it.
  #    The fixed "Home" link lives here in the shell, so the compiled <script> body
  #    stays identical across pages.
  {
  cat <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0f2417" />
<title>${TITLE}</title>
<style>html,body{margin:0;background:#0f2417;min-height:100%}#root{min-height:100vh}</style>
<script src="vendor/react.production.min.js"></script>
<script src="vendor/react-dom.production.min.js"></script>
</head>
<body>
${HOMEHTML}
<div id="root"></div>
<script>
HTML
  cat "$TMP/out/app.js"
  cat <<'HTML'

</script>
</body>
</html>
HTML
  } > "$ROOT/$OUT"

  rm -rf "$TMP"
  echo "built $OUT ($(wc -l < "$ROOT/$OUT") lines)"
}

# Landing page is plain static HTML — no transpile, just copy.
cp "$ROOT/src/landing.html" "$ROOT/index.html"
echo "built index.html (landing, copied from src/landing.html)"

# Both apps render their own Home button in their header, so neither uses the shell link.
build_one "src/CribbageTrainer.jsx" "trainer.html" "Cribbage Discard Trainer" "CribbageTrainer" "no"
build_one "src/CribbagePlay.jsx"    "play.html"    "Cribbage — Play"          "CribbagePlay"   "no"
build_one "src/CribbageHeadsUp.jsx" "headsup.html" "Cribbage — Heads-Up"      "CribbageHeadsUp" "no"
