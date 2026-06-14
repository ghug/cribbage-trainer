#!/usr/bin/env bash
# Regenerates the root pages from src/ using tsc (JSX -> React.createElement).
# No bundler/build deps beyond a global `tsc`. Run: ./build.sh
#
#   index.html    <- src/landing.html         (static welcome page, copied verbatim)
#   trainer.html  <- src/CribbageTrainer.jsx  (the discard trainer)
#   play.html     <- src/CribbagePlay.jsx     (the consolidated game, 2-6 players)
#
# Each app renders its own in-header Home link, so the shell's optional fixed Home
# link (the homeLink arg to build_one) is off for both; it remains available for any
# future page that wants it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

# The i18n head, INLINED into the HTML: the runtime + language list + English catalogue go
# straight into the page so the critical translation path needs no external fetch. This is what
# makes it work identically whether the site is served at the root (Cloudflare workers.dev),
# under a /<repo>/ subpath (GitHub Pages — relative src="i18n.js" otherwise mis-resolves there),
# or from file:// in the APK. Only non-English locale files still load externally (via
# i18nBootstrap, which derives their path from location). No locale string contains "</script>".
i18n_head() {
  printf '<script>\n'; cat "$ROOT/i18n.js";          printf '\n</script>\n'
  printf '<script>\n'; cat "$ROOT/locales/index.js"; printf '\n</script>\n'
  printf '<script>\n'; cat "$ROOT/locales/en.js";    printf '\n</script>\n'
  printf '<script>window.i18nBootstrap&&i18nBootstrap();</script>\n'
}

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

  # 1.5) Guard against undefined identifiers (e.g. a render-time `dealer` left behind by
  #      a refactor). The engine/verify_*.js harnesses only exercise the pure functions,
  #      never the React render, so a bare ReferenceError inside JSX would otherwise reach
  #      users as a blank screen. tsc name-resolution catches exactly that. Run it on the
  #      original $SRC (which imports React/hooks as names) so React/ReactDOM globals don't
  #      register as false positives the way they would on the import-swapped app.tsx.
  local NAMEERR
  NAMEERR="$(npx --no-install tsc "$ROOT/$SRC" \
      --jsx react --target es2020 --module none --removeComments \
      --ignoreDeprecations 6.0 --skipLibCheck --noEmit 2>&1 \
      | grep -i "cannot find name" || true)"
  if [ -n "$NAMEERR" ]; then
    echo "✗ build aborted — $SRC references undefined name(s):" >&2
    echo "$NAMEERR" >&2
    rm -rf "$TMP"; exit 1
  fi

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
HTML
  i18n_head
  cat <<HTML
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

# Landing page is plain static HTML. Copy it, but splice the inlined i18n head in place of its
# external <script src="i18n.js">…<i18nBootstrap()> block (src/landing.html keeps the external
# tags so it still works opened directly; the deployed index.html gets the inlined, subpath-safe
# version). The block runs from the i18n.js line through the i18nBootstrap() line.
I18N_TMP="$(mktemp)"; i18n_head > "$I18N_TMP"
awk -v hf="$I18N_TMP" '
  index($0, "<script src=\"i18n.js\">") { while ((getline l < hf) > 0) print l; close(hf); blk=1; next }
  blk { if (index($0, "i18nBootstrap()")) blk=0; next }
  { print }
' "$ROOT/src/landing.html" > "$ROOT/index.html"
rm -f "$I18N_TMP"
echo "built index.html (landing, i18n head inlined)"

# Both apps render their own Home button in their header, so neither uses the shell link.
build_one "src/CribbageTrainer.jsx" "trainer.html" "Cribbage Discard Trainer" "CribbageTrainer" "no"
build_one "src/CribbagePlay.jsx"    "play.html"    "Cribbage — Play"          "CribbagePlay"   "no"

# Stamp the version (read from the VERSION file) into each page's About popup, which
# carries the __APP_VERSION__ placeholder. VERSION is the single source of truth:
# "<patch>-dev.<n>" on the dev branch, "<major.minor.patch>" on a release.
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION" 2>/dev/null)"
for f in index.html trainer.html play.html; do
  sed -i "s/__APP_VERSION__/${VERSION}/g" "$ROOT/$f"
done
echo "stamped version v${VERSION}"

# i18n key-parity lint: fail the build if any referenced key is missing from en.js (it would
# otherwise render as the raw key), or a translation has a stray/typo'd key.
node "$ROOT/engine/verify_i18n.js"
