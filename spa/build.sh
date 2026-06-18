#!/usr/bin/env bash
# Builds spa/index2.html — the self-contained combined single-page app (Home + Play + Trainer).
#
# Everything this needs lives under spa/: forked app sources in spa/src/, the shared shell menu
# (spa/src/core.jsx), and copied runtime deps (spa/vendor, spa/i18n.js, spa/locales). It is
# COMPLETELY INDEPENDENT of the root landing/play/trainer pages and never reads or writes them.
# Run:  spa/build.sh   (needs a global tsc, like the root build).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"   # the spa/ directory

# The inlined primary-language i18n head: runtime + language list + English catalogue (all local).
i18n_head() {
  printf '<script>\n'; cat "$ROOT/i18n.js";           printf '\n</script>\n'
  printf '<script>\n'; cat "$ROOT/locales/index.js";  printf '\n</script>\n'
  printf '<script>\n'; cat "$ROOT/locales/en.js";     printf '\n</script>\n'
  printf '<script>window.i18nBootstrap&&i18nBootstrap();</script>\n'
}

# Transpile a forked source to plain JS: strip the SPA-CUT regions (each app's own settings menu,
# now provided once by core.jsx), swap the ESM import/export for React globals, JSX -> createElement.
transpile_view() {
  local SRC="$1" COMPONENT="$2" OUT="$3"
  local TMP; TMP="$(mktemp -d)"
  awk '/\/\/#SPA-CUT-START/{cut=1; next} /\/\/#SPA-CUT-END/{cut=0; next} !cut{print}' "$ROOT/$SRC" \
    | sed -e 's#^import React, { \(.*\) } from "react";#const { \1 } = React;#' \
          -e "s#^export default function ${COMPONENT}(#function ${COMPONENT}(#" \
      > "$TMP/app.tsx"
  npx --no-install tsc "$TMP/app.tsx" \
      --jsx react --target es2020 --module none --removeComments \
      --ignoreDeprecations 6.0 --skipLibCheck --noEmitOnError false \
      --outDir "$TMP/out" >/dev/null 2>&1 || true
  cp "$TMP/out/app.js" "$OUT"
  rm -rf "$TMP"
}

TMP="$(mktemp -d)"
transpile_view "src/core.jsx"            "SpaCore"         "$TMP/core.js"
transpile_view "src/CribbageTrainer.jsx" "CribbageTrainer" "$TMP/trainer.js"
transpile_view "src/CribbagePlay.jsx"    "CribbagePlay"    "$TMP/play.js"
i18n_head > "$TMP/i18nhead.html"
V="$(tr -d '[:space:]' < "$ROOT/../VERSION" 2>/dev/null || echo dev)"
node "$ROOT/build_spa.js" "$TMP/play.js" "$TMP/trainer.js" "$TMP/i18nhead.html" \
     "$ROOT/src/landing.html" "$ROOT/index2.html" "$V" "$TMP/core.js"
rm -rf "$TMP"
