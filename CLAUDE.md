# CLAUDE.md — Cribbage Discard Trainer

> Read this first. It is the full context for the project. It was handed off from a
> claude.ai chat session; treat it as the source of truth and update it as you work.

**License:** public domain via The Unlicense (`SPDX: Unlicense`, see `LICENSE`) — no
author name anywhere, by request. Kept FOSS-channel compatible (F-Droid/IzzyOnDroid).
Bundled React/React-DOM is MIT. Don't add a copyright/author name to the repo, and
keep any new dependencies FOSS so F-Droid stays an option.

## START HERE (plain version)

You have **two finished, working tools** behind a small welcome page, all
self-contained (no in-browser build, no install, no internet needed beyond a CDN
for React):

- **`index.html`** — the landing page (`src/landing.html`). The trainer and the Play
  game, with the **"Players at the table"** selector shown on the page just above the
  Play card.
- **`trainer.html`** — the **Discard Trainer** (analyzes/ranks discards).
- **`play.html`** — **Play**: one game that adapts to `settings.players` (the global
  "Players" setting, default **4**). Supports **2 (heads-up)** through **6** (cutthroat) —
  the reducer is general (deal/crib/show/pegging/layout all computed from the player
  count via `plan(P, dealerIdx)`); `PLAYER_OPTIONS` lists the exposed sizes. Per size:
  3-handed flips a deck card into the crib; at 5–6 the dealer (and at 6 the seat to their
  right) are dealt 4 and throw none, and the human-as-non-thrower skips the discard.
  `discard` is stored as an **array** (1 or 2 cards) to unify the heads-up two-card throw.
  The **"Players" and "Teams"** selectors live on the **landing page** (above the Play
  card), not in the in-game settings panel. **Teams** (`settings.teams`): default is
  cutthroat (one team per seat). `teamOf(seat,P,teams) = seat % teams` gives the
  partnerships: **4/2** → across pairs {0,2},{1,3}; **6/3** → across pairs {0,3},{1,4},{2,5};
  **6/2** → every other seat {0,2,4},{1,3,5} (three each). Partners **share one running
  score** (plus the peg track, history, win, and skunk) — `addScore` lands points on
  every teammate, logging the entry to the earner; a team's total is the sum of its
  members' histories. `src/CribbagePlay.jsx`. Verified by `engine/verify_play.js` (drives
  P=2 through 6 cutthroat, plus the 4/2, 6/3 and 6/2 partnership-scoring configs).

  > The five fixed-size pages (`play3/4/5/6.html`, `headsup.html` + their `src/` and
  > `engine/verify_*` files) were **retired** once the consolidated `play.html` covered
  > 2–6; git history has them if ever needed.

**To just use it: open `index.html` in any browser** (or jump straight to
`trainer.html` / `play.html`).

**It is also deployed** to a live, public link via Cloudflare (see Running and
deploying below): **`https://cribbage-trainer.gabrielhug.workers.dev`** (the root is
now the welcome page; the trainer is at `/trainer.html`, the game at `/play.html`).
Pushing to `main` on the `ghug/cribbage-trainer` repo auto-redeploys. Edit the
source, run `./build.sh`, commit, push — that's the whole update loop.

If you're a Claude Code session picking this up: everything runs locally, is
published, and the current direction is **(c) keep improving it** (see Good next
steps).

## What this is

Two single-component React apps that share the same verified cribbage engine and
cribbage-board aesthetic (inline styles, no dependencies beyond React):

1. **Discard Trainer** (`src/CribbageTrainer.jsx` → `trainer.html`) — practice
   **optimal discarding** in **4-/3-handed "cutthroat"** (every player for
   themselves) or **2-handed heads-up**, selectable in the UI. Deals a hand, lets
   the user pick the card(s) to throw, then reveals a ranked, fully-explained
   analysis of every possible discard (5 single-card throws when dealt 5 cards, all
   15 two-card combos when dealt 6).
2. **Play a Game** (`src/CribbagePlay.jsx` → `play.html`) — a complete, playable
   game of **4-player cutthroat cribbage vs 3 bots**: deal → discard → cut →
   interactive pegging → the show → race to 121 → rotate dealer. See "The playable
   game" below.

A static **landing page** (`src/landing.html` → `index.html`) links to the two.

The `engine/` folder holds the Node verification scripts the engine was validated
against — they are not imported by the apps, but they document and re-prove the math.

## Game rules being modeled

- **Selectable 4-handed (default), 3-handed, or 2-handed**, via the "players at the
  table" toggle in the UI (`players` state ∈ {4, 3, 2}). 4-/3-handed are "cutthroat"
  (every player for themselves); 2-handed is standard heads-up cribbage.
