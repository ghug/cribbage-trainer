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

URL="https://raw.githubusercontent.com/ghug/cribbage-zero/net/checkpoints/az_checkpoint.json"
echo "refresh-zero-net: pulling latest net from cribbage-zero @ net …"
curl -fsSL "$URL" -o /tmp/cz_net.json

node -e '
  const fs = require("fs");
  const n = JSON.parse(fs.readFileSync("/tmp/cz_net.json", "utf8"));
  // shape sanity — a malformed/half-written net must NOT get baked into a release
  if (!Array.isArray(n.W1) || n.W1.length !== n.nHid || !Array.isArray(n.W1[0]) || n.W1[0].length !== n.nIn) {
    console.error("refresh-zero-net: fetched net looks malformed (nIn " + n.nIn + ", nHid " + n.nHid + ") — aborting"); process.exit(1);
  }
  const net = { iter: n.iter, games: n.games || 0, nIn: n.nIn, nHid: n.nHid, nPol: n.nPol, W1: n.W1, b1: n.b1, Wv: n.Wv, bv: n.bv, Wp: n.Wp, bp: n.bp };
  fs.writeFileSync("src/az_net.json", JSON.stringify(net));
  console.log("refresh-zero-net: src/az_net.json <- iter " + net.iter + ", " + net.games + " games (nIn " + net.nIn + ", nHid " + net.nHid + ")");
'
echo "refresh-zero-net: done. NB src/zero.js's encoders must match nIn — keep them in lockstep on any architecture change."
echo "next: bump VERSION + android versionName/versionCode (+1), ./build.sh, commit, push dev+main, tag v<version>"
