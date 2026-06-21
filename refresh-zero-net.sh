#!/usr/bin/env bash
# refresh-zero-net.sh — FIRST STEP of every release.
#
# Pulls the latest trained Cribbage Zero net from the cribbage-zero `net` branch into src/az_net.json,
# so the baked-in "Zero" bot ships the CURRENT net in BOTH the web build and the APK (play.html embeds
# the net at build time; the APK has no INTERNET permission, so the net must be baked, not fetched at
# runtime). Without this, a release would freeze whatever net was last committed — possibly the
# placeholder. The refresh-zero-net.yml GitHub Action does the same for a standalone refresh.
#
# Run order at release:  ./refresh-zero-net.sh  →  bump VERSION + android versionName/versionCode
#                        →  ./build.sh  →  commit  →  push dev+main  →  tag v<version>
set -euo pipefail
cd "$(dirname "$0")"

BASE="https://raw.githubusercontent.com/ghug/cribbage-zero/net/checkpoints"
echo "refresh-zero-net: pulling latest net from cribbage-zero @ net …"
curl -fsSL "$BASE/az_checkpoint.json" -o /tmp/cz_net.json
curl -fsSL "$BASE/progress.csv" -o /tmp/cz_progress.csv 2>/dev/null || true   # games/iter fallback during the format transition

node -e '
  const fs = require("fs");
  const n = JSON.parse(fs.readFileSync("/tmp/cz_net.json", "utf8"));
  // shape sanity — a malformed/half-written net must NOT get baked into a release
  if (!Array.isArray(n.W1) || n.W1.length !== n.nHid || !Array.isArray(n.W1[0]) || n.W1[0].length !== n.nIn) {
    console.error("refresh-zero-net: fetched net looks malformed (nIn " + n.nIn + ", nHid " + n.nHid + ") — aborting"); process.exit(1);
  }
  // iter/games live in the net file (fallback to the old progress.csv header during the format transition)
  let iter = n.iter || 0, games = n.games || 0;
  if (!iter || !games) { try { const t = fs.readFileSync("/tmp/cz_progress.csv", "utf8"); const m = t.match(/(\d+)\s*games,\s*iter\s*(\d+)/); if (m) { games = games || +m[1]; iter = iter || +m[2]; } } catch (e) {} }
  fs.writeFileSync("/tmp/cz_meta.json", JSON.stringify({ iter: iter, games: games }));
  // ENGINE-ONLY clean net: just what zero.js reads (policy network) — drop iter/games and the unused value head (Wv/bv).
  // Round weights to 6 sig figs (~60% smaller, verified 0 decision changes over ~50k positions). The
  // full-precision, full net stays on the cribbage-zero net branch; this is the bundle copy.
  const r6 = (x) => Array.isArray(x) ? x.map(r6) : (typeof x === "number" ? +x.toPrecision(6) : x);
  const net = { nIn: n.nIn, nHid: n.nHid, nPol: n.nPol, W1: r6(n.W1), b1: r6(n.b1), Wp: r6(n.Wp), bp: r6(n.bp) };
  fs.writeFileSync("src/az_net.json", JSON.stringify(net));
  console.log("refresh-zero-net: src/az_net.json <- net iter " + iter + ", " + games + " games (nIn " + net.nIn + ", nHid " + net.nHid + ", " + Math.round(fs.statSync("src/az_net.json").size / 1024) + " KB, engine-only weights @ 6 sig figs)");
'
echo "refresh-zero-net: done. NB src/zero.js's encoders must match nIn — keep them in lockstep on any architecture change."
echo "next: bump VERSION + android versionName/versionCode (+1), ./build.sh, commit, push dev+main, tag v<version>"