- **Deal & discard depend on table size:**
  - **4-/3-handed:** each player dealt **5 cards**, discards **exactly one**. UI
    ranks the **5** single-card discards.
  - **2-handed:** each player dealt **6 cards**, discards **two**. UI ranks all
    **15** two-card combos; the user taps two cards.
- The crib always holds **4 cards**, scored with the starter as a 5-card hand:
  - **4-handed:** the 4 crib cards are one discard from each player.
  - **3-handed:** the three players' discards make only 3, so the **dealer adds one
    card dealt straight off the deck** (a uniform random card) to fill the crib.
  - **2-handed:** your **two** discards + the opponent's **two**.
- The **dealer owns the crib**. You deal 1 of every `players` hands (1-in-4, 1-in-3,
  or 1-in-2); otherwise you are a non-dealer ("defender") throwing into the dealer's
  crib.
- Standard show scoring: fifteens, pairs, runs (with duplicates), flush (4-card
  flush counts in the **hand** only; the crib needs all 5 same suit), nobs.

## Architecture / data flow

`analyze(hand, role, mode, players=4, N=10000, Npeg=700)` is the core. It enumerates
the discard options (`discardCombos`: 5 single-card throws for 4-/3-handed, all 15
two-card combos for 2-handed) and for each computes three components and two
roll-ups. Each option carries `{ id, idxs, cards }` (the discard index set + the
actual card(s)); `id` is `idxs.join(",")`. `players` flows into the crib and pegging
models below.

1. **Hand EV — exact.** `handDetail(four, dealt)` enumerates every possible cut
   card (47 from a 5-card deal, 46 heads-up) and averages the kept-four score.
   Returns `ev, sd, min, max, p10, p90`, category breakdown, `locked` (guaranteed
   pre-cut) and top-3 best cuts. No estimation — flush upgrades, nobs, everything
   falls out of enumeration. Independent of `players` (you only know your own cards).
2. **Crib EV — Monte Carlo (N=10,000).** `cribDetail(discards, dealt, ...)` takes
   your **array** of discards (1 card for 4-/3-handed, 2 heads-up) and fills the
   rest of the 4-card crib by an empirical **role-split rank distribution** (suits
   uniform within rank; starter uniform). The crib is always 4 cards:
   - **4-handed** deal → your 1 + **3 defender** throws; defend → your 1 + **1
     dealer** + **2 defender**.
   - **3-handed** deal → your 1 + **2 defender** + **1 uniform deck card**; defend →
     your 1 + **1 dealer** + **1 defender** + **1 uniform deck card**.
   - **2-handed** deal → your 2 + **2 defender** throws; defend → your 2 + **2
     dealer** throws (heads-up, the only other contributor is the dealer).
   Composition is computed generally: `nUniform = players===3 ? 1 : 0`,
   `nThrows = 4 - discards.length - nUniform`; on defense `nDealer = players===2 ?
   nThrows : 1`. The deck card is drawn like the starter (uniform). Because a uniform
   card is "richer" than a defender's deliberate junk throw, 3-handed cribs run a
   touch higher than 4-handed (see crib-swing note below).
3. **Pegging EV — Monte Carlo (N=700).** `pegDetail(...)` simulates `players`-handed
   play (`playPegging` derives the seat count from `hands.length`). Your seat =
   dealer (last seat = `players-1`, plays last = best peg seat) when dealing, else a
   random non-dealer seat. Opponents play a greedy point-grabbing policy with
   light defense. Suits are dropped here (pegging never scores flushes), so
   cards are ranks 1..13. Scoring mechanics (15/31/pair-royals/runs in & out of
   order/go/last card) are unit-tested in `engine/pegging.js`.

### Scoring roll-up

```
sign  = +1 if dealing else -1
net   = handEV + pegEV + sign*cribEV                      # mode-neutral expected points
sd    = sqrt(handSd^2 + cribSd^2 + pegSd^2)
adj   = handEV + pegEV + sign*cribW*cribEV + riskSign*RISK*sd   # the ranking objective
```

`RISK = 0.5`. Modes:

| mode    | label         | riskSign | cribW (defend only) |
|---------|---------------|----------|---------------------|
| ev      | max EV        |  0       | 1.0                 |
| need    | chase points  | +1       | 0.9                 |
| protect | protect lead  | -1       | 1.3                 |

