# Cribbage Trainer

Six cribbage tools behind a small landing page — all client-side, no install, no
accounts, no tracking:

- **Discard Trainer** (`trainer.html`) — deal a hand and see every possible discard
  ranked by expected points, each fully explained: exact hand value over all cuts,
  the crib swing of the card(s) you throw, and pegging potential. Supports 4-/3-handed
  "cutthroat" and 2-handed heads-up, as dealer or defender.
- **Four-Handed** (`play4.html`) — 4-player cutthroat cribbage vs 3 AI: cut for deal →
  discard → cut → interactive pegging → the show → race to 121.
- **Six-Handed** (`play6.html`) — 6-player cutthroat cribbage vs 5 AI: everyone throws
  one to the crib except the dealer and the player to their right (each dealt four,
  throw none), then cut, peg, and count to 121.
- **Five-Handed** (`play5.html`) — 5-player cutthroat cribbage vs 4 AI: everyone is
  dealt five and throws one to the crib, except the dealer (dealt four, throws none),
  then cut, peg, and count to 121.
- **Three-Handed** (`play3.html`) — 3-player cutthroat cribbage vs 2 AI: each player
  throws one to the crib and the dealer tops it up with a card off the deck, then cut,
  peg, and count to 121.
- **Heads-Up** (`headsup.html`) — classic two-player cribbage vs 1 AI: deal six,
  throw two to the crib, then cut, peg, and count to 121.

**Two ways to use it:**

- **In a browser** (nothing to install) — the web release, on either mirror:
  - https://cribbage-trainer.gabrielhug.workers.dev (Cloudflare)
  - https://ghug.github.io/cribbage-trainer/ (GitHub Pages)
- **As an Android app** — a signed APK on the [Releases](../../releases) page,
  installable directly or via Obtainium. The APK is fully self-contained and offline;
  see [`docs/ANDROID.md`](docs/ANDROID.md).

## Run & build

Open `index.html` in any browser (or `trainer.html` / `play4.html` directly). The
pages are pre-compiled to plain JS and React is vendored in `vendor/` (no CDN), so
everything runs fully offline.

Edit the sources in `src/` (`CribbageTrainer.jsx`, `CribbagePlay4.jsx`,
`landing.html`), then regenerate the three root pages:

```bash
./build.sh      # needs a global `tsc`
```

## Verify the engine

```bash
node engine/pegging.js          # pegging unit tests + full-game sanity
node engine/breakdown.js        # show-scoring breakdown + perfect-29 check
node engine/verify_players.js   # 2-/3-/4-handed regression + sanity
node engine/verify_play4.js      # play4.html reducer: go/31/last-card, his-heels, the show
node engine/verify_play3.js     # play3.html reducer: 3-handed crib (3 throws + deck card), show order
node engine/verify_play5.js     # play5.html reducer: dealer dealt 4/throws none, crib = 4 non-dealer throws
node engine/verify_play6.js     # play6.html reducer: dealer + seat-to-right dealt 4/throw none, crib = 4 throws
node engine/verify_headsup.js   # headsup.html reducer: deal-6/discard-2, heads-up pegging & show
```

`CLAUDE.md` holds the full design notes — the EV model, the calibrated discard
distributions, the per-rank "crib swing" reference, the game's architecture, the
deploy pipeline, and known limitations.

## License

Public domain — [The Unlicense](LICENSE) (`SPDX-License-Identifier: Unlicense`).
The only bundled third-party code is React / React-DOM (MIT). No warranty.
