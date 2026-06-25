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

echo "refresh-zero-net: pulling latest net from cribbage-zero @ net …"
curl -fsSL "https://raw.githubusercontent.com/ghug/cribbage-zero/net/checkpoints/az_checkpoint.json" -o /tmp/cz_net.json

node -e '
  const fs = require("fs");
  const n = JSON.parse(fs.readFileSync("/tmp/cz_net.json", "utf8"));
  // shape sanity — multi-layer net: W = array of FLAT row-major layers (dout*din), Wp FLAT (nPol*nHid).
  // A malformed/half-written net must NOT get baked into a release.
  const hidden = Array.isArray(n.hidden) ? n.hidden : [n.nHid];
  const sizes = [n.nIn].concat(hidden);
  const okW = Array.isArray(n.W) && n.W.length === hidden.length && n.W.every((w, l) => Array.isArray(w) && w.length === hidden[l] * sizes[l]);
  const okWp = Array.isArray(n.Wp) && n.Wp.length === n.nPol * n.nHid;
  if (!n.nIn || !okW || !okWp) {
    console.error("refresh-zero-net: fetched net looks malformed (nIn " + n.nIn + ", hidden " + JSON.stringify(hidden) + ") — aborting"); process.exit(1);
  }
  // iter/games live in the net file
  const iter = n.iter || 0, games = n.games || 0;
  fs.writeFileSync("/tmp/cz_meta.json", JSON.stringify({ iter: iter, games: games }));
  // ENGINE-ONLY clean net: just what zero.js reads (the multi-layer policy network) — drop iter/games and the
  // unused value head (Wv/bv). Round weights to 6 sig figs (smaller, no decision change). The full-precision,
  // full net stays on the cribbage-zero net branch; this is the bundle copy.
  const r6 = (x) => Array.isArray(x) ? x.map(r6) : (typeof x === "number" ? +x.toPrecision(6) : x);
  const net = { nIn: n.nIn, hidden: hidden, nHid: n.nHid, nPol: n.nPol, W: r6(n.W), b: r6(n.b), Wp: r6(n.Wp), bp: r6(n.bp) };
  fs.writeFileSync("src/az_net.json", JSON.stringify(net));
  console.log("refresh-zero-net: src/az_net.json <- net iter " + iter + ", " + games + " games (nIn " + net.nIn + ", hidden " + JSON.stringify(hidden) + ", " + Math.round(fs.statSync("src/az_net.json").size / 1024) + " KB, engine-only weights @ 6 sig figs)");
'
echo "refresh-zero-net: done. NB src/zero.js's encoders must match nIn — keep them in lockstep on any architecture change."
echo "next: bump VERSION + android versionName/versionCode (+1), ./build.sh, commit, push dev+main, tag v<version>"