`suggestMode(you, leader)`: `leader>=106 && you<leader → need`;
`you>=leader+15 && you>=95 → protect`; else `ev`. The board panel auto-applies the
suggestion but the user can override (Auto / ev / need / protect).

Performance: a full `analyze()` is ~175 ms at these sample sizes. Keep it under
~300 ms; it runs synchronously on each pick.

## Calibrated constants (baked into the JSX — do not regenerate casually)

Index 0 = A … 12 = K. Produced by an iterative fixed-point self-play calibration,
**averaged over passes 2–3** to cancel Monte-Carlo noise.

```
DEALER_DISCARD_PROBS   = [0.0639, 0.08325, 0.09032, 0.05659, 0.07681, 0.06226,
                          0.08103, 0.0937, 0.06772, 0.04889, 0.09511, 0.07993, 0.10046]
DEFENDER_DISCARD_PROBS = [0.09388, 0.06719, 0.04547, 0.04428, 0.00398, 0.06537,
                          0.0818, 0.08531, 0.08712, 0.09632, 0.0411, 0.11445, 0.17376]
```

Pattern sanity: dealers favor K/J/8/3 into their own crib and protect 10s;
defenders dump K (17%) / Q / 10 / A and **almost never a 5** (0.4%). Re-run with
`node engine/calibrate_split.js` (it reads/writes `engine/state.json` between
passes). NOTE: further passes are not worth it — they move displayed crib EV by
<0.05 pt. This was a deliberate stopping point.

**3-handed reuses these same distributions.** They were calibrated under 4-handed
self-play, but how players dump junk barely shifts with table size, so 3-handed
borrows them (the third crib slot is a uniform deck card anyway, not a throw). The
UI says so in the crib-model panel. Re-calibrating a separate 3-handed model is a
possible future step but low value.

## Reference: per-rank crib value ("crib swing")

Validation numbers from the model (avg crib pts when you contribute that rank).
The 5 dominates; everything else is connectedness. Use these to sanity-check any
engine change.

```
rank: A    2    3    4    5     6    7    8    9    10   J    Q    K
your: 3.96 3.95 4.05 4.06 6.38 4.10 4.21 4.34 4.09 3.74 4.19 3.73 3.85
their:4.13 4.28 4.37 4.28 6.52 4.32 4.45 4.46 4.26 3.99 4.41 4.02 4.03
```
The dealer's crib runs ~0.15 richer than yours for the same card, because it
collects the dealer's offensive "salt" throw plus your card, while your crib gets
your card + three defensive junk throws.

`engine/verify_players.js` reprints this table for both 4- and 3-handed and asserts
the 4-handed column still matches (tol 0.12). 3-handed runs ~0.1–0.2 richer across
the board because the deck card beats a defender's junk throw on average.

## The playable game (`src/CribbagePlay.jsx` → `play.html`)

A complete game of cribbage vs bots that **adapts to the table size** (2–6, from
`settings.players`), first to 121. It is a second self-contained React page that
**copies the engine primitives verbatim** from the trainer (`scoreInto`, `handDetail`,
`pegScore`, `pegChoose`, `deckExcluding`, the theme/UI atoms) — the two pages never
share a module, matching how `engine/` also duplicates the math. Everything per-size
(deal sizes, crib makeup, starter index, show order, pegging rotation, seat names,
layout) is derived from the player count via `plan(P, dealerIdx)` / `tableSeats(P)`.

- **Phase machine** (`useReducer`): `cutdeal → deal → discard → cut → play → show → over`.
  Human is always seat 0; `dealerIdx` rotates +1 each hand. State carries `seats[P]`
  (`{score, dealt, kept, discard, isAI}`, cards stay **suited** throughout), `crib`,
  `starter`, a `peg` sub-state during play, a `show` sub-state during counting, and
  `settings.counting`.
- **Bot discard** (`aiDiscard`): for each of the 5 throws, `handDetail(keptFour).ev +
  sign*CRIB_VALUE[rank]` (`sign=+1` if that seat deals, else `−1`); pick the best.
  `CRIB_VALUE` is the **"your" crib-swing row** from the reference table above
  (per rank A–K) — a fast stand-in for the trainer's Monte-Carlo `cribDetail`.
- **Interactive pegging**: a self-clocking `useEffect` keyed on the peg state. A
  human with a legal card blocks for a tap; bots move and all forced "go"s fire on a
  timer. The reducer mirrors the verified `playPegging` mechanics exactly (15/31/
  pairs/runs, go, last card).
- **The show**: counts in order `[pone, +2, +3, dealer, CRIB]`, **checking ≥121 after
  every award and stopping immediately** (a non-dealer to the dealer's left can peg
  out first). Auto-count or **muggins** (you claim your own hand/crib; missed points
  go to the next opponent in counting order; over-claims are corrected down).
