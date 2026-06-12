# Cribbage Trainer

Two cribbage tools behind a small landing page — all client-side, no install, no
accounts, no tracking:

- **Discard Trainer** (`trainer.html`) — deal a hand and see every possible discard
  ranked by expected points, each fully explained: exact hand value over all cuts,
  the crib swing of the card(s) you throw, and pegging potential. Supports 4-/3-handed
  "cutthroat" and 2-handed heads-up, as dealer or defender.
- **Play a Game** (`play.html`) — a full game of 4-player cutthroat cribbage vs 3 AI:
  cut for deal → discard → cut → interactive pegging → the show → race to 121.
- **Heads-Up** (`headsup.html`) — classic two-player cribbage vs 1 AI: deal six,
  throw two to the crib, then cut, peg, and count to 121.

**Two ways to use it:**

- **In a browser** (nothing to install) — the web release: https://cribbage-trainer.gabrielhug.workers.dev
- **As an Android app** — a signed APK on the [Releases](../../releases) page,
  installable directly or via Obtainium. The APK is fully self-contained and offline;
  see [`docs/ANDROID.md`](docs/ANDROID.md).

## Run & build

Open `index.html` in any browser (or `trainer.html` / `play.html` directly). The
pages are pre-compiled to plain JS and React is vendored in `vendor/` (no CDN), so
everything runs fully offline.

Edit the sources in `src/` (`CribbageTrainer.jsx`, `CribbagePlay.jsx`,
`landing.html`), then regenerate the three root pages:

```bash
./build.sh      # needs a global `tsc`
```

## Verify the engine

```bash
node engine/pegging.js          # pegging unit tests + full-game sanity
node engine/breakdown.js        # show-scoring breakdown + perfect-29 check
node engine/verify_players.js   # 2-/3-/4-handed regression + sanity
node engine/verify_play.js      # play.html reducer: go/31/last-card, his-heels, the show
node engine/verify_headsup.js   # headsup.html reducer: deal-6/discard-2, heads-up pegging & show
```

`CLAUDE.md` holds the full design notes — the EV model, the calibrated discard
distributions, the per-rank "crib swing" reference, the game's architecture, the
deploy pipeline, and known limitations.

## License

Public domain — [The Unlicense](LICENSE) (`SPDX-License-Identifier: Unlicense`).
The only bundled third-party code is React / React-DOM (MIT). No warranty.