- **Correctness pitfalls guarded** (see `engine/verify_play.js`): go/31/last-card
  never double-count; his heels = **+2** at the cut; the 121 counting-order
  short-circuit; suits survive pegging (only the rank arrays handed to
  `pegScore`/`pegChoose` drop suits).

Same scope notes as the trainer apply, plus: opponents are 3 bots (greedy pegging, no
lookahead), and partners/teams mode and 2-/3-handed play are out of scope here.

## Known limitations (be honest about these in the UI)

- **Pegging is an estimate, not a solve.** Greedy opponent policy; no lookahead.
  The relative ranking across holds is the trustworthy part, not the absolute pts.
- **Board mode is a risk heuristic, not win-probability.** It rewards/penalizes
  volatility (`±RISK·σ`) and stiffens crib defense; it does not model the race to
  121 or who is about to peg out beyond the simple `suggestMode` thresholds.
- **Opponent suit choice is uniform within rank.** Fine — the only thing it
  affects is the ~0.2%/~0.01-pt crib flush.

## How to verify the engine

```
node engine/pegging.js          # pegging unit tests + full-game sanity (dealer seat pegs most)
node engine/breakdown.js        # category breakdown reconciles to totals; perfect-29 check
node engine/calibrate_split.js  # one self-play calibration pass (mutates state.json)
node engine/verify_players.js   # 2-/3-/4-handed: regression (players=4 == original) + crib/peg sanity
node engine/verify_play.js      # play.html: evals the built consolidated reducer, drives whole hands
                                #   at every table size P=2..6 — deal/crib/starter, go/31/last-card,
                                #   his-heels +2, the 121 show short-circuit, the skip-discard paths
```
If you change `scoreInto`, re-run breakdown/pegging tests AND re-check the crib
swing table above before trusting `analyze()`. If you touch `cribDetail`,
`pegDetail`, or `playPegging`, also run `verify_players.js` — it guarantees the
4-handed path is bit-for-bit unchanged and the 3-/2-handed paths stay sane.
`verify_play.js` reads the **built** `play.html`, so run `./build.sh` first when you
change `src/CribbagePlay.jsx`.

## Running and deploying

**Run locally (already works):** open `index.html` in a browser (the welcome page),
or `trainer.html` / `play.html` directly. They are pre-compiled to plain JS (no
Babel, no in-browser build). React/ReactDOM are **vendored locally** in `vendor/`
(`react@18.3.1` UMD), referenced as `<script src="vendor/react*.min.js">` — **no
CDN**, so everything works fully offline (this matters for the APK wrapper below).
The editable sources are `src/CribbageTrainer.jsx`, `src/CribbagePlay.jsx`, and
`src/landing.html`. The `vendor/` files must be served alongside the HTML (they are
not in `.assetsignore`).

**Rebuild after editing any source:** run `./build.sh` (needs a global `tsc`; one is
present in this environment). It regenerates the root pages from `src/`:
- `index.html` ← `src/landing.html` (plain static HTML, copied verbatim).
- `trainer.html` ← `src/CribbageTrainer.jsx`; `play.html` ← `src/CribbagePlay.jsx` —
  each via a `build_one <src> <out> <title> <Component> <homeLink>` helper:
  transpile JSX → `React.createElement` (`tsc --jsx react --target es2020
  --removeComments`), swap the ESM import/export for CDN globals, wrap in the HTML
  shell. Both apps render their **own ⌂ Home button in their header** (the trainer's
  links straight home; the game's confirms first, since leaving ends the game), so
  both pass `homeLink "no"` — the shell's optional fixed Home link is unused but kept
  for any future page.

Historically the trainer's compiled `<script>` was byte-for-byte identical to the
old single-page `index.html`; that intentionally ended when the in-header Home
button was added. Deploy = commit the regenerated HTML files (see below); never
hand-edit them.

**Deploying is now SET UP — a live Cloudflare pipeline exists.** The app is published
via **Cloudflare Pages/Workers Git integration** connected to the GitHub repo
**`ghug/cribbage-trainer`** (a public repo on the human's secondary GitHub account,
used specifically for deploy because the primary account is private/locked and can't
authorize Cloudflare). Live URL: **`https://cribbage-trainer.gabrielhug.workers.dev`**.

**To ship a change:** edit `src/CribbageTrainer.jsx` → `./build.sh` → commit → push
to `main` on the `ghug/cribbage-trainer` remote. Cloudflare auto-builds and the live
URL updates in ~30s. No tokens, no manual upload. (Pushing requires a fine-grained
GitHub PAT for the `ghug` account scoped to that repo's Contents; the human pastes it
per session — it is not stored.) The canonical dev repo is a separate,
private repo on the human's primary account; `ghug` is the public deploy mirror. The exact deploy push (no
named remote; the PAT goes inline in the URL and must not be committed/logged):

```
git push "https://x-access-token:<GHUG_PAT>@github.com/ghug/cribbage-trainer.git" HEAD:main
```

Note on reachability: whether the sandbox can fetch the live URL depends on the
**environment's network policy** (set when the Claude-Code-on-the-web environment is
created), so don't assume — test it with a quick `curl`. In some environments
`*.workers.dev` is blocked (`host_not_allowed`); in others it is reachable. When it
is reachable you can smoke-test what's *served* (HTTP status, titles, that the right
app code is in the page) — e.g. `curl -sSL …/play4` returns `<title>Cribbage — Play</title>`;
Cloudflare serves clean URLs, so `/play.html` 307-redirects to `/play4` and
`/trainer.html` to `/trainer`. Full interactive JS testing still needs a real
browser, so for actual gameplay/visual checks, ask the human to eyeball it.

Legacy fallback routes (only if the pipeline above is ever torn down): Cloudflare
Direct Upload (drag `index.html` in the dashboard), or the REST API with an
`Account → Cloudflare Pages → Edit` token + Account ID.

## Android / APK packaging (`android/` + `docs/ANDROID.md`)

> **Release versioning policy (carried preference):** on every release bump **only the
> patch number** (the 3rd in `versionName`, e.g. `1.1.0 → 1.1.1`) and `versionCode +1`.
> **Never** advance the major or minor number unless the human explicitly asks. So the
> next release after `1.1.0` is `1.1.1` (versionCode 5), then `1.1.2`, etc.

Scaffolded for Obtainium / IzzyOnDroid. `android/` is a self-contained Gradle
project: a single full-screen `WebView` (`MainActivity.java`, no third-party libs,
**no INTERNET permission** — fully offline) loading `file:///android_asset/index.html`.
The Gradle task `:app:syncWebAssets` copies the repo-root build outputs
(`index.html`/`trainer.html`/`play.html`/`vendor/`) into the APK at build time, so the
**committed root HTML is the source of truth** — run `./build.sh` and commit before
tagging. `applicationId = dev.cribbage.cutthroat` (name-free; immutable once
published). The CI workflow `.github/workflows/android-release.yml` builds + signs +
attaches the APK to a GitHub Release on a `v*` tag (needs `KEYSTORE_*` repo secrets;
pushing workflow files needs a `workflow`-scoped token, not the Contents-only PAT).
Full how-to
(keystore, secrets, Obtainium add-by-URL, IzzyOnDroid RFP) in **`docs/ANDROID.md`**.
Known caveat: the UI's CSS container queries need WebView ≥105 (old/de-Googled
WebViews may mis-size cards). The wrapper couldn't be fully built in-sandbox (no
Android SDK); CI provisions it.

**ANDROID / TERMUX CAVEAT (important, learned the hard way):** `npm install -g
wrangler` FAILS on Android/Termux — Wrangler bundles `workerd`, a native binary
with no Android build (`Error: Unsupported platform: android arm64`). So on an
Android/Termux environment, do NOT use the Wrangler CLI. Use Direct Upload (route 1)
or the REST API (route 2), or run Wrangler only inside a real Linux arm64 userland
(e.g. `proot-distro` Debian), never bare Termux.

## Good next steps (roughly in value order)

The trainer, the playable game, the live web deploy, and the Android APK pipeline are
all done and shipped. Remaining ideas:

1. Add an in-repo test runner (port the `engine/` checks to a `test/` dir, e.g.
   vitest) so changes are guarded.
2. Stronger pegging: shallow expectiminimax or a learned policy instead of greedy.
3. Real win-probability board model (game-to-121 race) to replace the σ heuristic.
4. Exploit-mode: let the user enter observed opponent tendencies and re-weight the
   crib distributions away from the self-play equilibrium.
5. Publish to IzzyOnDroid: the APK/CI and `fastlane/` listing are ready — file the
   RFP (see `docs/ANDROID.md`).

## Style / working preferences carried over from the original session

- Rigor first: verify scoring changes numerically before wiring into the UI.
- When showing rank tables, show **all 13 ranks A–K**, never a partial list.
- Be upfront about model limitations rather than overstating precision.
